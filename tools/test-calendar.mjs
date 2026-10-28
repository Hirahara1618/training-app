// カレンダー・達成率（履歴タブ）、今日の進み具合、体重の折れ線をブラウザで確かめる。
// 使い方: npm run build && node tools/test-calendar.mjs [画面写真の出力先]
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "tools/out"));
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8094;
const server = spawn(process.execPath, [path.join(ROOT, "tools/serve.mjs"), path.join(ROOT, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: "chrome", headless: true });
let step = 0;
const ok = (m) => console.log(`  ok  ${++step}. ${m}`);
const errors = [];

// 作った記録：月・木にルーティン、直近6週ほど。ときどき休み・一部だけ
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const days = [
  { key: "a", title: "胸の日", weekday: 1, exercises: [{ id: "bench", name: "ベンチプレス", muscle: "胸", sets: 3, repMin: 5, repMax: 8, rir: "1〜2", rest: 60, start: 60, inc: 2.5, note: "" }] },
  { key: "b", title: "脚の日", weekday: 4, exercises: [{ id: "squat", name: "バックスクワット", muscle: "前もも", sets: 3, repMin: 5, repMax: 8, rir: "1〜2", rest: 60, start: 80, inc: 2.5, note: "" }] },
];
// 今日が月・木でなければ今日の曜日のルーティンを足す（どの曜日・時間帯に流しても今日の進み具合を確かめる）
const wdToday = today.getDay() === 0 ? 7 : today.getDay();
if (wdToday !== 1 && wdToday !== 4) days.push({ key: "c", title: "背中の日", weekday: wdToday, exercises: [{ id: "latpd", name: "ラット・プルダウン", muscle: "背中", sets: 3, repMin: 8, repMax: 12, rir: "1〜2", rest: 60, start: 40, inc: 2.5, note: "" }] });
const workouts = {}, bodyweight = {};
for (let k = 45; k >= 1; k--) {
  const d = new Date(today); d.setDate(d.getDate() - k);
  const g = d.getDay(), date = ymd(d);
  bodyweight[date] = { date, kg: Math.round((70 - k * 0.03 + Math.sin(k) * 0.4) * 10) / 10, savedAt: "" };
  if ((g === 1 || g === 4) && k % 9 !== 0) {
    const r = days[g === 1 ? 0 : 1];
    const n = k % 5 === 0 ? 2 : 3;
    workouts[`${date}_${r.key}`] = { date, dayKey: r.key, title: r.title, exercises: [{ id: r.exercises[0].id, name: r.exercises[0].name, muscle: r.exercises[0].muscle,
      sets: Array.from({ length: n }, () => ({ w: 60, r: 6, rir: "1", done: true })) }] };
  }
}
const DATA = { program: { current: { updatedAt: "", days } }, workouts, bodyweight };

try {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: process.env.TZ || undefined });
  await ctx.addInitScript((d) => { if (!localStorage.getItem("tlog-data-v1")) localStorage.setItem("tlog-data-v1", d); }, JSON.stringify(DATA));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.click('[data-tab="history"]');
  await page.waitForSelector("#calendar .cal-grid");
  const nFull = await page.$$eval("#calendar .cal-d.full", (a) => a.length);
  assert.ok(nFull > 0, "全セット完了の日がある");
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 375, `横スクロールなし（${w}px）`);
  await page.locator("#calendar").screenshot({ path: path.join(OUT, "calendar.png") });
  ok(`カレンダーを表示（完了の日 ${nFull}）`);

  // 前の月へ → 戻る
  const title = await page.textContent("#calendar .sub");
  await page.click('#calendar [data-cal="-1"]');
  assert.notEqual(await page.textContent("#calendar .sub"), title);
  assert.ok(await page.$$eval("#calendar .cal-d.full, #calendar .cal-d.part", (a) => a.length) > 0, "前の月にも記録");
  await page.click('#calendar [data-cal="1"]');
  assert.equal(await page.textContent("#calendar .sub"), title);
  assert.equal(await page.isDisabled('#calendar [data-cal="1"]'), true, "今月より先へは進めない");
  ok("月の切り替え");

  // 日をタップ → その日の今日タブ
  const day = await page.getAttribute("#calendar .cal-d.full", "data-calday");
  await page.click(`#calendar [data-calday="${day}"]`);
  await page.waitForSelector("#tab-today:not([hidden]) #progress");
  assert.match(await page.textContent("#progress"), /全セット完了/);
  ok("日をタップするとその日の記録が開く");

  // 今日：進み具合が✓で増える
  await page.click('#tab-today [data-act="today"]').catch(() => {});
  await page.waitForSelector("#tab-today .set");
  const before = await page.textContent("#progress");
  await page.click('.set[data-s="0"] [data-act=done]');
  const after = await page.textContent("#progress");
  assert.notEqual(before, after);
  assert.match(after, /1 \/ 3 セット完了（33%）/);
  await page.click('#timer [data-t="stop"]');
  await page.screenshot({ path: path.join(OUT, "today-progress.png") });
  ok("今日の進み具合が✓で増える");

  // 体重：毎日の値をつないだ折れ線（線の頂点の数＝点の数）
  await page.click('[data-tab="weight"]');
  await page.click('[data-range="1m"]').catch(() => {});
  await page.waitForSelector("#tab-weight svg.chart");
  const { pts, verts } = await page.$eval("#tab-weight svg.chart", (s) => ({
    pts: s.querySelectorAll("circle.pt").length,
    verts: (s.querySelector("path.ln")?.getAttribute("d").match(/[ML]/g) || []).length,
  }));
  assert.ok(pts > 5 && pts === verts, `点 ${pts} と線の頂点 ${verts} が一致`);
  assert.doesNotMatch(await page.textContent("#tab-weight"), /7日移動平均/);
  await page.locator("#tab-weight .chart-card").first().screenshot({ path: path.join(OUT, "weight-line.png") });
  ok("体重は毎日の値の折れ線");

  assert.deepEqual(errors, []);
  console.log("すべて通過");
} catch (e) {
  console.error(e); process.exitCode = 1;
} finally {
  await browser.close(); server.kill();
}
