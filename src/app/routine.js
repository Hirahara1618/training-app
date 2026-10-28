"use strict";
// ルーティンタブ：ルーティンと種目の編集。保存するまでは下書き

const Routine = { draft: null, dirty: false, open: null /* "ri:ei" */ };

const DEF_FIELDS = ["id", "name", "muscle", "sets", "repMin", "repMax", "rir", "rest", "start", "inc", "note", "bw", "cardio", "unit"];

function defFrom(src) {
  const d = {};
  for (const k of DEF_FIELDS) if (src[k] !== undefined) d[k] = clone(src[k]);
  if (d.start === undefined) d.start = null;
  if (d.note === undefined) d.note = "";
  d.bw = !!d.bw;
  d.cardio = !!d.cardio;
  return d;
}

function draft() {
  if (!Routine.draft) Routine.draft = clone(programDays());
  return Routine.draft;
}

function markDirty() {
  Routine.dirty = true;
  updateSaveBar();
}

function updateSaveBar() {
  $("#savebar").hidden = !(Routine.dirty && currentTab === "routine");
  document.body.classList.toggle("has-savebar", !$("#savebar").hidden);
  $('[data-tab="routine"]').classList.toggle("dirty", Routine.dirty);
}

function exSummary(d) {
  const reps = num(d.repMin) === num(d.repMax) ? `${d.repMax}` : `${d.repMin}–${d.repMax}`;
  if (d.cardio) return `${reps}${d.unit || "分"}`;
  const parts = [`${d.sets}×${reps}${d.unit && d.unit !== "回" ? d.unit : ""}`];
  if (d.rir) parts.push(`RIR ${d.rir}`);
  if (num(d.rest)) parts.push(`休憩 ${fmtSec(d.rest)}`);
  parts.push(d.bw ? "自重" : `刻み${fmtNum(num(d.inc))}kg`);
  return parts.join(" · ");
}

// 追加用の選択肢：登録済み（他のルーティン・過去の記録）＋カタログ（部位別）
function addOptions(day) {
  const have = new Set(day.exercises.map((e) => e.id));
  const reg = {};
  for (const d of draft()) for (const e of d.exercises) if (!have.has(e.id) && !reg[e.id]) reg[e.id] = e;
  const rec = recordedExercises(sortedWorkouts(db.get(db.collection("workouts"))));
  for (const id in rec) if (!have.has(id) && !reg[id] && !CATALOG.byId[id]) reg[id] = rec[id];
  let h = `<option value="">＋ 種目を追加…</option><option value="new">新しい種目を作る</option>`;
  const regList = Object.values(reg);
  if (regList.length) h += `<optgroup label="登録済み">${regList.map((e) => `<option value="reg:${esc(e.id)}">${esc(e.name)}（${esc(e.muscle)}）</option>`).join("")}</optgroup>`;
  for (const m of MUSCLES) {
    const list = CATALOG.list.filter((c) => c.muscle === m && !c.hidden && !have.has(c.id) && !reg[c.id]);
    if (list.length) h += `<optgroup label="${esc(m)}">${list.map((c) => `<option value="cat:${c.id}">${esc(c.name)}</option>`).join("")}</optgroup>`;
  }
  return h;
}

function renderRoutine(root) {
  const days = draft();
  let h = `<h2 class="tab-title">ルーティン</h2>`;
  if (!days.length) h += `<div class="empty"><p>ルーティンがありません。下のボタンから作ってください。</p></div>`;
  days.forEach((day, ri) => {
    h += `<section class="card routine" data-r="${ri}">
      <div class="r-head">
        <input class="r-title" data-rf="title" value="${esc(day.title)}" placeholder="ルーティン名" aria-label="ルーティン名">
        <select data-rf="weekday" aria-label="曜日">${WD_NAMES.map((n, i) => `<option value="${i}" ${routineWeekday(day) === i ? "selected" : ""}>${i ? n + "曜" : "曜日なし"}</option>`).join("")}</select>
      </div>
      <div class="r-tools">
        <button class="small" data-act="dayup" ${ri === 0 ? "disabled" : ""} aria-label="上へ">↑</button>
        <button class="small" data-act="daydown" ${ri === days.length - 1 ? "disabled" : ""} aria-label="下へ">↓</button>
        <button class="small danger" data-act="delday">ルーティンを削除</button>
      </div>
      <ul class="r-ex">`;
    day.exercises.forEach((d, ei) => {
      const open = Routine.open === `${ri}:${ei}`;
      h += `<li data-e="${ei}" class="${open ? "open" : ""}">
        <div class="ex-row">
          <button class="ex-label" data-act="edit"><b>${esc(d.name || "（名前なし）")}</b><small>${esc(d.muscle)} · ${esc(exSummary(d))}</small></button>
          <button class="small" data-act="exup" ${ei === 0 ? "disabled" : ""} aria-label="上へ">↑</button>
          <button class="small" data-act="exdown" ${ei === day.exercises.length - 1 ? "disabled" : ""} aria-label="下へ">↓</button>
        </div>
        ${open ? exForm(d) : ""}
      </li>`;
    });
    h += `</ul><select class="add-ex" data-add aria-label="種目を追加">${addOptions(day)}</select></section>`;
  });
  h += `<button class="wide" data-act="addday">＋ ルーティンを追加</button>`;
  root.innerHTML = h;
  updateSaveBar();
}

