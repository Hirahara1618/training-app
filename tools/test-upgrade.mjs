// 現行版（1ファイル版）から新しい版への切り替えの検査。
// 同じ URL で、現行版を開いて Service Worker が入った状態から、中身を新しい版に差し替えて開き直す。
// 使い方: npm run build && node tools/test-upgrade.mjs <現行版のファイルを置いたフォルダ>

import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLD = path.resolve(process.argv[2]);
const NEW = path.join(ROOT, "dist");
const PORT = 8100;
let root = OLD;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".bin": "application/octet-stream" };
// GitHub Pages と同じく、キャッシュを長く持たせない（ブラウザの HTTP キャッシュの影響を除く）
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/training-app/, "");
  if (rel.endsWith("/")) rel += "index.html";
  const f = path.join(root, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "max-age=0" });
  fs.createReadStream(f).pipe(res);
}).listen(PORT);

const BASE = `http://localhost:${PORT}/training-app/`;
const browser = await chromium.launch({ channel: "chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let step = 0;
const ok = (m) => console.log(`  ok  ${++step}. ${m}`);
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. 現行版を開き、Service Worker が制御する状態にして、記録を入れる
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const oldCaches = await page.evaluate(() => caches.keys());
  const seed = { program: { current: { days: [{ key: "mon", title: "旧データ", exercises: [] }], updatedAt: "2026-10-01" } }, workouts: {}, bodyweight: { "2026-10-20": { date: "2026-10-20", kg: 70, savedAt: "x" } } };
  await page.evaluate((s) => localStorage.setItem("tlog-data-v1", s), JSON.stringify(seed));
  assert.ok(oldCaches.some((k) => k.startsWith("tlog-2026")), `現行版のキャッシュがある: ${oldCaches}`);
  ok(`現行版が Service Worker つきで動いている（キャッシュ ${oldCaches.join(", ")}）`);

  // 2. 中身を新しい版に差し替えて開き直す
  root = NEW;
  await page.reload();
  // 新しい Service Worker が入れ替わるのを待つ（skipWaiting と clients.claim）
  // ブラウザは開いたときに sw.js の更新を確かめ、変わっていれば入れ替える。入れ替えが終わる（新しいキャッシュができる）まで待つ
  // （waitForFunction に async 関数を渡すと Promise が常に真になり待たないので、ここで繰り返し調べる）
  const t0 = Date.now();
  let keys = [];
  while (Date.now() - t0 < 60000) {
    keys = await page.evaluate(() => caches.keys());
    if (keys.some((k) => k.startsWith("tlog-2.0.0")) && !keys.some((k) => k.startsWith("tlog-2026"))) break;
    await page.waitForTimeout(500);
  }
  console.log(`      入れ替えまで ${((Date.now() - t0) / 1000).toFixed(1)}秒（キャッシュ ${keys.join(", ")}）`);
  await page.reload();
  await page.waitForSelector(".tabs", { timeout: 15000 });
  const ver = await page.textContent("footer.ver");
  assert.match(ver, /版 2\.0\.0-/, "新しい版の手帳が表示される");
  ok(`開き直すと新しい版が表示される（${ver.trim()}）`);

  const caches2 = await page.evaluate(() => caches.keys());
  assert.ok(!caches2.some((k) => k.startsWith("tlog-2026")), `現行版のキャッシュが消える: ${caches2}`);
  assert.ok(caches2.some((k) => k.startsWith("tlog-2.0.0")), "新しい版のキャッシュがある");
  ok(`現行版のキャッシュは消え、新しい版のキャッシュになる（${caches2.join(", ")}）`);

  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("tlog-data-v1"))), seed, "記録はそのまま");
  await page.click('[data-tab="routine"]');
  assert.equal(await page.inputValue("#tab-routine .r-title"), "旧データ");
  ok("記録はそのまま残り、新しい版で読める");

  // 3. 模型ページも新しい版になる（現行版のキャッシュの model.html が残らない）
  await page.goto(BASE + "model.html?app=1#squat");
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  assert.match(await page.textContent("#ver"), /版 2\.0\.0-/);
  ok("模型ページも新しい版になる");

  // 4. その後、オフラインでも新しい版が開ける
  await ctx.setOffline(true);
  await page.goto(BASE);
  await page.waitForSelector(".tabs");
  assert.match(await page.textContent("footer.ver"), /版 2\.0\.0-/);
  await ctx.setOffline(false);
  ok("切り替え後、オフラインでも新しい版が開ける");
  if (errors.length) console.log("ページのエラー:", errors.join(" / "));
  console.log("すべて通過");
} catch (e) {
  console.error(`  NG  ${step + 1}. ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
