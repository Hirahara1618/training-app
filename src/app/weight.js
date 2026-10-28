"use strict";
// 体重タブ：記録、最新・直近7日平均・4週間前との差、期間を選べるグラフ

const Weight = { range: uiGet("bwrange", "1m"), showAll: false };

function renderWeight(root) {
  const entries = bwEntries(db.get(db.collection("bodyweight")));
  const today = todayYmd();
  const todays = entries.find((e) => e.date === today);
  const st = bwStats(entries);
  const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmtNum(round2(Math.abs(v)));

  let h = `<h2 class="tab-title">体重</h2>
  <form class="card bw-form" id="bw-form">
    <label>日付<input type="date" id="bw-date" value="${today}" max="${today}"></label>
    <label>体重 kg<input id="bw-kg" inputmode="decimal" placeholder="${st ? fmtNum(st.latest.kg) : "60.0"}" value="${todays ? fmtNum(todays.kg) : ""}"></label>
    <button class="primary" type="submit">記録</button>
  </form>`;

  if (!st) {
    root.innerHTML = h + `<div class="empty"><p>まだ記録がありません。</p></div>`;
    return;
  }
  h += `<div class="tiles three">
    <div class="tile"><span>最新</span><b>${fmtNum(st.latest.kg)}<small>kg</small></b><em>${esc(fmtDate(st.latest.date))}</em></div>
    <div class="tile"><span>直近7日平均</span><b>${st.avg7 != null ? fmtNum(round2(st.avg7)) : "—"}<small>kg</small></b></div>
    <div class="tile"><span>4週間前比</span><b>${st.diff4w != null ? sign(st.diff4w) : "—"}<small>kg</small></b>${st.diff4w == null ? `<em>4週間前の記録なし</em>` : ""}</div>
  </div>`;

  const ser = bwSeries(entries, Weight.range, today);
  h += `<div class="seg" role="tablist">${BW_RANGES.map((r) =>
    `<button data-range="${r.key}" class="${r.key === Weight.range ? "on" : ""}">${r.label}</button>`).join("")}</div>`;
  h += `<div class="card chart-card">
    ${dateChart({ from: ser.from, to: ser.to, points: ser.points.map((p) => ({ date: p.date, y: p.kg })), line: ser.line.map((p) => ({ date: p.date, y: p.kg })), label: "体重の推移" })}
    <div class="legend"><span class="pt-key"></span>毎日 <span class="ln-key"></span>7日移動平均</div>
    <div class="change">この期間の変化（7日平均）：<b>${ser.change != null ? sign(ser.change) + "kg" : "—"}</b></div>
  </div>`;

  const list = entries.slice().reverse();
  const shown = Weight.showAll ? list : list.slice(0, 14);
  h += `<h3 class="sub">記録</h3><ul class="records">${shown.map((e) =>
    `<li><span class="r-date">${esc(fmtDate(e.date))}</span><span>${fmtNum(e.kg)} kg</span>
      <button class="small ghost" data-del="${e.date}">削除</button></li>`).join("")}</ul>`;
  if (list.length > shown.length) h += `<button class="small" data-more>すべて表示（${list.length}件）</button>`;
  root.innerHTML = h;
}

function bindWeight(root) {
  root.addEventListener("submit", (e) => {
    if (e.target.id !== "bw-form") return;
    e.preventDefault();
    const date = $("#bw-date").value;
    const kg = num($("#bw-kg").value.replace(",", "."));
    if (!date || kg == null || kg <= 0 || kg > 400) { $("#bw-kg").focus(); return; }
    try {
      db.set(db.doc("bodyweight", date), { date, kg: round2(kg), savedAt: new Date().toISOString() });
    } catch (err) { alert(`保存できませんでした：${err.message}`); }
  });
  root.addEventListener("change", (e) => {
    // 日付を変えたら、その日の記録を入力欄に出す
    if (e.target.id !== "bw-date") return;
    const rec = db.get(db.doc("bodyweight", e.target.value));
    $("#bw-kg").value = rec ? fmtNum(num(rec.kg)) : "";
  });
  root.addEventListener("click", (e) => {
    const r = e.target.closest("[data-range]");
    if (r) { Weight.range = r.dataset.range; uiSet("bwrange", Weight.range); renderWeight(root); return; }
    if (e.target.closest("[data-more]")) { Weight.showAll = true; renderWeight(root); return; }
    const del = e.target.closest("[data-del]");
    if (del && confirmTwice(del)) db.delete(db.doc("bodyweight", del.dataset.del));
  });
}