function exForm(d) {
  const f = (k, label, attrs) => `<label>${label}<input data-ef="${k}" value="${esc(d[k] == null ? "" : d[k])}" ${attrs || ""}></label>`;
  return `<div class="ex-form">
    ${f("name", "名前", 'class="wide-in"')}
    <label>部位<select data-ef="muscle">${MUSCLES.map((m) => `<option ${m === d.muscle ? "selected" : ""}>${m}</option>`).join("")}</select></label>
    <div class="grid3">
      ${f("sets", "セット", 'inputmode="numeric"')}
      ${f("repMin", d.cardio ? "下限（分）" : "回数 下限", 'inputmode="numeric"')}
      ${f("repMax", d.cardio ? "上限（分）" : "回数 上限", 'inputmode="numeric"')}
    </div>
    ${d.cardio ? "" : `<div class="grid3">
      ${f("rir", "RIR", 'placeholder="1〜2"')}
      ${f("rest", "休憩（秒）", 'inputmode="numeric"')}
      ${f("inc", "刻み kg", 'inputmode="decimal"')}
    </div>
    ${f("start", d.bw ? "開始の加重 kg" : "開始重量 kg", 'inputmode="decimal" placeholder="未設定"')}`}
    <label>メモ<textarea data-ef="note" rows="2">${esc(d.note)}</textarea></label>
    <div class="checks">
      <label class="check-l"><input type="checkbox" data-ef="bw" ${d.bw ? "checked" : ""}> 自重</label>
      <label class="check-l"><input type="checkbox" data-ef="cardio" ${d.cardio ? "checked" : ""}> 有酸素</label>
    </div>
    <div class="row-btns"><button class="small" data-act="close">閉じる</button><button class="small danger" data-act="delex">この種目を外す</button></div>
  </div>`;
}

const NUM_FIELDS = { sets: 1, repMin: 1, repMax: 1, rest: 1, inc: 1, start: 1 };

