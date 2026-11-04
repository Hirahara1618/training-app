// 仲間タブ（手帳の側）をブラウザで確かめる。サーバーは social-server の Worker 本体を Node の SQLite で動かしたもの（tools/social-mock.mjs）。
// 使い方: npm run build && node tools/test-social.mjs [画面写真の出力先]
//  段階2: サーバー未設定ならタブを出さない／オフのときは通信しない／6タブがスマホ幅に収まる／登録と復旧コード／
//         申請・承認・取り消し・解除／設定／引き継ぎと復旧／アカウントの削除

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createSocialMock } from "./social-mock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "tools/out"));
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8094;
const URL = `http://localhost:${PORT}/`;
const SERVER = "https://social.test";

const server = spawn(process.execPath, [path.join(ROOT, "tools/serve.mjs"), path.join(ROOT, "dist"), String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const mock = await createSocialMock({ origins: [`http://localhost:${PORT}`] });
const errors = [];
let step = 0;
const ok = (msg) => console.log(`  ok  ${++step}. ${msg}`);

const today = new Date();
const wd = today.getDay() === 0 ? 7 : today.getDay();
const DATA = {
  program: { current: { updatedAt: Date.now(), days: [{ key: "d1", title: "胸の日", weekday: wd, exercises: [
    { id: "bench", name: "ベンチプレス", muscle: "胸", sets: 3, repMin: 5, repMax: 8, rir: "1〜2", rest: 60, start: 40, inc: 2.5, note: "", bw: false, cardio: false },
  ] }] } },
  workouts: {}, bodyweight: {},
};

async function device({ configure = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((data) => { if (!localStorage.getItem("tlog-data-v1")) localStorage.setItem("tlog-data-v1", data); }, JSON.stringify(DATA));
  await mock.attach(ctx, SERVER);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("dialog", (d) => d.accept());
  await page.goto(URL);
  await page.waitForSelector(".tabs");
  // 本番のビルドでは social-server/client.json から入る
  if (configure) await page.evaluate((url) => { Social.config.url = url; Social.applyConfig(); }, SERVER);
  return { ctx, page };
}
const friendsTab = async (page) => { await page.click('[data-tab="today"]'); await page.click('[data-tab="friends"]'); };
const notice = (page) => page.textContent("#tab-friends .notice");
const social = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("tlog-social-v1") || "{}"));

try {
  // 1. サーバー未設定ならタブを出さない
  {
    const { ctx, page } = await device({ configure: false });
    assert.equal(await page.isHidden('[data-tab="friends"]'), true);
    assert.equal(await page.$$eval(".tabs button:not([hidden])", (a) => a.length), 5);
    await ctx.close();
    ok("サーバーが設定されていないビルドでは、仲間タブを出さない");
  }

  const A = await device();
  const pa = A.page;

  // 2. 6タブが 375px に収まる
  {
    assert.equal(await pa.$$eval(".tabs button:not([hidden])", (a) => a.length), 6);
    const fit = await pa.evaluate(() => ({
      page: document.documentElement.scrollWidth <= window.innerWidth,
      tabs: Array.from(document.querySelectorAll(".tabs button")).every((b) => b.scrollWidth <= b.clientWidth),
    }));
    assert.deepEqual(fit, { page: true, tabs: true });
    await pa.locator(".top").screenshot({ path: path.join(OUT, "social-tabs.png") });
    ok("6タブが 375px 幅で横スクロールせず、文字も切れない");
  }

  // 3. オフのときは通信しない
  {
    await pa.click('[data-tab="friends"]');
    assert.match(await pa.textContent("#tab-friends"), /送らない情報[\s\S]*体重/);
    await pa.screenshot({ path: path.join(OUT, "social-off.png"), fullPage: true });
    await pa.click('[data-tab="today"]');
    await pa.fill('[data-f="w"]', "60");
    await pa.click('[data-act="done"]');
    await pa.waitForTimeout(900);
    for (const t of ["muscles", "weight", "history", "routine", "friends", "today"]) await pa.click(`[data-tab="${t}"]`);
    assert.equal(mock.requests.length, 0, JSON.stringify(mock.requests));
    ok("オフのときは、タブを開いても記録しても、サーバーに一切通信しない");
  }

  // 4. 登録と復旧コード
  let recoveryA;
  {
    await pa.click('[data-tab="friends"]');
    await pa.click('[data-act="s-start"]');
    await pa.fill("#s-name", "あ");
    await pa.click('[data-act="s-register"]');
    assert.match(await notice(pa), /2〜20文字/);
    assert.equal(mock.requests.length, 0, "短すぎる名前は送らずに断る");
    await pa.fill("#s-name", "あいこ");
    await pa.click('[data-act="s-register"]');
    await pa.waitForSelector("#s-recovery-code");
    recoveryA = (await pa.textContent("#s-recovery-code")).trim();
    assert.match(recoveryA, /^([0-9A-Z]{4}-){4}[0-9A-Z]{4}$/);
    await pa.screenshot({ path: path.join(OUT, "social-recovery.png"), fullPage: true });
    const s = await social(pa);
    assert.match(s.token, /^[A-Za-z0-9_-]{43}$/);
    // バックアップにはトークンも復旧コードも入らない
    const backup = await pa.evaluate(() => JSON.stringify(db.exportData()));
    assert.ok(!backup.includes(s.token) && !backup.includes(recoveryA));
    // 控えるまでは、開き直しても復旧コードを出す
    await pa.reload();
    await pa.evaluate((url) => { Social.config.url = url; Social.applyConfig(); }, SERVER);
    await pa.click('[data-tab="friends"]');
    assert.equal((await pa.textContent("#s-recovery-code")).trim(), recoveryA);
    await pa.click('[data-act="s-recovery-done"]');
    await pa.waitForSelector("#s-friend-code");
    assert.equal((await social(pa)).recovery, undefined, "控えたら端末からも消す");
    ok("登録：表示名を確かめ、復旧コードを控えるまで表示する。トークンはバックアップに入らない");
  }

  // 5. 申請・承認（相手の名前は文字として表示）
  const me = mock.query("SELECT id, friend_code FROM users WHERE name = 'あいこ'")[0];
  const B = await mock.call("POST", "/register", { name: "<b>ぶんた</b>" });
  const C = await mock.call("POST", "/register", { name: "ちえ" });
  {
    await mock.call("POST", "/links/request", { code: me.friend_code }, B.token);
    await friendsTab(pa);
    await pa.waitForSelector('[data-act="s-accept"]');
    assert.equal((await pa.textContent(".s-person .s-name")).trim(), "<b>ぶんた</b>");
    assert.equal(await pa.$$eval("#tab-friends b", (a) => a.length), 0, "名前を HTML として入れない");
    await pa.click('[data-act="s-accept"]');
    await pa.waitForFunction(() => /仲間（1 \/ 50）/.test(document.querySelector("#s-links").textContent));
    assert.equal(mock.query("SELECT status FROM links")[0].status, "accepted");
    ok("届いた申請を承認すると仲間になる。相手の名前は HTML にならず文字のまま");
  }

  // 6. 申請と取り消し（2段階）
  {
    await pa.fill("#s-code", C.user.friendCode.toLowerCase().replace("-", ""));
    await pa.click('[data-act="s-request"]');
    await pa.waitForFunction(() => /申請しました/.test(document.querySelector("#tab-friends .notice")?.textContent || ""));
    await pa.waitForFunction(() => /承認待ち[\s\S]*ちえ/.test(document.querySelector("#s-links").textContent));
    await pa.fill("#s-code", "ZZZZ-ZZZZ");
    await pa.click('[data-act="s-request"]');
    await pa.waitForFunction(() => /見つかりません/.test(document.querySelector("#tab-friends .notice")?.textContent || ""));
    const cancel = pa.locator('[data-act="s-remove"]', { hasText: "取り消す" });
    await cancel.click();
    assert.equal(mock.query("SELECT COUNT(*) AS n FROM links WHERE status = 'pending'")[0].n, 1, "1回目では取り消さない");
    await cancel.click();
    await pa.waitForFunction(() => !/承認待ち/.test(document.querySelector("#s-links").textContent));
    assert.equal(mock.query("SELECT COUNT(*) AS n FROM links WHERE status = 'pending'")[0].n, 0);
    await pa.screenshot({ path: path.join(OUT, "social-manage.png"), fullPage: true });
    ok("友達コードで申請（小文字・区切りなしも可）、見つからないコードは知らせる、申請は2回押して取り消す");
  }

  // 7. 設定
  {
    await pa.fill("#s-rename", "あいこ２");
    await pa.click('[data-act="s-rename"]');
    await pa.waitForFunction(() => /表示名を変えました/.test(document.querySelector("#tab-friends .notice")?.textContent || ""));
    await pa.uncheck("#s-weight");
    await pa.waitForFunction(() => document.querySelector("#s-weight") && !document.querySelector("#s-weight").checked && !document.querySelector("#s-weight").disabled);
    await pa.uncheck("#s-ranking");
    await pa.waitForFunction(() => document.querySelector("#s-ranking") && !document.querySelector("#s-ranking").checked && !document.querySelector("#s-ranking").disabled);
    const u = mock.query("SELECT name, show_weight, in_ranking FROM users WHERE id = ?", me.id)[0];
    assert.deepEqual({ ...u }, { name: "あいこ２", show_weight: 0, in_ranking: 0 });
    assert.equal((await social(pa)).user.showWeight, false);
    const old = (await pa.textContent("#s-friend-code")).trim();
    await pa.click('[data-act="s-newcode"]');
    await pa.click('[data-act="s-newcode"]');
    await pa.waitForFunction((o) => document.querySelector("#s-friend-code") && document.querySelector("#s-friend-code").textContent.trim() !== o, old);
    ok("設定：表示名・重量を載せるか・ランキングに参加するか・友達コードの作り直し");
  }

  // 8. 引き継ぎ：新しい端末で使うと、前の端末は使えなくなる
  {
    await pa.click('[data-act="s-transfer"]');
    await pa.waitForSelector("#tab-friends .s-code >> nth=1");
    const code = (await pa.locator("#tab-friends .s-code").nth(1).textContent()).trim();
    assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const D2 = await device();
    await D2.page.click('[data-tab="friends"]');
    await D2.page.fill("#s-transfer", code);
    await D2.page.click('[data-act="s-redeem"]');
    await D2.page.waitForSelector("#s-friend-code");
    assert.match(await notice(D2.page), /引き継ぎました/);
    assert.equal((await social(D2.page)).user.name, "あいこ２");
    // 前の端末は、次の通信で無効になったと知らせる
    await friendsTab(pa);
    await pa.waitForFunction(() => /無効になりました/.test(document.querySelector("#tab-friends").textContent));
    assert.equal((await social(pa)).token, undefined);
    await pa.screenshot({ path: path.join(OUT, "social-lost.png"), fullPage: true });
    ok("引き継ぎコードで新しい端末に移ると、前の端末は無効になったと表示する");

    // 9. 復旧コード：別の端末で戻す → 新しい復旧コード、引き継いだ端末は無効
    await pa.fill("#s-recover", recoveryA);
    await pa.click('[data-act="s-recover"]');
    await pa.waitForSelector("#s-recovery-code");
    assert.notEqual((await pa.textContent("#s-recovery-code")).trim(), recoveryA);
    await pa.click('[data-act="s-recovery-done"]');
    await pa.waitForFunction(() => /仲間（1 \/ 50）/.test(document.querySelector("#s-links")?.textContent || ""));
    await friendsTab(D2.page);
    await D2.page.waitForFunction(() => /無効になりました/.test(document.querySelector("#tab-friends").textContent));
    await D2.ctx.close();
    ok("復旧コードで戻すと新しい復旧コードを表示し、つながりはそのまま");
  }

  // 10. 仲間の解除（2段階）
  {
    const rm = pa.locator('[data-act="s-remove"]', { hasText: "解除" });
    await rm.click();
    await rm.click();
    await pa.waitForFunction(() => /仲間（0 \/ 50）/.test(document.querySelector("#s-links").textContent));
    assert.equal(mock.query("SELECT COUNT(*) AS n FROM links")[0].n, 0);
    ok("仲間の解除は2回押して確定");
  }

  // 11. アカウントの削除：サーバーからは消え、手帳の記録は残る
  {
    const before = await pa.evaluate(() => JSON.stringify(db.exportData().workouts));
    const del = pa.locator('[data-act="s-delete"]');
    await del.click();
    assert.equal(mock.query("SELECT COUNT(*) AS n FROM users WHERE id = ?", me.id)[0].n, 1, "1回目では消さない");
    await del.click(); // 2回目 → 確認ダイアログ（自動で OK）
    await pa.waitForFunction(() => /削除しました/.test(document.querySelector("#tab-friends .notice")?.textContent || ""));
    assert.equal(mock.query("SELECT COUNT(*) AS n FROM users WHERE id = ?", me.id)[0].n, 0);
    assert.deepEqual(await social(pa), {});
    assert.equal(await pa.evaluate(() => JSON.stringify(db.exportData().workouts)), before);
    assert.ok(before.includes('"w":60'), "記録は残っている");
    assert.ok(await pa.isVisible('[data-act="s-start"]'), "オフの画面に戻る");
    ok("アカウントの削除：2段階の確認のあと、サーバーから消え、手帳の記録は残る");
  }

  assert.deepEqual(errors, []);
  ok("ページのエラーなし");
  console.log(`すべて通過。画面写真: ${OUT}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
