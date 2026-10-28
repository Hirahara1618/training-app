"use strict";
// 体重タブ：体重と体組成（体脂肪率・ウエスト）の記録、最新・直近7日平均・4週間前との差、期間を選べるグラフ

const Weight = { range: uiGet("bwrange", "1m"), comp: uiGet("bwcomp", "fat"), showAll: false };
const COMP = {
  fat: { label: "体脂肪率", unit: "%" },
  waist: { label: "ウエスト", unit: "cm" },
};

// 体組成の最新と、4週間前（それ以前で一番近い記録）との差
function compStats(entries) {
  if (!entries.length) return null;
  const last = entries[entries.length - 1];
  const ref = entries.filter((e) => e.date <= addDays(last.date, -28)).pop();
  return { latest: last, diff: ref ? last.kg - ref.kg : null };
}

function renderWeight(root) {
  const col = db.get(db.collection("bodyweight"));
  const entries = bwEntries(col);
  const today = todayYmd();
  const rec = col[today] || {};
  const st = bwStats(entries);
  const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmtNum(round2(Math.abs(v)));
  const v = (x) => (num(x) == null ? "" : fmtNum(num(x)));

  let h = `<h2 class="tab-title">体重</h2>
  <form class="card bw-form" id="bw-form">
    <label class="span2">日付<input type="date" id="bw-date" value="${today}" max="${today}"></label>
    <label>体重 kg<input id="bw-kg" inputmode="decimal" placeholder="${st ? fmtNum(st.latest.kg) : "60.0"}" value="${v(rec.kg)}"></label>
    <label>体脂肪率 %<input id="bw-fat" inputmode="decimal" placeholder="任意" value="${v(rec.fat)}"></label>
    <label>ウエスト cm<input id="bw-waist" inputmode="decimal" placeholder="任意" value="${v(rec.waist)}"></label>
    <button class="primary" type="submit">記録</button>
    <p id="bw-msg" class="msg"></p>
  </form>`;

  const comps = { fat: bwEntries(col, "fat"), waist: bwEntries(col, "waist") };
  if (!st && !comps.fat.length && !comps.waist.length) {
    root.innerHTML = h + `<div class="empty"><p>まだ記録がありません。</p></div>`;
    return;
  }
  if (st) {
    h += `<div class="tiles three">
      <div class="tile"><span>最新</span><b>${fmtNum(st.latest.kg)}<small>kg</small></b><em>${esc(fmtDate(st.latest.date))}</em></div>
      <div class="tile"><span>直近7日平均</span><b>${st.avg7 != null ? fmtNum(round2(st.avg7)) : "—"}<small>kg</small></b></div>
      <div class="tile"><span>4週間前比</span><b>${st.diff4w != null ? sign(st.diff4w) : "—"}<small>kg</small></b>${st.diff4w == null ? `<em>4週間前の記録なし</em>` : ""}</div>
    </div>`;
  }
  const cs = Object.fromEntries(Object.keys(COMP).map((k) => [k, compStats(comps[k])]));
  if (cs.fat || cs.waist) {
    h += `<div class="tiles">${Object.keys(COMP).map((k) => {
      const c = cs[k], m = COMP[k];
      return `<div class="tile"><span>${m.label}</span><b>${c ? fmtNum(c.latest.kg) : "—"}<small>${m.unit}</small></b><em>${c ? `${esc(fmtDate(c.latest.date))}${c.diff != null ? `・4週前比 ${sign(c.diff)}` : ""}` : "記録なし"}</em></div>`;
    }).join("")}</div>`;
  }

  h += `<div class="seg" role="tablist">${BW_RANGES.map((r) =>
    `<button data-range="${r.key}" class="${r.key === Weight.range ? "on" : ""}">${r.label}</button>`).join("")}</div>`;
  if (st) {
    const ser = bwSeries(entries, Weight.range, today);
    h += `<div class="card chart-card">
      <h3 class="sub">体重</h3>
      ${dateChart({ from: ser.from, to: ser.to, points: ser.points.map((p) => ({ date: p.date, y: p.kg })), line: ser.points.map((p) => ({ date: p.date, y: p.kg })), label: "体重の推移" })}
      <div class="change">この期間の変化（7日平均）：<b>${ser.change != null ? sign(ser.change) + "kg" : "—"}</b></div>
    </div>`;
  }
  // 体組成のグラフ（体重と同じ期間で並べる）
  if (comps.fat.length || comps.waist.length) {
    const k = comps[Weight.comp].length ? Weight.comp : (comps.fat.length ? "fat" : "waist");
    const ser = bwSeries(entries.length ? entries : comps[k], Weight.range, today);
    const pts = comps[k].filter((e) => e.date >= ser.from && e.date <= ser.to).map((e) => ({ date: e.date, y: e.kg }));
    h += `<div class="card chart-card">
      <div class="comp-head"><h3 class="sub">体組成</h3><div class="seg mini">${Object.keys(COMP).map((c) =>
        `<button data-comp="${c}" class="${c === k ? "on" : ""}">${COMP[c].label}</button>`).join("")}</div></div>
      ${pts.length ? dateChart({ from: ser.from, to: ser.to, points: pts, line: pts, label: `${COMP[k].label}の推移` }) : `<div class="chart-empty">この期間の記録がありません</div>`}
      <div class="legend"><span class="pt-key"></span>${COMP[k].label}（${COMP[k].unit}）</div>
    </div>`;
  }

  const list = Object.values(col).filter((e) => e && typeof e.date === "string").sort((a, b) => (a.date < b.date ? 1 : -1));
  const shown = Weight.showAll ? list : list.slice(0, 14);
  const parts = (e) => [num(e.kg) != null ? `${fmtNum(num(e.kg))} kg` : null, num(e.fat) != null ? `${fmtNum(num(e.fat))}%` : null, num(e.waist) != null ? `${fmtNum(num(e.waist))}cm` : null].filter(Boolean).join("　");
  h += `<h3 class="sub">記録</h3><ul class="records">${shown.map((e) =>
    `<li><span class="r-date">${esc(fmtDate(e.date))}</span><span>${esc(parts(e))}</span>
      <button class="small ghost" data-del="${e.date}">削除</button></li>`).join("")}</ul>`;
  if (list.length > shown.length) h += `<button class="small" data-more>すべて表示（${list.length}件）</button>`;
  root.innerHTML = h;
}

