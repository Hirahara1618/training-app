// 手帳の受け入れ条件（CLAUDE.md 4.5）をブラウザで確かめる。
// 使い方: npm run build && node tools/test-app.mjs [画面写真の出力先]
// この PC の Chrome を使う（playwright-core。Chromium はダウンロードしない）。

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "tools/out"));
const PORT = 8091;
const URL = `http://localhost:${PORT}/`;
fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [path.join(ROOT, "tools/serve.mjs"), path.join(ROOT, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
let step = 0;
const ok = (msg) => console.log(`  ok  ${++step}. ${msg}`);

async function newPage(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: opts.dark ? "dark" : "light", acceptDownloads: true,
  });
  // ヘッドレスでは共有シートが出せないので、ダウンロードで書き出させる
  await ctx.addInitScript(() => { Object.defineProperty(navigator, "canShare", { value: undefined }); });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()} ${m.location().url}`); });
  page.on("dialog", (d) => d.accept());
  page.on("requestfailed", (r) => { if (process.env.DEBUG) console.log("    requestfailed", r.url().slice(0, 90), r.failure()?.errorText); });
  return { ctx, page };
}

const data = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("tlog-data-v1") || "null"));
const noHScroll = async (page, where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 375, `${where}: 横スクロールあり（幅 ${w}px）`);
};
const tab = (page, name) => page.click(`[data-tab="${name}"]`);

try {
  // ---- 1. 空の状態から
  const { ctx, page } = await newPage();
  await page.goto(URL);
  await page.waitForSelector("#tab-today .empty");
  assert.match(await page.textContent("#tab-today"), /まだルーティンがありません/);
  assert.equal(await data(page), null, "開いただけで保存してはいけない");
  ok("空の状態で起動（何も保存しない）");

  // ---- 2. ルーティン作成 → カタログから3種目（筋トレ2・有酸素1）→ 保存
  await page.click("[data-go=routine]");
  await page.click("[data-act=addday]");
  await page.fill(".r-title", "胸の日");
  const wd = await page.evaluate(() => { const g = new Date().getDay(); return String(g === 0 ? 7 : g); });
  await page.selectOption('[data-rf="weekday"]', wd);
  for (const id of ["bench", "c_dbcurl", "c_run"]) await page.selectOption("[data-add]", `cat:${id}`);
  assert.equal(await page.isVisible("#savebar"), true, "保存バーが出る");
  assert.equal(await data(page), null, "保存するまでは下書き");
  await page.screenshot({ path: path.join(OUT, "routine-edit.png"), fullPage: true });
  await page.click("#savebar [data-act=save]");
  let d = await data(page);
  assert.equal(d.program.current.days.length, 1);
  assert.deepEqual(d.program.current.days[0].exercises.map((e) => e.id), ["bench", "c_dbcurl", "c_run"]);
  assert.equal(await page.isVisible("#savebar"), false);
  ok("ルーティン作成・カタログから3種目追加・保存");

  // 種目の編集（刻みを2.3に）と並べ替え
  await page.click('[data-e="0"] [data-act=edit]');
  await page.fill('[data-ef="inc"]', "2.3");
  await page.click('[data-e="1"] [data-act=exup]');
  await page.click("#savebar [data-act=save]");
  d = await data(page);
  assert.deepEqual(d.program.current.days[0].exercises.map((e) => e.id), ["c_dbcurl", "bench", "c_run"]);
  assert.equal(d.program.current.days[0].exercises.find((e) => e.id === "bench").inc, 2.3);
  ok("種目の編集（刻み2.3kg）と並べ替え");

  // ---- 3. 今日タブで記録
  await tab(page, "today");
  await page.waitForSelector(".card.ex");
  assert.equal(await page.locator(".card.ex").count(), 3);
  const bench = page.locator('.card.ex:has(h3:text-is("ベンチプレス"))');
  await bench.locator('[data-s="0"] [data-f=w]').fill("60");
  await bench.locator('[data-s="0"] [data-f=r]').fill("8");
  await bench.locator('[data-s="0"] [data-f=rir]').selectOption("2");
  await bench.locator('[data-s="0"] [data-act=done]').click();
  assert.equal(await page.isVisible("#timer"), true, "休憩タイマーが出る");
  assert.match(await page.textContent("#timer-left"), /^[23]:\d\d$/);
  await page.click('#timer [data-t="15"]');
  // ✓で回数が空なら下限回数が入る
  await bench.locator('[data-s="1"] [data-f=w]').fill("60");
  await bench.locator('[data-s="1"] [data-act=done]').click();
  assert.equal(await bench.locator('[data-s="1"] [data-f=r]').inputValue(), "5");
  const run = page.locator('.card.ex:has(h3:text-is("ランニング（トレッドミル）"))');
  assert.equal(await run.locator("[data-act=done]").count(), 0, "有酸素に✓・タイマーなし");
  await run.locator("[data-f=r]").fill("30");
  await run.locator("[data-f=w]").fill("5.2");
  await run.locator("[data-f=lv]").fill("傾斜3");
  assert.match(await page.textContent("#save-status"), /未保存/);
  await page.waitForFunction(() => document.querySelector("#save-status").textContent === "保存済み", null, { timeout: 3000 });
  await page.screenshot({ path: path.join(OUT, "today-light.png"), fullPage: true });
  await noHScroll(page, "今日");
  ok("今日タブで記録（✓で下限回数・タイマー・700msで自動保存）");

  // ---- 4. 再読み込みしても残る
  await page.reload();
  await page.waitForSelector(".card.ex");
  const b2 = page.locator('.card.ex:has(h3:text-is("ベンチプレス"))');
  assert.equal(await b2.locator('[data-s="0"] [data-f=w]').inputValue(), "60");
  assert.equal(await b2.locator('[data-s="0"] [data-f=rir]').inputValue(), "2");
  assert.equal(await b2.locator('[data-s="1"] [data-act=done]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('.card.ex:has(h3:text-is("ランニング（トレッドミル）")) [data-f=lv]').inputValue(), "傾斜3");
  d = await data(page);
  const w = Object.values(d.workouts)[0];
  assert.equal(w.title, "胸の日");
  assert.deepEqual(w.exercises.map((e) => e.id).sort(), ["bench", "c_run"], "記録のない種目は保存しない");
  ok("再読み込みしても記録が残る");

  // 前回の記録と次回の提案（翌週の同じ曜日に移る）
  for (let i = 0; i < 7; i++) await page.click("[data-act=next]");
  const b3 = page.locator('.card.ex:has(h3:text-is("ベンチプレス"))');
  assert.match(await b3.locator(".prev").textContent(), /前回 .*7日前.*60×8.*60×5/);
  assert.match(await b3.locator(".sugg").textContent(), /60kg のまま/);
  ok("翌週に前回の記録（7日前）と提案が出る");

  // ---- 5. 履歴・部位別に記録が出る
  await tab(page, "history");
  assert.match(await page.textContent("#tab-history .card.hist"), /胸の日[\s\S]*ベンチプレス[\s\S]*60×8/);
  assert.match(await page.textContent(".vol-row:has-text('胸')"), /2$/);
  assert.match(await page.textContent(".notice"), /まだバックアップ/);
  await page.screenshot({ path: path.join(OUT, "history-light.png"), fullPage: true });
  await noHScroll(page, "履歴");
  await tab(page, "muscles");
  assert.match(await page.textContent(".muscle:has-text('胸')"), /今日/);
  await page.click("[data-muscle='胸']");
  await page.click("[data-ex=bench]");
  assert.match(await page.textContent("#tab-muscles .tiles"), /最高重量\s*60kg/);
  assert.match(await page.textContent("#tab-muscles .tiles"), /推定1RM\s*76/);
  await page.screenshot({ path: path.join(OUT, "muscles-detail-light.png"), fullPage: true });
  await noHScroll(page, "部位別");
  ok("履歴（今週のセット数・直近の記録）と部位別（最高重量・推定1RM）に出る");

  // 体重
  await tab(page, "weight");
  await page.fill("#bw-kg", "70.5");
  await page.click("#bw-form button[type=submit]");
  await page.waitForSelector("#tab-weight .tiles");
  assert.match(await page.textContent("#tab-weight .tiles"), /最新\s*70\.5/);
  await page.click("[data-range='3m']");
  assert.equal(await page.evaluate(() => localStorage.getItem("tlog-ui-bwrange")), '"3m"');
  await noHScroll(page, "体重");
  ok("体重の記録・期間の選択を保存");

  // ---- 6. 書き出し → 別のブラウザで読み込み
  await tab(page, "history");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-act=export]")]);
  const file = path.join(OUT, "backup.json");
  await dl.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(backup.app, "saijo-training-log");
  assert.equal(backup.format, 1);
  assert.equal(await page.locator(".notice").count(), 0, "書き出し後は知らせが消える");
  const before = await data(page);

  const other = await newPage({ dark: true });
  await other.page.goto(URL);
  await other.page.waitForSelector("#tab-today .empty");
  await other.page.click('[data-tab="history"]');
  await other.page.setInputFiles("#import-file", file);
  await other.page.waitForFunction(() => localStorage.getItem("tlog-data-v1"));
  assert.deepEqual(await data(other.page), before);
  await other.page.click('[data-tab="today"]');
  await other.page.waitForSelector(".card.ex");
  await other.page.screenshot({ path: path.join(OUT, "today-dark.png"), fullPage: true });
  await other.page.click('[data-tab="weight"]');
  await other.page.screenshot({ path: path.join(OUT, "weight-dark.png"), fullPage: true });
  await other.page.click('[data-tab="routine"]');
  await other.page.click('[data-e="1"] [data-act=edit]');
  await other.page.screenshot({ path: path.join(OUT, "routine-dark.png"), fullPage: true });
  await noHScroll(other.page, "ルーティン");
  await other.ctx.close();
  ok("書き出したJSONを別のブラウザで読み込むと同じ状態になる");

  // ---- 7. 機内モードでも開いて記録できる
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // SW の管理下で開き直してキャッシュを満たす
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector(".tabs");
  await tab(page, "weight");
  await page.fill("#bw-date", await page.evaluate(() => { const d = new Date(Date.now() - 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }));
  await page.fill("#bw-kg", "70.9");
  await page.click("#bw-form button[type=submit]");
  assert.equal(Object.keys((await data(page)).bodyweight).length, 2);
  await page.goto(URL + "model.html?app=1#bench");
  assert.match(await page.textContent("body"), /筋肉模型/);
  await ctx.setOffline(false);
  ok("機内モード（オフライン）で開いて記録できる・模型ページもキャッシュから開く");

  // ---- 8. 既存のデータを上書きしない
  const keep = await newPage();
  const seed = { program: { current: { days: [{ key: "x", title: "既存", weekday: 0, exercises: [] }], updatedAt: "2025-01-01" } }, workouts: {}, bodyweight: {}, extra: 1 };
  await keep.ctx.addInitScript((s) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("tlog-data-v1", s); sessionStorage.setItem("seeded", "1"); } }, JSON.stringify(seed));
  await keep.page.goto(URL);
  await keep.page.waitForSelector(".tabs");
  for (const t of ["muscles", "weight", "history", "routine", "today"]) await keep.page.click(`[data-tab="${t}"]`);
  assert.deepEqual(await data(keep.page), seed);
  // 壊れたデータでも上書きしない
  await keep.page.evaluate(() => localStorage.setItem("tlog-data-v1", "{壊れた"));
  await keep.page.reload();
  assert.match(await keep.page.textContent("#banner"), /保存を止めています/);
  assert.equal(await keep.page.evaluate(() => localStorage.getItem("tlog-data-v1")), "{壊れた");
  await keep.ctx.close();
  ok("既存のデータ・読めないデータを上書きしない");

  assert.deepEqual(errors, [], "ページのエラー");
  ok("ページのエラーなし");
  console.log(`すべて通過。画面写真: ${OUT}`);
} catch (e) {
  console.error(`  NG  ${step + 1}. ${e.message}`);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
