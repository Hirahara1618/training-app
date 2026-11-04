// 手元での通し検査（CLAUDE.md 14.6）: wrangler dev のローカル D1 で、
// 登録 → 申請 → 承認 → 共有 → いいね → ランキング → 解除 → 削除 を通し、見えてはいけないものが見えないことを確かめる。
// 使い方: node e2e.mjs（.dev.vars と .e2e-state を一時的に作り、終わったら消す）
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import assert from "node:assert/strict";

const PORT = 8788;
const W = `http://127.0.0.1:${PORT}`;
const ORIGIN = "http://localhost:8080";
const STATE = ".e2e-state";
fs.rmSync(STATE, { recursive: true, force: true });
fs.writeFileSync(".dev.vars", "ALLOW_TEST_CLOCK=1\nRATE_USER=100\nRATE_IP=15\n");
execSync(`npx wrangler d1 migrations apply DB --local --persist-to ${STATE}`, { stdio: "ignore" });
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", STATE], { shell: true, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 時刻を指定しないときは実際の時刻（送信回数の制限の検査だけ、別の「分」にずらす）
async function call(method, path, { token, body, now, origin = ORIGIN } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (now != null) headers["X-Test-Now"] = String(now);
  const r = await fetch(W + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j, headers: r.headers };
}
const get = (path, o) => call("GET", path, o);
const post = (path, body, o = {}) => call("POST", path, Object.assign({}, o, { body }));
async function ok200(p) { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; }