function bindWeight(root) {
  root.addEventListener("submit", (e) => {
    if (e.target.id !== "bw-form") return;
    e.preventDefault();
    const date = $("#bw-date").value;
    const read = (id) => num($(id).value.replace(",", "."));
    const kg = read("#bw-kg"), fat = read("#bw-fat"), waist = read("#bw-waist");
    const bad = (x, lo, hi) => x != null && (x <= lo || x > hi);
    if (!date || (kg == null && fat == null && waist == null) || bad(kg, 0, 400) || bad(fat, 0, 80) || bad(waist, 20, 250)) {
      $("#bw-msg").textContent = "値を確かめてください（体重・体脂肪率・ウエストのどれか1つ以上）";
      return;
    }
    // その日の記録を、入力欄の内容で置き換える（空にした項目は消える）
    const doc = { date, savedAt: new Date().toISOString() };
    if (kg != null) doc.kg = round2(kg);
    if (fat != null) doc.fat = round2(fat);
    if (waist != null) doc.waist = round2(waist);
    try {
      db.set(db.doc("bodyweight", date), doc);
    } catch (err) { $("#bw-msg").textContent = `保存できませんでした：${err.message}`; }
  });
  root.addEventListener("change", (e) => {
    // 日付を変えたら、その日の記録を入力欄に出す
    if (e.target.id !== "bw-date") return;
    const rec = db.get(db.doc("bodyweight", e.target.value)) || {};
    for (const [id, k] of [["#bw-kg", "kg"], ["#bw-fat", "fat"], ["#bw-waist", "waist"]]) $(id).value = num(rec[k]) != null ? fmtNum(num(rec[k])) : "";
  });
  root.addEventListener("click", (e) => {
    const r = e.target.closest("[data-range]");
    if (r) { Weight.range = r.dataset.range; uiSet("bwrange", Weight.range); renderWeight(root); return; }
    const c = e.target.closest("[data-comp]");
    if (c) { Weight.comp = c.dataset.comp; uiSet("bwcomp", Weight.comp); renderWeight(root); return; }
    if (e.target.closest("[data-more]")) { Weight.showAll = true; renderWeight(root); return; }
    const del = e.target.closest("[data-del]");
    if (del && confirmTwice(del)) db.delete(db.doc("bodyweight", del.dataset.del));
  });
}
