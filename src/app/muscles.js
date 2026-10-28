"use strict";
// 部位別タブ：部位ごとに最後に鍛えてからの日数、種目ごとの記録と推移

const Muscles = { open: new Set(), detail: null };

// 部位ごとの種目：ルーティンにあるもの＋記録だけあるもの（ルーティン外）
function exercisesByMuscle(workouts) {
  const out = {};
  const add = (m, e) => { (out[m] = out[m] || []).push(e); };
  const inRoutine = new Set();
  for (const day of programDays()) {
    for (const d of day.exercises || []) {
      if (inRoutine.has(d.id)) continue;
      inRoutine.add(d.id);
      add(d.muscle, { id: d.id, name: d.name, cardio: !!d.cardio, bw: !!d.bw, outside: false });
    }
  }
  const rec = recordedExercises(workouts);
  for (const id in rec) {
    if (inRoutine.has(id)) continue;
    const c = CATALOG.byId[id];
    add(rec[id].muscle, { id, name: rec[id].name, cardio: rec[id].cardio, bw: !!(c && c.bw), outside: true });
  }
  return out;
}

function renderMuscles(root) {
  const workouts = sortedWorkouts(db.get(db.collection("workouts")));
  if (Muscles.detail) { renderExerciseDetail(root, workouts, Muscles.detail); return; }
  const last = lastTrainedByMuscle(workouts);
  const byMuscle = exercisesByMuscle(workouts);
  const today = todayYmd();
  let h = `<h2 class="tab-title">部位別</h2><div class="list">`;
  for (const m of MUSCLES) {
    const exs = byMuscle[m] || [];
    const d = last[m] ? daysBetween(last[m], today) : null;
    const cls = d == null ? "none" : d <= 2 ? "fresh" : d >= 7 ? "stale" : "";
    const open = Muscles.open.has(m);
    h += `<div class="muscle ${cls}${open ? " open" : ""}">
      <button class="row" data-muscle="${esc(m)}" aria-expanded="${open}">
        <span class="m-name">${esc(m)}</span>
        <span class="m-days">${d == null ? "記録なし" : `${fmtAgo(d)}`}</span>
        <span class="chev">${open ? "▾" : "▸"}</span>
      </button>`;
    if (open) {
      h += exs.length ? `<ul class="ex-list">${exs.map((e) =>
        `<li><button data-ex="${esc(e.id)}">${esc(e.name)}${e.outside ? `<span class="outside">（ルーティン外）</span>` : ""}</button></li>`).join("")}</ul>`
        : `<p class="muted pad">この部位の種目はまだありません。</p>`;
    }
    h += `</div>`;
  }
  root.innerHTML = h + `</div>`;
}

function renderExerciseDetail(root, workouts, id) {
  const hist = exerciseHistory(workouts, id);
  const def = programDays().flatMap((d) => d.exercises || []).find((e) => e.id === id)
    || CATALOG.byId[id] || (hist.length ? { id, name: hist[hist.length - 1].name, muscle: hist[hist.length - 1].muscle, cardio: hist[0].cardio } : { id, name: id });
  const cardio = !!def.cardio;
  let h = `<button class="back" data-back>‹ 部位別に戻る</button>
    <h2 class="tab-title">${esc(def.name)}</h2>`;
  if (!hist.length) {
    root.innerHTML = h + `<div class="empty"><p>まだ記録がありません。</p></div>`;
    return;
  }
  const first = hist[0].date, lastD = hist[hist.length - 1].date;
  if (cardio) {
    const mins = hist.map((x) => ({ date: x.date, y: x.sets.reduce((a, s) => a + (num(s.r) || 0), 0) }));
    const total = mins.reduce((a, p) => a + p.y, 0);
    h += `<div class="tiles"><div class="tile"><span>合計時間</span><b>${fmtNum(total)}<small>分</small></b></div>
      <div class="tile"><span>回数</span><b>${hist.length}<small>回</small></b></div></div>
      <h3 class="sub">時間の推移（分）</h3>${dateChart({ from: first, to: lastD, points: mins, line: mins, label: "時間の推移" })}`;
  } else {
    // 最高重量（同じ重量なら回数の多いもの）と推定1RM
    let best = null, bestRm = null;
    for (const x of hist) for (const s of x.sets) {
      const w = num(s.w) || 0, r = num(s.r);
      if (r == null || r <= 0) continue;
      if (!best || w > best.w || (w === best.w && r > best.r)) best = { w, r, date: x.date };
      const rm = epley(w, r);
      if (w > 0 && (!bestRm || rm > bestRm.v)) bestRm = { v: rm, w, r, date: x.date };
    }
    const allZero = hist.every((x) => x.sets.every((s) => !num(s.w)));
    h += `<div class="tiles">
      <div class="tile"><span>最高重量</span><b>${best ? esc(fmtLoad(best.w, def.bw)) : "—"}</b>${best ? `<em>${best.r}回・${esc(fmtDateY(best.date))}</em>` : ""}</div>
      <div class="tile"><span>推定1RM</span><b>${bestRm ? fmtNum(round2(bestRm.v)) + "<small>kg</small>" : "—"}</b>${bestRm ? `<em>${fmtNum(bestRm.w)}×${bestRm.r}・${esc(fmtDateY(bestRm.date))}</em>` : ""}</div>
    </div>`;
    // 自重で加重なしの種目は回数の推移を出す
    const pts = hist.map((x) => ({
      date: x.date,
      y: allZero ? Math.max(0, ...x.sets.map((s) => num(s.r) || 0)) : Math.max(...x.sets.map((s) => num(s.w) || 0)),
    }));
    h += `<h3 class="sub">${allZero ? "最多回数の推移" : "重量の推移（その日の最大kg）"}</h3>
      ${dateChart({ from: first, to: lastD, points: pts, line: pts, label: "推移" })}`;
  }
  h += `<h3 class="sub">全記録</h3><ul class="records">`;
  for (const x of hist.slice().reverse()) {
    h += `<li><span class="r-date">${esc(fmtDateY(x.date))}</span><span>${x.sets.map((s) =>
      esc(fmtSet(s, def)) + (s.rir !== "" && s.rir != null && !cardio ? `<small> RIR${esc(s.rir)}</small>` : "")).join("　")}</span></li>`;
  }
  root.innerHTML = h + `</ul>`;
}

function bindMuscles(root) {
  root.addEventListener("click", (e) => {
    const m = e.target.closest("[data-muscle]");
    if (m) {
      const k = m.dataset.muscle;
      Muscles.open.has(k) ? Muscles.open.delete(k) : Muscles.open.add(k);
      renderMuscles(root);
      return;
    }
    const ex = e.target.closest("[data-ex]");
    if (ex) { Muscles.detail = ex.dataset.ex; renderMuscles(root); window.scrollTo(0, 0); return; }
    if (e.target.closest("[data-back]")) { Muscles.detail = null; renderMuscles(root); }
  });
}
