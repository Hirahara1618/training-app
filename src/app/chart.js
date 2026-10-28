"use strict";
// 日付を横軸にした小さな SVG グラフ。
// opts: { from, to (YYYY-MM-DD), points: [{date, y}], line?: [{date, y}], unit, dots?: bool }
// 色は CSS（.chart .pt / .ln / .grid）で付ける。

function dateChart(opts) {
  const W = 340, H = 170, L = 38, R = 10, T = 10, B = 24;
  const pts = opts.points || [];
  const line = (opts.line || []).filter((p) => p.y != null);
  const ys = pts.map((p) => p.y).concat(line.map((p) => p.y));
  if (!ys.length) return `<div class="chart-empty">記録がありません</div>`;

  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = Math.max((hi - lo) * 0.12, hi === lo ? Math.max(Math.abs(hi) * 0.02, 0.5) : 0);
  lo -= pad; hi += pad;
  const span = Math.max(1, daysBetween(opts.from, opts.to));
  const x = (d) => L + (W - L - R) * (span === 0 ? 0.5 : daysBetween(opts.from, d) / span);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));

  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const step = hi - lo > 6 ? 1 : 0.1;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || "グラフ")}">`;
  for (const t of ticks) {
    const v = Math.round(t / step) * step;
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    svg += `<text class="ax" x="${L - 4}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${fmtNum(round2(v))}</text>`;
  }
  svg += `<text class="ax" x="${L}" y="${H - 6}">${esc(fmtDateShort(opts.from))}</text>`;
  svg += `<text class="ax" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(fmtDateShort(opts.to))}</text>`;
  if (line.length >= 2) {
    const d = line.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
    svg += `<path class="ln" d="${d}"/>`;
  }
  if (opts.dots !== false) {
    const r = pts.length > 120 ? 1.6 : 2.6;
    for (const p of pts) svg += `<circle class="pt" cx="${x(p.date).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="${r}"/>`;
  }
  svg += `</svg>`;
  return svg;
}

function fmtDateShort(s) {
  const d = parseYmd(s);
  return `${d.getFullYear() % 100}/${d.getMonth() + 1}/${d.getDate()}`;
}
