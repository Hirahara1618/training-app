// 休憩タイマーの通知（手帳の側）をブラウザで確かめる。通知サーバーとプッシュの購読はにせものに差し替える。
// 使い方: npm run build && node tools/test-push.mjs
//  1. 設定欄でオンにする → タイマーの開始・±15秒・終了で、通知サーバーに予約・取り消しが送られる
//  2. 使えない環境（iPhone の Safari のタブ）では理由を表示する
//  3. Service Worker が Push を受けたら「休憩終了」の通知を出す（本物の SW に CDP で Push を送る）

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8093;
const URL = `http://localhost:${PORT}/`;
const SERVER = "https://push.test";
const KEY = "BKtTZPmSU_GSBejL9eeiYBYiONI5EfpP8ZXMZeV4ObmIEAqORkuBvTMkzKbvL6iAvrrvOXOnJ3eOTo_eCdxIc_Y";

const server = spawn(process.execPath, [path.join(ROOT, "tools/serve.mjs"), path.join(ROOT, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
let step = 0;
const ok = (msg) => console.log(`  ok  ${++step}. ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ルーティン1つ（今日の曜日、休憩60秒の種目1つ）
const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const wd = today.getDay() === 0 ? 7 : today.getDay();
const DATA = {
  program: { current: { updatedAt: Date.now(), days: [{ key: "d1", title: "胸の日", weekday: wd, exercises: [
    { id: "bench", name: "ベンチプレス", muscle: "胸", sets: 3, repMin: 5, repMax: 8, rir: "1〜2", rest: 60, start: 40, inc: 2.5, note: "", bw: false, cardio: false },
  ] }] } },
  workouts: {}, bodyweight: {},
};

async function newPage(init) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([data, init]) => {
    if (!localStorage.getItem("tlog-data-v1")) localStorage.setItem("tlog-data-v1", data);
    if (init) (0, eval)(init);
  }, [JSON.stringify(DATA), init || ""]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("dialog", (d) => { errors.push(`dialog: ${d.message()}`); d.accept(); });
  return { ctx, page };
}

// 通知サーバーの場所と鍵を入れて、履歴タブを描き直す（本番のビルドでは push-server/client.json から入る）
async function configure(page) {
  await page.evaluate(([url, key]) => { RestPush.config.url = url; RestPush.config.key = key; }, [SERVER, KEY]);
  await page.click('[data-tab="history"]');
  await page.click('[data-tab="today"]');
  await page.click('[data-tab="history"]');
}

// プッシュの購読と通知の許可のにせもの
const FAKE_PUSH = `
  (() => {
    let sub = null;
    const pm = {
      getSubscription: async () => sub,
      subscribe: async (o) => {
        window.__subscribeKey = o.applicationServerKey.length;
        sub = { endpoint: "https://web.push.apple.com/fake", toJSON() { return { endpoint: this.endpoint, keys: {} }; }, unsubscribe: async () => { sub = null; return true; } };
        return sub;
      },
    };
    const reg = { pushManager: pm, getNotifications: async () => [] };
    window.PushManager = function () {};
    window.Notification = { permission: "default", requestPermission: async () => (window.Notification.permission = "granted") };
    const sw = navigator.serviceWorker;
    sw.getRegistration = async () => reg;
    Object.defineProperty(sw, "ready", { get: () => Promise.resolve(reg) });
  })();`;

try {
  // ---- 1. オンにして、タイマーで予約・取り消し
  {
    const { ctx, page } = await newPage(FAKE_PUSH);
    const calls = [];
    await ctx.route(`${SERVER}/**`, async (route) => {
      const r = route.request();
      calls.push({ path: new globalThis.URL(r.url()).pathname, body: JSON.parse(r.postData() || "{}"), t: Date.now() });
      await route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: '{"ok":true}' });
    });
    await page.goto(URL);
    await page.waitForSelector(".set[data-s=\"0\"]");

    // 設定していない版（client.json なし）では設定欄を出さない。ビルドに本物の設定が入っていても空にして確かめる
    await page.evaluate(() => { RestPush.config.url = ""; RestPush.config.key = ""; });
    await page.click('[data-tab="history"]');
    await page.click('[data-tab="today"]');
    await page.click('[data-tab="history"]');
    assert.equal(await page.evaluate(() => !!document.querySelector("#push")), false, "サーバー未設定なら設定欄なし");
    await configure(page);
    await page.waitForSelector("#push [data-act=push-on]");
    await page.click("#push [data-act=push-on]");
    await page.waitForSelector("#push [data-act=push-off]");
    assert.equal(await page.evaluate(() => window.__subscribeKey), 65, "公開鍵を65バイトで渡す");
    ok("設定欄で通知をオンにできる");

    // タイマーを始める（セットの✓）→ 予約
    await page.click('[data-tab="today"]');
    const t0 = Date.now();
    await page.click(".set[data-s=\"0\"] [data-act=done]");
    await page.waitForSelector("#timer:not([hidden])");
    for (let i = 0; i < 20 && !calls.length; i++) await sleep(100);
    assert.equal(calls.length, 1, "開始で1回予約");
    assert.equal(calls[0].path, "/schedule");
    assert.equal(calls[0].body.subscription.endpoint, "https://web.push.apple.com/fake");
    const lead = calls[0].body.at - t0;
    assert.ok(lead > 58000 && lead < 61500, `予約時刻は休憩60秒後（${lead}ms）`);
    ok("タイマー開始で終了時刻を予約");

    // ＋15秒を続けて2回 → まとめて1回、30秒後ろに
    await page.click('#timer [data-t="15"]');
    await page.click('#timer [data-t="15"]');
    await sleep(900);
    assert.equal(calls.length, 2, "続けて押したら1回だけ送る");
    const diff = calls[1].body.at - calls[0].body.at;
    assert.ok(Math.abs(diff - 30000) < 50, `30秒後ろへ（${diff}ms）`);
    ok("±15秒で予約し直す（続けて押したらまとめる）");

    // 終了 → 取り消し
    await page.click('#timer [data-t="stop"]');
    for (let i = 0; i < 20 && calls.length < 3; i++) await sleep(100);
    assert.equal(calls[2].path, "/cancel");
    assert.equal(calls[2].body.endpoint, "https://web.push.apple.com/fake");
    ok("終了で予約を取り消す");

    // オフにすると、タイマーを始めても送らない
    await page.click('[data-tab="history"]');
    await page.click("#push [data-act=push-off]");
    await page.waitForSelector("#push [data-act=push-on]");
    const n = calls.length;
    await page.click('[data-tab="today"]');
    await page.click(".set[data-s=\"1\"] [data-act=done]");
    await sleep(800);
    assert.equal(calls.filter((c) => c.path === "/schedule").length, 2, "オフなら予約しない");
    assert.ok(calls.length >= n);
    ok("オフにすると予約しない");
    await ctx.close();
  }

  // ---- 2. 使えない環境：iPhone の Safari のタブ（PushManager がない）
  {
    const { ctx, page } = await newPage(`
      delete window.PushManager;
      Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });`);
    await page.goto(URL);
    await page.waitForSelector(".set[data-s=\"0\"]");
    await configure(page);
    await page.waitForFunction(() => /ホーム画面に追加/.test(document.querySelector("#push-body")?.textContent || ""));
    ok("iPhone の Safari のタブでは「ホーム画面に追加」を案内");
    await ctx.close();
  }

  // ---- 3. Service Worker が Push を受けて通知を出す
  {
    const ctx = await browser.newContext();
    await ctx.grantPermissions(["notifications"], { origin: URL.replace(/\/$/, "") });
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    let regId = null;
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => { for (const r of e.registrations) if (!r.isDeleted) regId = r.registrationId; });
    await cdp.send("ServiceWorker.enable");
    for (let i = 0; i < 30 && !regId; i++) await sleep(100);
    assert.ok(regId, "Service Worker の登録が見つかる");
    await cdp.send("ServiceWorker.deliverPushMessage", { origin: URL.replace(/\/$/, ""), registrationId: regId, data: "" });
    let shown = [];
    for (let i = 0; i < 30 && !shown.length; i++) {
      await sleep(100);
      shown = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications({ tag: "rest" })).map((n) => n.title));
    }
    assert.deepEqual(shown, ["休憩終了"]);
    ok("Push を受けると「休憩終了」の通知を出す");
    await ctx.close();
  }

  assert.deepEqual(errors, [], "ページのエラー");
  console.log("すべて通過");
} catch (e) {
  console.error(e);
  if (errors.length) console.error(errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
