"use strict";
// 今日タブ：その日のルーティンを記録する

const RIR_OPTIONS = ["", "0", "1", "2", "3", "4+"];

const Today = {
  date: todayYmd(),
  // 日付ごとに選んだルーティン（自動で選んだものと違うときだけ）
  chosen: {},
  wk: null,          // 表示中の記録 { date, dayKey, title, exercises: [{def, sets}] }
  status: "saved",   // unsaved | saving | saved | error
  save: null,        // デバウンスした保存関数
};

function programDays() {
  const p = db.get(db.doc("program", "current"));
  return (p && Array.isArray(p.days)) ? p.days : [];
}

function workoutId(date, dayKey) { return `${date}_${dayKey}`; }

function workoutsOn(date) {
  return Object.values(db.get(db.collection("workouts"))).filter((w) => w && w.date === date);
}

// その日に表示するルーティン：選んだもの → その日の記録 → 曜日が合うもの
function pickDayKey(date) {
  if (Today.chosen[date]) return Today.chosen[date];
  const ws = workoutsOn(date);
  if (ws.length) return ws[0].dayKey;
  const wd = weekdayOf(date);
  const r = programDays().find((d) => Number(d.weekday) === wd);
  return r ? r.key : null;
}

// 記録にしか残っていない種目の定義を、カタログか記録から作る
function defFromRecord(e) {
  const c = CATALOG.byId[e.id];
  const base = c ? clone(c) : { sets: (e.sets || []).length || 3, repMin: 8, repMax: 12, rir: "", rest: 90, inc: 2.5, note: "", start: null, bw: false };
  return Object.assign(base, { id: e.id, name: e.name || base.name, muscle: e.muscle || base.muscle, cardio: !!e.cardio });
}

function emptySet(def) { return def.cardio ? { w: "", r: "", lv: "" } : { w: "", r: "", rir: "", done: false }; }

function buildWorkout(date, dayKey) {
  const routine = programDays().find((d) => d.key === dayKey) || null;
  const saved = db.get(db.doc("workouts", workoutId(date, dayKey)));
  const exercises = [];
  const seen = new Set();
  for (const def of (routine ? routine.exercises : [])) {
    const se = saved && (saved.exercises || []).find((e) => e.id === def.id);
    const sets = se && se.sets && se.sets.length ? se.sets : [];
    while (sets.length < (num(def.sets) || 1)) sets.push(emptySet(def));
    exercises.push({ def, sets });
    seen.add(def.id);
  }
  // ルーティンから外した種目でも、その日の記録は表示する
  for (const e of (saved ? saved.exercises || [] : [])) {
    if (seen.has(e.id)) continue;
    exercises.push({ def: defFromRecord(e), sets: e.sets && e.sets.length ? e.sets : [emptySet(e)], removed: true });
  }
  return { date, dayKey, title: routine ? routine.title : (saved ? saved.title : ""), exercises };
}

function saveWorkout() {
  const wk = Today.wk;
  if (!wk || !wk.dayKey) return;
  const ref = db.doc("workouts", workoutId(wk.date, wk.dayKey));
  const exercises = wk.exercises
    .filter((x) => x.sets.some(setHasData))
    .map((x) => {
      const e = { id: x.def.id, name: x.def.name, muscle: x.def.muscle, sets: x.sets };
      if (x.def.cardio) e.cardio = true;
      return e;
    });
  setStatus("saving");
  try {
    if (exercises.length) {
      db.set(ref, { date: wk.date, dayKey: wk.dayKey, title: wk.title, updatedAt: new Date().toISOString(), exercises });
    } else if (db.get(ref)) {
      db.delete(ref);
    }
    setStatus("saved");
  } catch (e) {
    setStatus("error", e.message);
  }
}

function setStatus(s, msg) {
  Today.status = s;
  const el = $("#save-status");
  if (!el) return;
  const text = { unsaved: "未保存", saving: "保存中…", saved: "保存済み", error: "保存できません" }[s];
  el.textContent = msg ? `${text}：${msg}` : text;
  el.className = `status ${s}`;
}

function flushToday() { if (Today.save) Today.save.flush(); }

