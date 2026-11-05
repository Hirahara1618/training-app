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
// ビルドにサーバーの場所が入っていれば（social-server/client.json）その場所をモックで受ける。本番には一切つながない
const clientFile = path.join(ROOT, "social-server/client.json");
const SERVER = (fs.existsSync(clientFile) && JSON.parse(fs.readFileSync(clientFile, "utf8")).url) || "https://social.test";

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
  // 本番のサーバーには検査から一切つながない（つながろうとしたら失敗として記録する）
  await ctx.route((u) => /workers\.dev/.test(u.href) && !u.href.startsWith(SERVER), (route) => { errors.push(`モック外への通信: ${route.request().url()}`); route.abort(); });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("dialog", (d) => d.accept());
  await page.goto(URL);
  await page.waitForSelector(".tabs");
  // 本番のビルドでは social-server/client.json から入る。検査ではモックか、未設定（空）に差し替える
  await page.evaluate((url) => { Social.config.url = url; Social.applyConfig(); }, configure ? SERVER : "");
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

  // ---- 段階3：共有・タイムライン・いいね ----
  const myPosts = () => mock.query("SELECT key, body_json FROM posts WHERE user_id = ?", me.id);
  const shareText = () => pa.textContent("#share");
  {
    // 重量を載せる設定に戻しておく
    await pa.check("#s-weight");
    await pa.waitForFunction(() => document.querySelector("#s-weight") && document.querySelector("#s-weight").checked && !document.querySelector("#s-weight").disabled);
    // 今日タブ（3. で 60kg のセットを1つ完了している）に共有ボタン。電波がない状態で押す
    mock.offline = true;
    await pa.click('[data-tab="today"]');
    await pa.click('#share [data-act="share"]');
    await pa.waitForFunction(() => /送信待ち/.test(document.querySelector("#share").textContent));
    assert.equal(myPosts().length, 0);
    assert.equal((await social(pa)).queue.length, 1);
    // オンラインに戻ると送る
    mock.offline = false;
    await pa.evaluate(() => window.dispatchEvent(new Event("online")));
    await pa.waitForFunction(() => /共有しています/.test(document.querySelector("#share").textContent));
    const p = myPosts();
    assert.equal(p.length, 1);
    assert.deepEqual(JSON.parse(p[0].body_json), { exercises: [{ name: "ベンチプレス", muscle: "胸", sets: [{ w: 60, r: 5 }], pb: false }] }, "完了したセットだけ、RIR・メモなし");
    assert.equal((await social(pa)).queue.length, 0);
    ok("電波がないときに共有すると送信待ちになり、オンラインに戻ると送る");

    // 電波がないまま記録を足して「共有を更新」→ 開き直したら送る
    mock.offline = true;
    await pa.locator('[data-f="w"]').nth(1).fill("62.5");
    await pa.locator('[data-f="r"]').nth(1).fill("6");
    await pa.locator('[data-act="done"]').nth(1).click();
    await pa.click('#share [data-act="share"]');
    await pa.waitForFunction(() => /送信待ち/.test(document.querySelector("#share").textContent));
    await pa.waitForTimeout(900); // 記録の自動保存
    mock.offline = false;
    await pa.reload();
    await pa.evaluate((url) => { Social.config.url = url; Social.applyConfig(); return Social.flush(); }, SERVER); // 本番では開いたときに送る
    await pa.waitForFunction(() => /共有しています/.test(document.querySelector("#share").textContent));
    assert.deepEqual(JSON.parse(myPosts()[0].body_json).exercises[0].sets, [{ w: 60, r: 5 }, { w: 62.5, r: 6 }]);
    assert.equal(myPosts().length, 1, "同じ日は上書き");
    await pa.screenshot({ path: path.join(OUT, "social-share.png"), fullPage: true });
    ok("送信待ちは、次に開いたときにも送り直す。共有し直すと上書き");
  }
  {
    // 仲間（B）の共有と、B から A へのいいね
    const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const pb = await mock.call("POST", "/posts", { key: `${t}_b1`, routineTitle: "<i>脚の日</i>", body: { exercises: [
      { name: "スクワット", muscle: "前もも", pb: true, sets: [{ w: 80, r: 5 }, { w: 80, r: 5 }] },
      { name: "プランク", muscle: "腹", bw: true, unit: "秒", sets: [{ r: 60 }] },
      { name: "エアロバイク", muscle: "有酸素", cardio: true, sets: [{ w: 8.5, r: 20 }] },
    ] } }, B.token);
    const aPost = mock.query("SELECT id FROM posts WHERE user_id = ?", me.id)[0].id;
    await mock.call("POST", "/likes/toggle", { postId: aPost }, B.token);
    await pa.click('[data-tab="friends"]');
    await pa.waitForSelector(".s-post");
    const posts = await pa.$$eval(".s-post", (a) => a.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
    assert.equal(posts.length, 2);
    const bp = posts.find((x) => x.includes("スクワット"));
    assert.match(bp, /<b>ぶんた<\/b>/);
    assert.match(bp, /<i>脚の日<\/i>/);
    assert.match(bp, /スクワット ★\s*80×5 80×5/);
    assert.match(bp, /プランク\s*60秒/);
    assert.match(bp, /エアロバイク\s*20分 8\.5km/);
    assert.equal(await pa.$$eval("#s-timeline b:not(.s-name), #s-timeline i", (a) => a.length), 0, "名前や題名を HTML にしない");
    const ap = posts.find((x) => x.includes("自分"));
    assert.match(ap, /♡ 1/);
    // 押した人の名前
    await pa.locator(`[data-post="${aPost}"] summary`).click();
    assert.match(await pa.textContent(`[data-post="${aPost}"] .s-likers span`), /<b>ぶんた<\/b>/);
    // A が B の投稿にいいね → 取り消し
    const like = () => pa.locator(`[data-post="${pb.post.id}"] [data-act="s-like"]`);
    await like().click();
    await pa.waitForFunction((id) => document.querySelector(`[data-post="${id}"] .like`).getAttribute("aria-pressed") === "true", pb.post.id);
    assert.equal(mock.query("SELECT COUNT(*) AS n FROM likes WHERE post_id = ? AND user_id = ?", pb.post.id, me.id)[0].n, 1);
    assert.match(await like().textContent(), /♥ 1/);
    await pa.screenshot({ path: path.join(OUT, "social-timeline.png"), fullPage: true });
    await like().click();
    await pa.waitForFunction((id) => document.querySelector(`[data-post="${id}"] .like`).getAttribute("aria-pressed") === "false", pb.post.id);
    await pa.waitForTimeout(200);
    assert.equal(mock.query("SELECT COUNT(*) AS n FROM likes WHERE post_id = ? AND user_id = ?", pb.post.id, me.id)[0].n, 0);
    // サーバーに断られたら表示を戻す
    mock.offline = true;
    await like().click();
    await pa.waitForFunction((id) => document.querySelector(`[data-post="${id}"] .like`).getAttribute("aria-pressed") === "false", pb.post.id);
    mock.offline = false;
    ok("タイムライン：仲間と自分の共有（重量・自重・秒・有酸素の表示）、いいねと取り消し、押した人の名前、失敗したら元に戻す");

    // 重量を載せないにすると、タイムラインからも重量が消える
    await pa.uncheck("#s-weight");
    await pa.waitForFunction(() => document.querySelector("#s-weight") && !document.querySelector("#s-weight").checked && !document.querySelector("#s-weight").disabled);
    await pa.waitForFunction(() => /ベンチプレス\s*5回 6回/.test(document.querySelector("#s-timeline").textContent));
    ok("重量を載せない設定にすると、共有済みの記録も回数だけになる");

    // 共有の取り消し（2段階）
    await pa.click('[data-tab="today"]');
    const un = pa.locator('#share [data-act="unshare"]');
    await un.click();
    assert.equal(myPosts().length, 1, "1回目では取り消さない");
    await un.click();
    await pa.waitForFunction(() => /この日の記録を共有/.test(document.querySelector("#share").textContent));
    for (let i = 0; i < 20 && myPosts().length; i++) await pa.waitForTimeout(100);
    assert.equal(myPosts().length, 0);
    ok("共有の取り消しは2回押して確定し、サーバーから消える");
  }

  // ---- 段階4：ランキング ----
  {
    const jst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    // 手帳はランキング用の日ごとの記録を送っている（今日は予定日で、終えたセットがある）
    for (let i = 0; i < 30 && !mock.query("SELECT 1 FROM days WHERE user_id = ? AND date = ?", me.id, jst).length; i++) await pa.waitForTimeout(100);
    const row = mock.query("SELECT planned, trained FROM days WHERE user_id = ? AND date = ?", me.id, jst)[0];
    assert.deepEqual({ ...row }, { planned: 1, trained: 1 });
    assert.equal(mock.query("SELECT plan_weekdays FROM users WHERE id = ?", me.id)[0].plan_weekdays, String(wd));
    assert.ok(mock.query("SELECT COUNT(*) AS n FROM days WHERE user_id = ?", me.id)[0].n >= 8, "先週の月曜から今日まで");

    // B は今日トレーニングした。A はランキングに参加していない（7. でオフにした）
    await mock.call("POST", "/days", { days: [{ date: jst, planned: true, trained: true }], weekdays: [wd] }, B.token);
    await friendsTab(pa);
    await pa.waitForSelector("#s-rank-this .s-rank");
    assert.match(await pa.textContent("#s-rank"), /参加していません/);
    assert.deepEqual(await pa.$$eval("#s-rank-this .s-name", (a) => a.map((x) => x.textContent)), ["<b>ぶんた</b>"]);

    // 参加する → 自分の行を強調
    await pa.check("#s-ranking");
    await pa.waitForSelector("#s-rank-this li.me");
    const rows = await pa.$$eval("#s-rank-this li", (a) => a.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => /^1/.test(r) && /100%/.test(r) && /1\/1日/.test(r)), rows.join(" | "));
    assert.ok(!/参加していません/.test(await pa.textContent("#s-rank")));

    // 指標の切り替え（選んだものは覚えておく）
    await pa.click('[data-act="s-metric"][data-m="days"]');
    assert.equal(await pa.getAttribute('[data-m="days"]', "aria-pressed"), "true");
    assert.deepEqual(await pa.$$eval("#s-rank-this .s-rank-val", (a) => a.map((x) => x.textContent)), ["1日", "1日"]);
    assert.equal(await pa.evaluate(() => uiGet("rankmetric")), "days");

    // 先週の結果（開いたときに読み込む）
    await pa.click("#s-rank-last summary");
    await pa.waitForFunction(() => /（月）〜/.test(document.querySelector("#s-rank-last .s-rank-body").textContent));
    await pa.screenshot({ path: path.join(OUT, "social-ranking.png"), fullPage: true });
    await pa.click('[data-act="s-metric"][data-m="rate"]');
    ok("ランキング：日ごとの記録を送り、実施率と日数を切り替えて表示、自分の行を強調、先週の結果、不参加の案内");

    // 電波がないときの記録の変更は、オンラインに戻ってから送る
    mock.offline = true;
    await pa.click('[data-tab="today"]');
    await pa.locator('[data-act="done"]').nth(2).click();
    await pa.waitForFunction(() => JSON.parse(localStorage.getItem("tlog-social-v1")).daysDirty === true);
    await pa.waitForTimeout(2500); // まとめて送る待ち時間を過ぎても、送れずに残る
    assert.equal((await social(pa)).daysDirty, true);
    const n0 = mock.requests.filter((r) => r.path === "/days").length;
    mock.offline = false;
    await pa.evaluate(() => window.dispatchEvent(new Event("online")));
    await pa.waitForFunction(() => !JSON.parse(localStorage.getItem("tlog-social-v1")).daysDirty);
    assert.ok(mock.requests.filter((r) => r.path === "/days").length > n0);
    ok("電波がないときの記録の変更は残しておき、オンラインに戻ったら送る");
  }

  // 10. 仲間の解除（2段階）
  {
    await friendsTab(pa);
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