function bindRoutine(root) {
  const at = (el) => {
    const r = el.closest("[data-r]"), e = el.closest("[data-e]");
    const day = r ? draft()[Number(r.dataset.r)] : null;
    return { ri: r ? Number(r.dataset.r) : -1, ei: e ? Number(e.dataset.e) : -1, day, ex: day && e ? day.exercises[Number(e.dataset.e)] : null };
  };

  root.addEventListener("input", (e) => {
    const t = e.target;
    const { day, ex } = at(t);
    if (t.dataset.rf === "title" && day) { day.title = t.value; markDirty(); return; }
    const k = t.dataset.ef;
    if (!k || !ex || t.type === "checkbox") return;
    if (k === "muscle") return; // change で扱う
    ex[k] = NUM_FIELDS[k] ? (k === "start" ? num(t.value) : (num(t.value) == null ? "" : num(t.value))) : t.value;
    const label = t.closest("li").querySelector(".ex-label");
    label.querySelector("b").textContent = ex.name || "（名前なし）";
    label.querySelector("small").textContent = `${ex.muscle} · ${exSummary(ex)}`;
    markDirty();
  });

  root.addEventListener("change", (e) => {
    const t = e.target;
    const { ri, day, ex } = at(t);
    if (t.dataset.rf === "weekday" && day) { day.weekday = Number(t.value); markDirty(); return; }
    if (t.dataset.ef === "muscle" && ex) { ex.muscle = t.value; markDirty(); renderRoutine(root); return; }
    if (t.type === "checkbox" && ex) {
      ex[t.dataset.ef] = t.checked;
      if (t.dataset.ef === "cardio") {
        ex.unit = t.checked ? "分" : "回";
        if (t.checked) { ex.muscle = "有酸素"; ex.bw = false; }
        else if (ex.muscle === "有酸素") ex.muscle = "胸";
      }
      if (t.dataset.ef === "bw" && t.checked) ex.inc = 0;
      markDirty();
      renderRoutine(root);
      return;
    }
    if (t.matches("[data-add]") && day) {
      const v = t.value;
      if (!v) return;
      let def;
      if (v === "new") {
        def = { id: uid("u_"), name: "新しい種目", muscle: "胸", sets: 3, repMin: 8, repMax: 12, rir: "1〜2", rest: 90, start: null, inc: 2.5, note: "", bw: false, cardio: false };
      } else if (v.startsWith("cat:")) {
        def = defFrom(CATALOG.byId[v.slice(4)]);
      } else {
        const id = v.slice(4);
        const src = draft().flatMap((d) => d.exercises).find((x) => x.id === id);
        def = src ? defFrom(src) : defFrom(defFromRecord(recordedExercises(sortedWorkouts(db.get(db.collection("workouts"))))[id]));
      }
      day.exercises.push(def);
      Routine.open = v === "new" ? `${ri}:${day.exercises.length - 1}` : null;
      markDirty();
      renderRoutine(root);
    }
  });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const days = draft();
    const { ri, ei, day } = at(b);
    const swap = (arr, i, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };
    switch (b.dataset.act) {
      case "addday":
        days.push({ key: uid("d"), title: `ルーティン${days.length + 1}`, weekday: 0, exercises: [] });
        break;
      case "dayup": swap(days, ri, ri - 1); Routine.open = null; break;
      case "daydown": swap(days, ri, ri + 1); Routine.open = null; break;
      case "delday":
        if (!confirmTwice(b, "もう一度押すと削除（記録は残ります）")) return;
        days.splice(ri, 1); Routine.open = null;
        break;
      case "edit": Routine.open = Routine.open === `${ri}:${ei}` ? null : `${ri}:${ei}`; renderRoutine(root); return;
      case "close": Routine.open = null; renderRoutine(root); return;
      case "exup": swap(day.exercises, ei, ei - 1); Routine.open = null; break;
      case "exdown": swap(day.exercises, ei, ei + 1); Routine.open = null; break;
      case "delex":
        if (!confirmTwice(b, "もう一度押すと外す")) return;
        day.exercises.splice(ei, 1); Routine.open = null;
        break;
      default: return;
    }
    markDirty();
    renderRoutine(root);
  });
}

// 下書きを確かめて保存。問題があればメッセージを返す
function saveRoutine() {
  const days = draft();
  for (const day of days) {
    if (!String(day.title || "").trim()) day.title = "（無題）";
    for (const d of day.exercises) {
      if (!String(d.name || "").trim()) return `「${day.title}」に名前のない種目があります`;
      if (!(num(d.sets) >= 1)) return `${d.name}：セット数を1以上にしてください`;
      if (num(d.repMin) == null || num(d.repMax) == null) return `${d.name}：回数の下限と上限を入れてください`;
      if (num(d.repMin) > num(d.repMax)) [d.repMin, d.repMax] = [d.repMax, d.repMin];
      if (num(d.rest) == null) d.rest = 0;
      if (num(d.inc) == null) d.inc = 0;
    }
  }
  try {
    db.set(db.doc("program", "current"), { days, updatedAt: new Date().toISOString() });
  } catch (e) {
    return `保存できませんでした：${e.message}`;
  }
  Routine.draft = null;
  Routine.dirty = false;
  return null;
}

function bindSaveBar() {
  $("#savebar").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "save") {
      const err = saveRoutine();
      $("#savebar-msg").textContent = err || "";
      if (err) return;
    } else if (b.dataset.act === "discard") {
      if (!confirmTwice(b, "もう一度押すと破棄")) return;
      Routine.draft = null;
      Routine.dirty = false;
      Routine.open = null;
    }
    $("#savebar-msg").textContent = "";
    if (currentTab === "routine") renderRoutine($("#tab-routine"));
    updateSaveBar();
  });
  window.addEventListener("beforeunload", (e) => {
    if (Routine.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
}