let step = 0;
const ok = (m) => console.log(`  ok  ${++step}. ${m}`);
let passed = false;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(W + "/health")).ok) break; } catch (e) {} await sleep(1000); }

  // ---- 登録 ----
  assert.equal((await post("/register", { name: "あい" }, { origin: "https://evil.example.com" })).status, 403);
  assert.equal((await post("/register", { name: "あい" }, { origin: null })).status, 403);
  assert.equal((await post("/register", { name: "x" })).status, 400);
  assert.equal((await post("/register", { name: "ab‮cd" })).status, 400);
  const reg = async (name) => ok200(post("/register", { name }));
  const A = await reg("あいこ"), B = await reg("ぶんた"), C = await reg("ちえ"), D = await reg("<img src=x>");
  assert.match(A.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(A.recovery, /^([0-9A-Z]{4}-){4}[0-9A-Z]{4}$/);
  assert.match(A.user.friendCode, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.deepEqual([A.user.showWeight, A.user.inRanking], [true, true]);
  assert.equal(D.user.name, "<img src=x>", "名前は文字としてそのまま（表示は textContent）");
  const r0 = await post("/register", { name: "あいこ" });
  assert.equal(r0.headers.get("access-control-allow-origin"), ORIGIN);
  ok("登録：トークンと復旧コードが出る。許可していない場所・不正な名前は断る");

  // トークンなし・壊れたトークンでは何もできない
  assert.equal((await get("/me")).status, 401);
  assert.equal((await get("/me", { token: "x".repeat(43) })).status, 401);
  assert.equal((await get("/timeline", { token: A.token.slice(0, -1) + (A.token.endsWith("A") ? "B" : "A") })).status, 401);
  assert.equal((await ok200(get("/me", { token: A.token }))).user.name, "あいこ");
  ok("トークンなし・別のトークンでは操作できない");

  // ---- 申請と承認 ----
  assert.equal((await post("/links/request", { code: A.user.friendCode }, { token: A.token })).status, 400, "自分には申請できない");
  assert.equal((await post("/links/request", { code: "ZZZZ-ZZZZ" }, { token: A.token })).status, 404);
  // 小文字・区切りなしでも通る
  assert.equal((await ok200(post("/links/request", { code: B.user.friendCode.replace("-", "").toLowerCase() }, { token: A.token }))).status, "pending");
  assert.equal((await ok200(post("/links/request", { code: C.user.friendCode }, { token: A.token }))).status, "pending");
  let la = await ok200(get("/links", { token: A.token }));
  let lb = await ok200(get("/links", { token: B.token }));
  assert.deepEqual(la.outgoing.map((x) => x.name), ["ちえ", "ぶんた"]);
  assert.deepEqual(lb.incoming.map((x) => x.name), ["あいこ"]);
  assert.equal(lb.friends.length, 0);
  // 申請した側は承認できない
  assert.equal((await post("/links/accept", { id: B.user.id }, { token: A.token })).status, 404);
  await ok200(post("/links/accept", { id: A.user.id }, { token: B.token }));
  la = await ok200(get("/links", { token: A.token }));
  assert.deepEqual(la.friends.map((x) => x.name), ["ぶんた"]);
  assert.deepEqual(la.outgoing.map((x) => x.name), ["ちえ"]);
  // お互いに申請したら、それで承認になる（D → B, B → D）
  assert.equal((await ok200(post("/links/request", { code: B.user.friendCode }, { token: D.token }))).status, "pending");
  assert.equal((await ok200(post("/links/request", { code: D.user.friendCode }, { token: B.token }))).status, "accepted");
  ok("申請 → 承認でつながる（申請した側は承認できない、お互いに申請しても承認になる）");

  // ---- 共有 ----
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const body = { exercises: [{ name: "ベンチプレス", muscle: "胸", pb: true, note: "秘密のメモ", sets: [{ w: 60, r: 8, rir: 1 }, { w: 60, r: 7 }] }], bodyweight: 70 };
  const pa = await ok200(post("/posts", { key: `${today}_dayA`, routineTitle: "胸の日", body }, { token: A.token }));
  assert.deepEqual(pa.post.body, { exercises: [{ name: "ベンチプレス", muscle: "胸", sets: [{ w: 60, r: 8 }, { w: 60, r: 7 }], pb: true }] }, "メモ・RIR・体重は残らない");
  const pc = await ok200(post("/posts", { key: `${today}_dayC`, routineTitle: "脚", body: { exercises: [{ name: "スクワット", muscle: "前もも", sets: [{ w: 80, r: 5 }] }] } }, { token: C.token }));
  const pd = await ok200(post("/posts", { key: `${today}_dayD`, routineTitle: "背中", body: { exercises: [{ name: "懸垂", muscle: "背中", bw: true, sets: [{ r: 8 }] }] } }, { token: D.token }));
  assert.equal((await post("/posts", { key: "bad", body }, { token: A.token })).status, 400);
  // 共有し直すと上書き（同じ id のまま）
  const pa2 = await ok200(post("/posts", { key: `${today}_dayA`, routineTitle: "胸の日", body: { exercises: [{ name: "ベンチプレス", muscle: "胸", sets: [{ w: 62.5, r: 8 }] }] } }, { token: A.token }));
  assert.equal(pa2.post.id, pa.post.id);
  ok("共有：決まった項目だけ保存され、共有し直すと上書きになる");

  // ---- 見える範囲 ----
  const names = (t) => t.posts.map((p) => p.user.name).sort();
  const ta = await ok200(get("/timeline", { token: A.token }));
  // A の仲間は B だけ（B はまだ共有していない）。C は申請中、D は仲間の仲間
  assert.deepEqual(names(ta), ["あいこ"], "申請中の相手（C）・仲間の仲間（D）の投稿は見えない");
  assert.equal(ta.posts.find((p) => p.mine).body.exercises[0].sets[0].w, 62.5);
  const tb = await ok200(get("/timeline", { token: B.token }));
  assert.deepEqual(names(tb), ["<img src=x>", "あいこ"]);
  assert.ok(tb.posts.every((p) => p.key === undefined), "他人の投稿のキーは返さない");
  const tc = await ok200(get("/timeline", { token: C.token }));
  assert.deepEqual(names(tc), ["ちえ"], "C には自分の投稿だけ");
  ok("タイムライン：自分と承認済みの仲間だけ。申請中の相手・仲間の仲間は見えない");

  // ---- いいね ----
  assert.equal((await post("/likes/toggle", { postId: pc.post.id }, { token: A.token })).status, 404, "見えない投稿にはいいねできない");
  assert.equal((await post("/likes/toggle", { postId: pa.post.id }, { token: C.token })).status, 404);
  assert.equal((await ok200(post("/likes/toggle", { postId: pa.post.id }, { token: B.token }))).liked, true);
  assert.equal((await ok200(post("/likes/toggle", { postId: pd.post.id }, { token: B.token }))).liked, true);
  assert.equal((await ok200(post("/likes/toggle", { postId: pa.post.id }, { token: A.token }))).liked, true);
  let pA = (await ok200(get("/timeline", { token: A.token }))).posts.find((p) => p.id === pa.post.id);
  assert.deepEqual([pA.likes, pA.liked, pA.likers.sort()], [2, true, ["あいこ", "ぶんた"]]);
  // 押し直しで取り消し
  assert.equal((await ok200(post("/likes/toggle", { postId: pa.post.id }, { token: A.token }))).liked, false);
  pA = (await ok200(get("/timeline", { token: A.token }))).posts.find((p) => p.id === pa.post.id);
  assert.deepEqual([pA.likes, pA.liked, pA.likers], [1, false, ["ぶんた"]]);
  ok("いいね：1人1回、押し直しで取り消し、見えない投稿には押せない");

  // ---- 重量を載せない ----
  const offB = await ok200(post("/me", { showWeight: false }, { token: B.token }));
  assert.equal(offB.user.showWeight, false);
  const pb = await ok200(post("/posts", { key: `${today}_dayB`, routineTitle: "胸", body: { exercises: [{ name: "ベンチプレス", muscle: "胸", sets: [{ w: 100, r: 5 }] }] } }, { token: B.token }));
  assert.deepEqual(pb.post.body.exercises[0].sets, [{ r: 5 }]);
  // 先に重量つきで共有していた A が、あとから載せないにすると、置いてある投稿からも消える
  await ok200(post("/me", { showWeight: false }, { token: A.token }));
  const pA2 = (await ok200(get("/timeline", { token: B.token }))).posts.find((p) => p.id === pa.post.id);
  assert.deepEqual(pA2.body.exercises[0].sets, [{ r: 8 }]);
  // データベースにも重量が残っていない
  const dump = execSync(`npx wrangler d1 execute DB --local --persist-to ${STATE} --json --command "SELECT body_json FROM posts WHERE user_id IN ('${A.user.id}','${B.user.id}')"`).toString();
  const sets = JSON.parse(dump)[0].results.flatMap((p) => JSON.parse(p.body_json).exercises.flatMap((e) => e.sets));
  assert.ok(sets.length === 2 && sets.every((s) => s.r && !("w" in s)), dump);
  await ok200(post("/me", { showWeight: true }, { token: A.token }));
  ok("重量を載せない設定：新しい投稿にも、置いてある投稿にも、データベースにも重量が残らない");

  // ---- ランキング（日本時間の週の境目） ----
  // 2026-11-08（日）23:59:59 JST と 2026-11-09（月）0:00 JST
  const SUN = Date.parse("2026-11-08T14:59:59Z"), MON = Date.parse("2026-11-08T15:00:00Z");
  const days = (list, weekdays) => ({ days: list.map(([date, planned, trained]) => ({ date, planned, trained })), weekdays });
  await ok200(post("/days", days([["2026-11-02", true, true], ["2026-11-04", true, true], ["2026-11-06", true, false], ["2026-11-08", false, true]], [1, 3, 5]), { token: A.token, now: SUN }));
  await ok200(post("/days", days([["2026-11-02", true, true], ["2026-11-03", false, true], ["2026-11-04", true, true], ["2026-11-06", true, true]], [1, 3, 5]), { token: B.token, now: SUN }));
  await ok200(post("/days", days([["2026-11-03", false, true]]), { token: C.token, now: SUN }));
  assert.equal((await post("/days", days([["2026-09-01", true, true]]), { token: A.token, now: SUN })).status, 400, "古すぎる日は断る");
  assert.equal((await post("/days", { days: [{ date: "2026-11-02", planned: 1, trained: 1 }] }, { token: A.token, now: SUN })).status, 400);
  const rk = await ok200(get("/ranking?week=this", { token: A.token, now: SUN }));
  assert.equal(rk.start, "2026-11-02");
  assert.deepEqual(rk.rate.map((x) => [x.name, x.rank, x.done, x.planned]), [["ぶんた", 1, 3, 3], ["あいこ", 2, 2, 3]]);
  assert.deepEqual(rk.days.map((x) => [x.name, x.rank, x.value]), [["ぶんた", 1, 4], ["あいこ", 2, 3]]);
  assert.ok(rk.rate.find((x) => x.name === "あいこ").me);
  assert.ok(!rk.days.some((x) => x.name === "ちえ"), "仲間でない人はランキングに出ない");
  // 月曜0時になると新しい週。先週の結果は week=last で見られる
  const rk2 = await ok200(get("/ranking?week=this", { token: A.token, now: MON }));
  assert.equal(rk2.start, "2026-11-09");
  assert.deepEqual(rk2.days.map((x) => x.value), [0, 0]);
  const last = await ok200(get("/ranking?week=last", { token: A.token, now: MON }));
  assert.equal(last.start, "2026-11-02");
  assert.deepEqual(last.rate.map((x) => [x.name, x.rank]), [["ぶんた", 1], ["あいこ", 2]]);
  // ランキングに参加しないにすると、仲間のランキングから消える
  await ok200(post("/me", { inRanking: false }, { token: B.token }));
  assert.deepEqual((await ok200(get("/ranking?week=last", { token: A.token, now: MON }))).days.map((x) => x.name), ["あいこ"]);
  await ok200(post("/me", { inRanking: true }, { token: B.token }));
  ok("ランキング：実施率と日数、日本時間の月曜0時で週が切り替わる、不参加の人は出ない");

  // ---- 引き継ぎと復旧 ----
  const tr = await ok200(post("/transfer/issue", {}, { token: A.token }));
  assert.match(tr.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const moved = await ok200(post("/transfer/redeem", { code: tr.code.toLowerCase() }));
  assert.equal(moved.user.id, A.user.id);
  assert.equal((await get("/me", { token: A.token })).status, 401, "古い端末のトークンは無効になる");
  assert.equal((await ok200(get("/me", { token: moved.token }))).user.name, "あいこ");
  assert.equal((await post("/transfer/redeem", { code: tr.code })).status, 404, "引き継ぎコードは1回だけ");
  const tr2 = await ok200(post("/transfer/issue", {}, { token: moved.token }));
  assert.equal((await post("/transfer/redeem", { code: tr2.code }, { now: Date.now() + 10 * 60e3 + 1000 })).status, 404, "10分を過ぎると使えない");
  const rec = await ok200(post("/recover", { code: A.recovery }));
  assert.notEqual(rec.recovery, A.recovery);
  assert.equal((await get("/me", { token: moved.token })).status, 401);
  assert.equal((await post("/recover", { code: A.recovery })).status, 404, "使った復旧コードは使えない");
  const tokA = rec.token;
  assert.equal((await ok200(get("/links", { token: tokA }))).friends.length, 1, "つながりはそのまま");
  ok("引き継ぎ（10分・1回だけ、古い端末は無効）と復旧（新しい復旧コード）");

  // ---- 友達コードの作り直し ----
  const oldCode = C.user.friendCode;
  const nc = await ok200(post("/me/friend-code", {}, { token: C.token }));
  assert.notEqual(nc.user.friendCode, oldCode);
  assert.equal((await post("/links/request", { code: oldCode }, { token: D.token })).status, 404, "古い友達コードは使えない");
  ok("友達コードを作り直すと古いコードは使えない");

  // ---- 解除と拒否 ----
  await ok200(post("/links/reject", { id: A.user.id }, { token: C.token }));
  assert.equal((await ok200(get("/links", { token: tokA }))).outgoing.length, 0);
  await ok200(post("/links/remove", { id: B.user.id }, { token: tokA }));
  assert.deepEqual(names(await ok200(get("/timeline", { token: tokA }))), ["あいこ"]);
  assert.ok(!(await ok200(get("/timeline", { token: B.token }))).posts.some((p) => p.user.name === "あいこ"));
  assert.equal((await post("/likes/toggle", { postId: pa.post.id }, { token: B.token })).status, 404, "解除した相手の投稿にはいいねできない");
  ok("拒否・解除：解除するとお互いの投稿が見えなくなる");

  // ---- 削除 ----
  await ok200(post("/account/delete", {}, { token: B.token }));
  assert.equal((await get("/me", { token: B.token })).status, 401);
  const left = execSync(`npx wrangler d1 execute DB --local --persist-to ${STATE} --json --command "SELECT (SELECT COUNT(*) FROM users WHERE id='${B.user.id}') + (SELECT COUNT(*) FROM links WHERE a='${B.user.id}' OR b='${B.user.id}') + (SELECT COUNT(*) FROM posts WHERE user_id='${B.user.id}') + (SELECT COUNT(*) FROM likes WHERE user_id='${B.user.id}') + (SELECT COUNT(*) FROM days WHERE user_id='${B.user.id}') AS n"`).toString();
  assert.equal(JSON.parse(left)[0].results[0].n, 0, left);
  assert.deepEqual(names(await ok200(get("/timeline", { token: D.token }))), ["<img src=x>"]);
  ok("アカウントの削除：ユーザー・つながり・投稿・いいね・日ごとの記録がすべて消える");

  // ---- 送信回数の制限（別の「分」で数える） ----
  const T1 = Date.now() + 3600e3;
  let codes = [];
  for (let i = 0; i < 16; i++) codes.push((await post("/recover", { code: "AAAA-AAAA-AAAA-AAAA-AAAA" }, { now: T1 })).status);
  assert.deepEqual([codes.slice(0, 15).every((s) => s === 404), codes[15]], [true, 429], codes.join());
  const T2 = Date.now() + 7200e3;
  codes = [];
  for (let i = 0; i < 101; i++) codes.push((await get("/me", { token: D.token, now: T2 })).status);
  assert.deepEqual([codes.slice(0, 100).every((s) => s === 200), codes[100]], [true, 429]);
  ok("送信回数の制限：1分あたりの上限を超えると 429");

  passed = true;
  console.log("すべて通過");
} catch (e) {
  console.error(e);
  console.error(log.slice(-3000));
} finally {
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(dev.pid), "/t", "/f"]);
  else dev.kill();
  setTimeout(() => {
    fs.rmSync(".dev.vars", { force: true });
    try { fs.rmSync(STATE, { recursive: true, force: true }); } catch (e) { /* Windows では少し遅れて消える */ }
    process.exit(passed ? 0 : 1);
  }, 1000);
}
