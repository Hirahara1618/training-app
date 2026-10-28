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

const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
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
  // 模型を一度開く（メッシュがキャッシュに入る）
  await page.goto(URL + "model.html?app=1#bench");
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.goto(URL);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector(".tabs");
  await tab(page, "weight");
  await page.fill("#bw-date", await page.evaluate(() => { const d = new Date(Date.now() - 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }));
  await page.fill("#bw-kg", "70.9");
  await page.click("#bw-form button[type=submit]");
  assert.equal(Object.keys((await data(page)).bodyweight).length, 2);
  await page.goto(URL + "model.html?app=1#bench");
  await page.waitForFunction(() => window.__ready || !document.querySelector("#fail").hidden, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__ready), true, `オフラインで模型が出ない: ${await page.textContent("#fail")}`);
  assert.equal(await page.isVisible(".back"), true, "?app=1 で「手帳に戻る」が出る");
  await page.click(".back");
  await page.waitForSelector(".tabs");
  await ctx.setOffline(false);
  ok("機内モード（オフライン）で開いて記録できる・模型もキャッシュから表示・手帳に戻れる");

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

  // ---- 9. 現行版（1ファイル版）の形のデータがそのまま読めるか
  // weekday のないルーティン（キー名で曜日を決める）、文字列の数値、有酸素、体重、現行版のキーの書き出し日
  const todayStr = await page.evaluate(() => todayYmd());
  const wdKey = await page.evaluate(() => ["", "mon", "tue", "wed", "thu", "fri", "sat", "sun"][weekdayOf(todayYmd())]);
  const prev = await page.evaluate(() => addDays(todayYmd(), -7));
  const old = {
    program: { current: { updatedAt: "2026-10-01", days: [
      { key: wdKey, title: "旧・今日の曜日", exercises: [
        { id: "bench", name: "ベンチプレス", muscle: "胸", sets: "3", repMin: "5", repMax: "8", rir: "1〜2", rest: "180", start: null, inc: "2.5", note: "旧メモ" },
        { id: "c_run", name: "ランニング（トレッドミル）", muscle: "有酸素", cardio: true, sets: 1, repMin: 20, repMax: 30, rir: "", rest: 0, inc: 0 },
      ] },
      { key: "zzz", title: "旧・曜日なし", exercises: [] },
    ] } },
    workouts: {
      [`${prev}_${wdKey}`]: { date: prev, dayKey: wdKey, title: "旧・今日の曜日", updatedAt: "2026-10-21T10:00:00.000Z", exercises: [
        { id: "bench", name: "ベンチプレス", muscle: "胸", sets: [{ w: "60", r: "8", rir: "1", done: true }, { w: "60", r: "8", rir: "", done: true }, { w: "60", r: "8", rir: "2", done: false }] },
        { id: "c_run", name: "ランニング（トレッドミル）", muscle: "有酸素", cardio: true, sets: [{ w: "5", r: "30", lv: "傾斜2", done: false }] },
      ] },
    },
    bodyweight: { [prev]: { date: prev, kg: 70.2, savedAt: "2026-10-21T07:00:00.000Z" } },
  };
  const legacy = await newPage();
  await legacy.ctx.addInitScript(([s, lb]) => {
    if (!sessionStorage.getItem("seeded")) { localStorage.setItem("tlog-data-v1", s); localStorage.setItem("tlog-lastbackup", lb); sessionStorage.setItem("seeded", "1"); }
  }, [JSON.stringify(old), new Date(Date.now() - 3 * 86400000).toISOString()]);
  const lp = legacy.page;
  await lp.goto(URL);
  await lp.waitForSelector("#tab-today .card.ex");
  assert.match(await lp.textContent("#tab-today .wk-title"), /旧・今日の曜日/, "キー名から曜日を決めて今日のルーティンを出す");
  const lb = lp.locator('.card.ex:has(h3:text-is("ベンチプレス"))');
  assert.match(await lb.locator(".prev").textContent(), /7日前.*60×8.*60×8.*60×8/);
  assert.match(await lb.locator(".sugg").textContent(), /\+2\.5kg/, "全セット上限 → 増量の提案（文字列の数値でも）");
  assert.match(await lb.locator(".target").textContent(), /62\.5kg/);
  assert.match(await lb.textContent(), /旧メモ/);
  await lp.click('[data-tab="history"]');
  assert.equal(await lp.locator(".notice").count(), 0, "現行版の書き出し日（3日前）を引き継ぐ");
  assert.match(await lp.textContent(".card.hist"), /60×8/);
  await lp.click('[data-tab="muscles"]');
  await lp.click("[data-muscle='有酸素']");
  await lp.click("[data-ex=c_run]");
  assert.match(await lp.textContent("#tab-muscles .tiles"), /合計時間\s*30/);
  await lp.click('[data-tab="weight"]');
  assert.match(await lp.textContent("#tab-weight .tiles"), /70\.2/);
  await lp.click('[data-tab="routine"]');
  assert.equal(await lp.locator('.routine[data-r="0"] [data-rf="weekday"]').inputValue(), String(await lp.evaluate(() => weekdayOf(todayYmd()))));
  assert.deepEqual(await data(lp), old, "開いて見て回っただけでは書き換えない");
  // 現行版の書き出しファイル（包まれた形・包まれていない形）を読み込める
  for (const [name, body] of [["wrapped", { app: "saijo-training-log", format: 1, exportedAt: "2026-10-20T00:00:00Z", data: old }], ["raw", old]]) {
    const f = path.join(OUT, `legacy-${name}.json`);
    fs.writeFileSync(f, JSON.stringify(body));
    await lp.evaluate(() => localStorage.setItem("tlog-data-v1", JSON.stringify({ program: {}, workouts: {}, bodyweight: {} })));
    await lp.click('[data-tab="history"]');
    await lp.setInputFiles("#import-file", f);
    await lp.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem("tlog-data-v1")).workouts).length === 1);
    assert.deepEqual(await data(lp), old, `現行版の書き出し（${name}）を読み込める`);
  }
  ok("現行版の形のデータ（曜日はキー名、文字列の数値、書き出し日）をそのまま読める・書き換えない");

  // ---- 10. 手帳 → 模型 → 手帳に戻る（日付と入力を保つ）
  await lp.click('[data-tab="today"]');
  await lp.click("[data-act=prev]");
  await lp.click("[data-act=next]");
  const lb2 = lp.locator('.card.ex:has(h3:text-is("ベンチプレス"))');
  await lb2.locator('[data-s="0"] [data-f=w]').fill("62.5");
  await lb2.locator(".model-link").click();
  await lp.waitForURL(/model\.html\?app=1#bench/);
  await lp.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  assert.equal(await lp.textContent("#ex-name"), "ベンチプレス");
  assert.equal(await lp.inputValue("#ex"), "bench");
  await lp.click(".back");
  await lp.waitForSelector("#tab-today .card.ex");
  assert.equal(await lp.locator('.card.ex:has(h3:text-is("ベンチプレス")) [data-s="0"] [data-f=w]').inputValue(), "62.5", "入力が保存されて戻る");
  assert.ok(Object.keys((await data(lp)).workouts).some((k) => k.startsWith(todayStr)), "模型へ行く前に今日の入力が保存されている");
  await legacy.ctx.close();
  ok("手帳 → 模型（種目が選ばれた状態）→ 手帳に戻る、入力は保たれる");

  // ---- 11. 自己ベスト・推移の表・デロード・体組成
  {
    const fx = await newPage();
    const fp = fx.page;
    // 6週間、ベンチ・スクワット・ロウが伸び悩み、RIR 0 が続いたデータ
    const today = new Date(); const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const wd = today.getDay() === 0 ? 7 : today.getDay();
    const workouts = {};
    for (let k = 1; k <= 18; k++) {
      const d = new Date(today); d.setDate(d.getDate() - k * 2);
      const date = ymdOf(d);
      workouts[`${date}_day`] = { date, dayKey: "day", title: "テスト", exercises: ["bench", "squat", "c_dbrow"].map((id) => ({ id, name: id === "bench" ? "ベンチプレス" : id, muscle: "胸", sets: [{ w: 60, r: 6, rir: "0", done: true }, { w: 60, r: 6, rir: "0", done: true }] })) };
    }
    const seed = { program: { current: { days: [{ key: "day", title: "テスト", weekday: wd, exercises: [{ id: "bench", name: "ベンチプレス", muscle: "胸", sets: 2, repMin: 5, repMax: 8, rir: "1〜2", rest: 0, inc: 2.5, start: null, note: "" }] }] } }, workouts, bodyweight: {} };
    await fx.ctx.addInitScript((s) => { if (!sessionStorage.getItem("x")) { localStorage.setItem("tlog-data-v1", s); sessionStorage.setItem("x", 1); } }, JSON.stringify(seed));
    await fp.goto(URL);
    await fp.waitForSelector("#tab-today .card.ex");
    const t = await fp.evaluate(() => todayYmd());
    assert.match(await fp.textContent("#tab-today .notice.deload"), /デロード/, "今日タブにデロードの提案");
    const card = fp.locator('.card.ex:has(h3:text-is("ベンチプレス"))');
    assert.equal(await card.locator(".pb-chip").isVisible(), false);
    await card.locator('[data-s="0"] [data-f=w]').fill("62.5");
    await card.locator('[data-s="0"] [data-f=r]').fill("6");
    assert.equal(await card.locator('[data-s="0"]').getAttribute("class"), "set pb", "重量更新で★");
    assert.equal(await card.locator(".pb-chip").isVisible(), true);
    await card.locator('[data-s="0"] [data-f=w]').fill("60");
    assert.equal(await card.locator(".pb-chip").isVisible(), false, "同じ重量に戻すと消える");
    await card.locator('[data-s="0"] [data-f=w]').fill("62.5");
    await fp.waitForFunction(() => document.querySelector("#save-status").textContent === "保存済み");
    await fp.screenshot({ path: path.join(OUT, "pb-today.png"), fullPage: true });
    await fp.click('[data-tab="history"]');
    assert.match(await fp.textContent("#tab-history .notice.deload"), /推定1RMが3週伸びていない[\s\S]*RIR/);
    assert.equal(await fp.locator(".trend tbody tr").count(), 10, "推移の表：10部位");
    assert.equal(await fp.locator(".trend thead th").count(), 9, "推移の表：8週");
    await fp.screenshot({ path: path.join(OUT, "history-trend.png"), fullPage: true });
    await noHScroll(fp, "履歴（推移の表）");
    await fp.click('[data-tab="muscles"]');
    await fp.click("[data-muscle='胸']");
    await fp.click("[data-ex=bench]");
    assert.match(await fp.textContent("#tab-muscles"), /推定1RMの推移/);
    assert.equal(await fp.locator("#tab-muscles .records li.pb").count(), 1, "自己ベストの日に★（今日の62.5kg）");
    await fp.click('[data-tab="weight"]');
    await fp.fill("#bw-kg", "70.4"); await fp.fill("#bw-fat", "15.2"); await fp.fill("#bw-waist", "79");
    await fp.click("#bw-form button[type=submit]");
    await fp.waitForSelector("#tab-weight [data-comp]");
    const rec = (await data(fp)).bodyweight[t];
    assert.deepEqual([rec.kg, rec.fat, rec.waist], [70.4, 15.2, 79]);
    assert.match(await fp.textContent("#tab-weight"), /体脂肪率\s*15\.2/);
    await fp.click('[data-comp="waist"]');
    assert.equal(await fp.evaluate(() => localStorage.getItem("tlog-ui-bwcomp")), '"waist"');
    // 体重だけ消して体脂肪率だけ残す
    await fp.fill("#bw-kg", ""); await fp.click("#bw-form button[type=submit]");
    await fp.waitForFunction((d) => JSON.parse(localStorage.getItem("tlog-data-v1")).bodyweight[d].kg === undefined, t);
    await fp.screenshot({ path: path.join(OUT, "weight-comp.png"), fullPage: true });
    await noHScroll(fp, "体重（体組成）");
    await fx.ctx.close();
    ok("自己ベストの★・推定1RMの推移・部位別セット数の推移・デロードの提案・体組成の記録");
  }

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