function renderToday(root) {
  flushToday();
  const date = Today.date;
  const days = programDays();
  const dayKey = pickDayKey(date);
  Today.wk = dayKey ? buildWorkout(date, dayKey) : null;

  // 選べるルーティン：現行のもの＋その日の記録にだけあるもの
  const opts = days.map((d) => ({ key: d.key, title: d.title || "（無題）", wd: Number(d.weekday) }));
  for (const w of workoutsOn(date)) {
    if (!opts.some((o) => o.key === w.dayKey)) opts.push({ key: w.dayKey, title: `${w.title || "（無題）"}（削除済み）`, wd: 0 });
  }

  let h = `<div class="today-head">
    <div class="date-nav">
      <button class="icon" data-act="prev" aria-label="前の日">‹</button>
      <label class="date-pick"><span>${esc(fmtDate(date))}</span><input type="date" id="today-date" value="${date}"></label>
      <button class="icon" data-act="next" aria-label="次の日">›</button>
      ${date !== todayYmd() ? `<button class="small" data-act="today">今日</button>` : ""}
    </div>
    <select id="today-day" aria-label="ルーティン">
      <option value="">${opts.length ? "ルーティンを選ぶ" : "ルーティンがありません"}</option>
      ${opts.map((o) => `<option value="${esc(o.key)}" ${o.key === dayKey ? "selected" : ""}>${esc(o.title)}${o.wd ? `（${WD_NAMES[o.wd]}）` : ""}</option>`).join("")}
    </select>
  </div>`;

  if (!days.length && !Today.wk) {
    h += `<div class="empty"><p>まだルーティンがありません。</p><button class="primary" data-go="routine">ルーティンを作る</button></div>`;
  } else if (!Today.wk) {
    h += `<div class="empty"><p>${esc(fmtDate(date))}のルーティンはありません。<br>上で選ぶと記録できます。</p></div>`;
  } else {
    h += `<div class="wk-title"><h2>${esc(Today.wk.title || "（無題）")}</h2><span id="save-status" class="status"></span></div>`;
    if (!Today.wk.exercises.length) h += `<div class="empty"><p>このルーティンには種目がありません。</p><button data-go="routine">種目を追加する</button></div>`;
    const workouts = sortedWorkouts(db.get(db.collection("workouts")));
    Today.wk.exercises.forEach((x, i) => { h += exerciseCard(x, i, workouts); });
  }
  root.innerHTML = h;
  setStatus(Today.status === "error" ? "error" : "saved");
}

function exerciseCard(x, i, workouts) {
  const d = x.def;
  const prev = lastRecord(workouts, d.id, Today.date);
  const sg = suggest(d, prev);
  const unit = d.unit || (d.cardio ? "分" : "回");
  const reps = num(d.repMin) === num(d.repMax) ? `${d.repMax}` : `${d.repMin}–${d.repMax}`;
  let h = `<section class="card ex${d.cardio ? " cardio" : ""}" data-i="${i}">
    <header><h3>${esc(d.name)}</h3><span class="chip">${esc(d.muscle)}</span></header>`;
  if (x.removed) h += `<div class="meta warn">ルーティンにない種目（この日の記録）</div>`;
  if (d.cardio) {
    h += `<div class="target">目標 <b>${reps}${unit}</b></div>`;
  } else {
    const w = sg ? fmtLoad(sg.w, d.bw) : "重量未定";
    h += `<div class="target">目標 <b>${esc(w)}</b> × ${reps}${unit} × ${d.sets}セット</div>`;
    const meta = [];
    if (d.rir !== "" && d.rir != null) meta.push(`RIR ${esc(d.rir)}`);
    if (num(d.rest)) meta.push(`休憩 ${fmtSec(d.rest)}`);
    if (meta.length) h += `<div class="meta">${meta.join(" · ")}</div>`;
  }
  if (prev) {
    h += `<div class="prev">前回 ${esc(fmtDate(prev.date))}・${fmtAgo(daysBetween(prev.date, Today.date))}：${prev.sets.map((s) => esc(fmtSet(s, d))).join("　")}</div>`;
  }
  if (sg && prev) h += `<div class="sugg${sg.up ? " up" : ""}">${sg.up ? "▲ " : ""}次回の提案：${esc(sg.reason)}</div>`;
  if (d.note) h += `<div class="note">${esc(d.note)}</div>`;

  h += `<div class="sets">`;
  if (d.cardio) {
    h += `<div class="set head cardio"><span>#</span><span>分</span><span>km</span><span>強度</span></div>`;
  } else {
    h += `<div class="set head"><span>#</span><span>${d.bw ? "加重kg" : "kg"}</span><span>${unit}</span><span>RIR</span><span></span></div>`;
  }
  x.sets.forEach((s, j) => { h += setRow(d, s, j, sg); });
  h += `</div><div class="card-actions">
    <button class="small" data-act="addset">＋セット</button>
    ${x.sets.length > 1 ? `<button class="small" data-act="delset">−セット</button>` : ""}
    ${hasModel(d.id) ? `<a class="model-link" href="model.html?app=1#${encodeURIComponent(d.id)}">▶ 動きと使う筋肉を見る</a>` : ""}
  </div></section>`;
  return h;
}

function setRow(d, s, j, sg) {
  if (d.cardio) {
    return `<div class="set cardio" data-s="${j}"><span class="no">${j + 1}</span>
      <input inputmode="decimal" data-f="r" value="${esc(s.r)}" placeholder="${esc(d.repMax)}" aria-label="分">
      <input inputmode="decimal" data-f="w" value="${esc(s.w)}" placeholder="km" aria-label="km">
      <input data-f="lv" value="${esc(s.lv)}" placeholder="傾斜・負荷など" aria-label="強度">
    </div>`;
  }
  const wPh = sg ? fmtNum(sg.w) : (d.bw ? "0" : "kg");
  return `<div class="set${s.done ? " done" : ""}" data-s="${j}"><span class="no">${j + 1}</span>
    <input inputmode="decimal" data-f="w" value="${esc(s.w)}" placeholder="${esc(wPh)}" aria-label="重量">
    <input inputmode="numeric" data-f="r" value="${esc(s.r)}" placeholder="${esc(d.repMax)}" aria-label="回数">
    <select data-f="rir" aria-label="RIR">${RIR_OPTIONS.map((o) => `<option value="${o}" ${String(s.rir == null ? "" : s.rir) === o ? "selected" : ""}>${o === "" ? "–" : o}</option>`).join("")}</select>
    <button class="check" data-act="done" aria-pressed="${s.done ? "true" : "false"}" aria-label="完了">✓</button>
  </div>`;
}

function changed() {
  setStatus("unsaved");
  Today.save();
}

function bindToday(root) {
  Today.save = debounce(saveWorkout, 700);

  root.addEventListener("input", (e) => {
    const f = e.target.dataset.f;
    if (!f || !Today.wk) return;
    const i = Number(e.target.closest("[data-i]").dataset.i);
    const j = Number(e.target.closest("[data-s]").dataset.s);
    const v = e.target.value;
    Today.wk.exercises[i].sets[j][f] = (f === "w" || f === "r") ? (num(v) == null ? "" : num(v)) : v;
    changed();
  });

  root.addEventListener("change", (e) => {
    if (e.target.id === "today-date") {
      if (!e.target.value) return;
      flushToday();
      Today.date = e.target.value;
      renderToday(root);
    } else if (e.target.id === "today-day") {
      flushToday();
      Today.chosen[Today.date] = e.target.value || null;
      renderToday(root);
    }
  });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "prev" || act === "next" || act === "today") {
      flushToday();
      Today.date = act === "today" ? todayYmd() : addDays(Today.date, act === "prev" ? -1 : 1);
      renderToday(root);
      return;
    }
    const card = b.closest("[data-i]");
    if (!card || !Today.wk) return;
    const x = Today.wk.exercises[Number(card.dataset.i)];
    if (act === "done") {
      const row = b.closest("[data-s]");
      const s = x.sets[Number(row.dataset.s)];
      s.done = !s.done;
      if (s.done && num(s.r) == null && num(x.def.repMin) != null) {
        s.r = num(x.def.repMin);
        $('[data-f="r"]', row).value = s.r;
      }
      row.classList.toggle("done", s.done);
      b.setAttribute("aria-pressed", s.done ? "true" : "false");
      if (s.done) RestTimer.start(x.def.rest);
      changed();
    } else if (act === "addset") {
      x.sets.push(emptySet(x.def));
      changed();
      rerenderCard(root, card, x);
    } else if (act === "delset") {
      const last = x.sets[x.sets.length - 1];
      if (setHasData(last) && !confirmTwice(b, "記録ごと消す？")) return;
      x.sets.pop();
      changed();
      rerenderCard(root, card, x);
    }
  });
}

function rerenderCard(root, card, x) {
  const workouts = sortedWorkouts(db.get(db.collection("workouts")));
  const i = Number(card.dataset.i);
  card.outerHTML = exerciseCard(x, i, workouts);
}
