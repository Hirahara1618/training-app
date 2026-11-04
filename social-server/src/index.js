// 仲間とのランキングと記録の共有のサーバー（Cloudflare Workers + D1）。CLAUDE.md 14章。
//
// 認証: 登録・引き継ぎ・復旧で発行するトークンを Authorization: Bearer で送る。サーバーはハッシュだけを持つ。
// 受け取るのは表示名、共有した日の記録（種目名・部位・セット・回数・重量・自己ベストの印）、日ごとの「予定日か」「トレーニングしたか」。
//
// 登録・引き継ぎ・復旧（トークン不要）
//   POST /register        { name }               → { token, recovery, user }
//   POST /transfer/redeem { code }               → { token, user }（古い端末のトークンは無効になる）
//   POST /recover         { code }               → { token, recovery, user }（新しい復旧コード）
// 自分
//   GET  /me                                     → { user }
//   POST /me              { name?, showWeight?, inRanking? } → { user }
//   POST /me/friend-code                         → { user }（友達コードを作り直す）
//   POST /transfer/issue                         → { code, expiresAt }
//   POST /account/delete                         → { ok }（サーバー上のその人のデータをすべて消す）
// 仲間
//   GET  /links                                  → { friends, incoming, outgoing }
//   POST /links/request   { code }               → { status: "pending" | "accepted" }
//   POST /links/accept    { id }  /links/reject { id }  /links/remove { id }
// 共有とタイムライン
//   POST /posts           { key, routineTitle, body } → { post }（同じ key は上書き）
//   POST /posts/delete    { key }
//   GET  /timeline?before=YYYY-MM-DD             → { posts }
//   POST /likes/toggle    { postId }             → { liked }
// ランキング
//   POST /days            { days: [{ date, planned, trained }], weekdays? } → { ok }
//   GET  /ranking?week=this|last                 → { start, end, rate, days }
//
// 環境変数: ALLOWED_ORIGINS（カンマ区切り）, RATE_USER, RATE_IP（1分あたりの上限）
//          ALLOW_TEST_CLOCK=1 のときだけ X-Test-Now ヘッダーで時刻を差し替えられる（手元の検査用）
import {
  MAX_FRIENDS, MAX_PENDING, jstDate, validDate, addDays, weekStart, randomCode, normCode, fmtCode, randomToken, sha256hex,
  validName, cleanPostBody, stripWeights, validPostKey, cleanTitle, cleanWeekdays, rankWeek,
} from "./logic.js";

const TRANSFER_MS = 10 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/health") return json({ ok: true }, 200, cors);
      if (!cors["Access-Control-Allow-Origin"]) fail(403, "origin not allowed");
      const route = ROUTES[`${req.method} ${url.pathname}`];
      if (!route) fail(404, "not found");
      const now = env.ALLOW_TEST_CLOCK === "1" && req.headers.get("X-Test-Now") ? Number(req.headers.get("X-Test-Now")) : Date.now();
      const c = { req, env, url, now, db: env.DB, body: {} };
      if (req.method === "POST") {
        try { c.body = await req.json(); } catch (e) { fail(400, "bad json"); }
        if (!c.body || typeof c.body !== "object" || Array.isArray(c.body)) fail(400, "bad json");
      }
      if (route.auth) {
        c.user = await authUser(c);
        await limit(c, `u:${c.user.id}`, Number(env.RATE_USER) || 120);
      } else {
        await limit(c, `ip:${req.headers.get("CF-Connecting-IP") || "local"}`, Number(env.RATE_IP) || 10);
      }
      return json(await route.fn(c), 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      return json({ error: "server error" }, 500, cors);
    }
  },
};

const open = (fn) => ({ auth: false, fn });
const authed = (fn) => ({ auth: true, fn });

const ROUTES = {
  // ---- 登録・引き継ぎ・復旧 ----
  "POST /register": open(async (c) => {
    const name = validName(c.body.name);
    if (!name) fail(400, "bad name");
    const token = randomToken(), recovery = randomCode(20);
    const id = randomCode(12);
    await c.db.prepare("INSERT INTO users (id, name, friend_code, token_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, name, await newFriendCode(c.db), await sha256hex(token), await sha256hex(recovery), c.now).run();
    return { token, recovery: fmtCode(recovery), user: userOut(await getUser(c.db, id)) };
  }),
  "POST /transfer/redeem": open(async (c) => {
    const h = await sha256hex(normCode(c.body.code));
    const t = await c.db.prepare("SELECT user_id FROM transfers WHERE code_hash = ? AND expires_at > ?").bind(h, c.now).first();
    await c.db.prepare("DELETE FROM transfers WHERE code_hash = ? OR expires_at <= ?").bind(h, c.now).run();
    if (!t) fail(404, "code not found");
    const token = randomToken();
    await c.db.prepare("UPDATE users SET token_hash = ? WHERE id = ?").bind(await sha256hex(token), t.user_id).run();
    return { token, user: userOut(await getUser(c.db, t.user_id)) };
  }),
  "POST /recover": open(async (c) => {
    const u = await c.db.prepare("SELECT id FROM users WHERE recovery_hash = ?").bind(await sha256hex(normCode(c.body.code))).first();
    if (!u) fail(404, "code not found");
    const token = randomToken(), recovery = randomCode(20);
    await c.db.batch([
      c.db.prepare("UPDATE users SET token_hash = ?, recovery_hash = ? WHERE id = ?").bind(await sha256hex(token), await sha256hex(recovery), u.id),
      c.db.prepare("DELETE FROM transfers WHERE user_id = ?").bind(u.id),
    ]);
    return { token, recovery: fmtCode(recovery), user: userOut(await getUser(c.db, u.id)) };
  }),

  // ---- 自分 ----
  "GET /me": authed(async (c) => ({ user: userOut(c.user) })),
  "POST /me": authed(async (c) => {
    const b = c.body, sets = [], args = [];
    if (b.name !== undefined) {
      const name = validName(b.name);
      if (!name) fail(400, "bad name");
      sets.push("name = ?"); args.push(name);
    }
    for (const [k, col] of [["showWeight", "show_weight"], ["inRanking", "in_ranking"]]) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== "boolean") fail(400, `bad ${k}`);
      sets.push(`${col} = ?`); args.push(b[k] ? 1 : 0);
    }
    if (sets.length) await c.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...args, c.user.id).run();
    // 重量を載せないにしたら、置いてある投稿からも重量を消す
    if (b.showWeight === false) {
      const { results } = await c.db.prepare("SELECT id, body_json FROM posts WHERE user_id = ?").bind(c.user.id).all();
      const st = results.map((p) => c.db.prepare("UPDATE posts SET body_json = ? WHERE id = ?").bind(JSON.stringify(stripWeights(JSON.parse(p.body_json))), p.id));
      if (st.length) await c.db.batch(st);
    }
    return { user: userOut(await getUser(c.db, c.user.id)) };
  }),
  "POST /me/friend-code": authed(async (c) => {
    await c.db.prepare("UPDATE users SET friend_code = ? WHERE id = ?").bind(await newFriendCode(c.db), c.user.id).run();
    return { user: userOut(await getUser(c.db, c.user.id)) };
  }),
  "POST /transfer/issue": authed(async (c) => {
    const code = randomCode(8), expiresAt = c.now + TRANSFER_MS;
    await c.db.batch([
      c.db.prepare("DELETE FROM transfers WHERE user_id = ?").bind(c.user.id),
      c.db.prepare("INSERT INTO transfers (code_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256hex(code), c.user.id, expiresAt),
    ]);
    return { code: fmtCode(code), expiresAt };
  }),
  "POST /account/delete": authed(async (c) => {
    const id = c.user.id;
    await c.db.batch([
      c.db.prepare("DELETE FROM likes WHERE user_id = ? OR post_id IN (SELECT id FROM posts WHERE user_id = ?)").bind(id, id),
      c.db.prepare("DELETE FROM posts WHERE user_id = ?").bind(id),
      c.db.prepare("DELETE FROM links WHERE a = ? OR b = ?").bind(id, id),
      c.db.prepare("DELETE FROM days WHERE user_id = ?").bind(id),
      c.db.prepare("DELETE FROM transfers WHERE user_id = ?").bind(id),
      c.db.prepare("DELETE FROM rate WHERE key = ?").bind(`u:${id}`),
      c.db.prepare("DELETE FROM users WHERE id = ?").bind(id),
    ]);
    return { ok: true };
  }),

  // ---- 仲間 ----
  "GET /links": authed(async (c) => {
    const me = c.user.id;
    const { results } = await c.db.prepare(
      `SELECT u.id, u.name, l.status, l.requested_by, l.created_at FROM links l
       JOIN users u ON u.id = CASE WHEN l.a = ? THEN l.b ELSE l.a END
       WHERE l.a = ? OR l.b = ? ORDER BY u.name`).bind(me, me, me).all();
    const out = { friends: [], incoming: [], outgoing: [] };
    for (const r of results) {
      const o = { id: r.id, name: r.name, since: r.created_at };
      if (r.status === "accepted") out.friends.push(o);
      else (r.requested_by === me ? out.outgoing : out.incoming).push(o);
    }
    return out;
  }),
  "POST /links/request": authed(async (c) => {
    const me = c.user.id;
    const other = await c.db.prepare("SELECT id FROM users WHERE friend_code = ?").bind(normCode(c.body.code)).first();
    if (!other) fail(404, "code not found");
    if (other.id === me) fail(400, "own code");
    const link = await getLink(c.db, me, other.id);
    if (link && link.status === "accepted") return { status: "accepted" };
    if (link && link.requested_by === me) return { status: "pending" };
    // 相手からも申請が来ていれば、それで承認したことにする
    if (link) { await acceptLink(c.db, me, other.id); return { status: "accepted" }; }
    const pending = await c.db.prepare("SELECT COUNT(*) AS n FROM links WHERE requested_by = ? AND status = 'pending'").bind(me).first();
    if (pending.n >= MAX_PENDING) fail(409, "too many requests");
    await checkFriendLimit(c.db, me, other.id);
    const [a, b] = pair(me, other.id);
    await c.db.prepare("INSERT INTO links (a, b, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, ?)").bind(a, b, me, c.now).run();
    return { status: "pending" };
  }),
  "POST /links/accept": authed(async (c) => {
    const link = await getLink(c.db, c.user.id, String(c.body.id || ""));
    if (!link || link.status !== "pending" || link.requested_by === c.user.id) fail(404, "request not found");
    await acceptLink(c.db, c.user.id, c.body.id);
    return { ok: true };
  }),
  "POST /links/reject": authed(async (c) => {
    const link = await getLink(c.db, c.user.id, String(c.body.id || ""));
    if (!link || link.status !== "pending" || link.requested_by === c.user.id) fail(404, "request not found");
    await removeLink(c.db, c.user.id, c.body.id);
    return { ok: true };
  }),
  // 仲間の解除と、自分が出した申請の取り消し
  "POST /links/remove": authed(async (c) => {
    if (!(await getLink(c.db, c.user.id, String(c.body.id || "")))) fail(404, "link not found");
    await removeLink(c.db, c.user.id, c.body.id);
    return { ok: true };
  }),

  // ---- 共有とタイムライン ----
  "POST /posts": authed(async (c) => {
    const date = validPostKey(c.body.key);
    if (!date || date > addDays(jstDate(c.now), 1)) fail(400, "bad key");
    const title = cleanTitle(c.body.routineTitle);
    if (title == null) fail(400, "bad title");
    const body = cleanPostBody(c.body.body, !!c.user.show_weight);
    if (!body) fail(400, "bad body");
    const id = randomCode(12);
    await c.db.prepare(
      `INSERT INTO posts (id, user_id, key, date, routine_title, body_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET routine_title = excluded.routine_title, body_json = excluded.body_json, updated_at = excluded.updated_at`)
      .bind(id, c.user.id, c.body.key, date, title, JSON.stringify(body), c.now).run();
    const p = await c.db.prepare("SELECT id, key, date, routine_title, body_json, updated_at FROM posts WHERE user_id = ? AND key = ?").bind(c.user.id, c.body.key).first();
    return { post: { id: p.id, key: p.key, date: p.date, routineTitle: p.routine_title, body: JSON.parse(p.body_json), updatedAt: p.updated_at } };
  }),
  "POST /posts/delete": authed(async (c) => {
    const p = await c.db.prepare("SELECT id FROM posts WHERE user_id = ? AND key = ?").bind(c.user.id, String(c.body.key || "")).first();
    if (p) await c.db.batch([
      c.db.prepare("DELETE FROM likes WHERE post_id = ?").bind(p.id),
      c.db.prepare("DELETE FROM posts WHERE id = ?").bind(p.id),
    ]);
    return { ok: true };
  }),
  "GET /timeline": authed(async (c) => {
    const ids = await visibleIds(c.db, c.user.id);
    const before = c.url.searchParams.get("before");
    if (before != null && !validDate(before)) fail(400, "bad before");
    const { results: posts } = await c.db.prepare(
      `SELECT p.id, p.user_id, u.name, p.key, p.date, p.routine_title, p.body_json, p.updated_at FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.user_id IN (SELECT value FROM json_each(?)) AND p.date < ? ORDER BY p.date DESC, p.updated_at DESC LIMIT 50`)
      .bind(JSON.stringify(ids), before || "9999-12-31").all();
    const { results: likes } = posts.length ? await c.db.prepare(
      `SELECT l.post_id, l.user_id, u.name FROM likes l JOIN users u ON u.id = l.user_id
       WHERE l.post_id IN (SELECT value FROM json_each(?)) ORDER BY l.created_at`).bind(JSON.stringify(posts.map((p) => p.id))).all() : { results: [] };
    // 押した人の名前は、自分と仲間だけ見せる（仲間の仲間の名前は「ほか N 人」）
    const seen = new Set(ids);
    return {
      posts: posts.map((p) => {
        const ls = likes.filter((l) => l.post_id === p.id);
        return {
          id: p.id, user: { id: p.user_id, name: p.name }, mine: p.user_id === c.user.id, key: p.user_id === c.user.id ? p.key : undefined,
          date: p.date, routineTitle: p.routine_title, body: JSON.parse(p.body_json), updatedAt: p.updated_at,
          likes: ls.length, liked: ls.some((l) => l.user_id === c.user.id),
          likers: ls.filter((l) => seen.has(l.user_id)).map((l) => l.name), likersOther: ls.filter((l) => !seen.has(l.user_id)).length,
        };
      }),
    };
  }),
  "POST /likes/toggle": authed(async (c) => {
    const p = await c.db.prepare("SELECT user_id FROM posts WHERE id = ?").bind(String(c.body.postId || "")).first();
    if (!p || !(await visibleIds(c.db, c.user.id)).includes(p.user_id)) fail(404, "post not found");
    const del = await c.db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?").bind(c.body.postId, c.user.id).run();
    if (del.meta.changes) return { liked: false };
    await c.db.prepare("INSERT INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)").bind(c.body.postId, c.user.id, c.now).run();
    return { liked: true };
  }),

  // ---- ランキング ----
  "POST /days": authed(async (c) => {
    const days = c.body.days;
    if (!Array.isArray(days) || days.length > 60) fail(400, "bad days");
    const today = jstDate(c.now), st = [];
    for (const d of days) {
      if (!d || !validDate(d.date) || d.date < addDays(today, -35) || d.date > addDays(today, 1)) fail(400, "bad date");
      if (typeof d.planned !== "boolean" || typeof d.trained !== "boolean") fail(400, "bad day");
      st.push(c.db.prepare("INSERT INTO days (user_id, date, planned, trained) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET planned = excluded.planned, trained = excluded.trained")
        .bind(c.user.id, d.date, d.planned ? 1 : 0, d.trained ? 1 : 0));
    }
    if (c.body.weekdays !== undefined) {
      const w = cleanWeekdays(c.body.weekdays);
      if (w == null) fail(400, "bad weekdays");
      st.push(c.db.prepare("UPDATE users SET plan_weekdays = ? WHERE id = ?").bind(w, c.user.id));
    }
    if (st.length) await c.db.batch(st);
    return { ok: true };
  }),
  "GET /ranking": authed(async (c) => {
    const week = c.url.searchParams.get("week") || "this";
    if (week !== "this" && week !== "last") fail(400, "bad week");
    const today = jstDate(c.now);
    const start = addDays(weekStart(today), week === "last" ? -7 : 0);
    const ids = await visibleIds(c.db, c.user.id);
    const { results: users } = await c.db.prepare(
      "SELECT id, name, plan_weekdays, created_at FROM users WHERE in_ranking = 1 AND id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all();
    const { results: rows } = await c.db.prepare(
      "SELECT user_id, date, planned, trained FROM days WHERE user_id IN (SELECT value FROM json_each(?)) AND date >= ? AND date <= ?")
      .bind(JSON.stringify(users.map((u) => u.id)), start, addDays(start, 6)).all();
    const byUser = {};
    for (const r of rows) (byUser[r.user_id] = byUser[r.user_id] || {})[r.date] = r;
    const people = users.map((u) => ({ id: u.id, name: u.name, plan: u.plan_weekdays, since: jstDate(u.created_at) }));
    const out = rankWeek(people, byUser, start, today);
    for (const x of [...out.rate, ...out.days]) x.me = x.id === c.user.id;
    return out;
  }),
};

// ---- 補助 ----

async function authUser(c) {
  const m = (c.req.headers.get("Authorization") || "").match(/^Bearer ([A-Za-z0-9_-]{20,100})$/);
  if (!m) fail(401, "no token");
  const u = await c.db.prepare("SELECT * FROM users WHERE token_hash = ?").bind(await sha256hex(m[1])).first();
  if (!u) fail(401, "bad token");
  return u;
}

// 1分ごとの回数を数え、上限を超えたら断る。古い記録はときどき消す
async function limit(c, key, max) {
  const win = Math.floor(c.now / 60000);
  const r = await c.db.prepare("INSERT INTO rate (key, win, n) VALUES (?, ?, 1) ON CONFLICT (key, win) DO UPDATE SET n = n + 1 RETURNING n").bind(key, win).first();
  if (Math.random() < 0.02) await c.db.prepare("DELETE FROM rate WHERE win < ?").bind(win - 2).run();
  if (r.n > max) fail(429, "too many requests");
}

async function getUser(db, id) { return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first(); }
function userOut(u) {
  return { id: u.id, name: u.name, friendCode: fmtCode(u.friend_code), showWeight: !!u.show_weight, inRanking: !!u.in_ranking };
}
async function newFriendCode(db) {
  for (let i = 0; i < 5; i++) {
    const code = randomCode(8);
    if (!(await db.prepare("SELECT 1 FROM users WHERE friend_code = ?").bind(code).first())) return code;
  }
  fail(500, "could not make code");
}

const pair = (x, y) => (x < y ? [x, y] : [y, x]);
async function getLink(db, x, y) {
  const [a, b] = pair(x, y);
  return db.prepare("SELECT * FROM links WHERE a = ? AND b = ?").bind(a, b).first();
}
async function checkFriendLimit(db, x, y) {
  const n = await db.prepare(
    "SELECT SUM(CASE WHEN a = ? OR b = ? THEN 1 ELSE 0 END) AS x, SUM(CASE WHEN a = ? OR b = ? THEN 1 ELSE 0 END) AS y FROM links WHERE status = 'accepted'")
    .bind(x, x, y, y).first();
  if ((n.x || 0) >= MAX_FRIENDS || (n.y || 0) >= MAX_FRIENDS) fail(409, "too many friends");
}
async function acceptLink(db, x, y) {
  await checkFriendLimit(db, x, y);
  const [a, b] = pair(x, y);
  await db.prepare("UPDATE links SET status = 'accepted' WHERE a = ? AND b = ?").bind(a, b).run();
}
// つながりを消し、お互いの投稿に付けたいいねも消す
async function removeLink(db, x, y) {
  const [a, b] = pair(x, y);
  await db.batch([
    db.prepare("DELETE FROM links WHERE a = ? AND b = ?").bind(a, b),
    db.prepare("DELETE FROM likes WHERE (user_id = ? AND post_id IN (SELECT id FROM posts WHERE user_id = ?)) OR (user_id = ? AND post_id IN (SELECT id FROM posts WHERE user_id = ?))").bind(x, y, y, x),
  ]);
}
// 自分と、承認済みの仲間
async function visibleIds(db, me) {
  const { results } = await db.prepare("SELECT CASE WHEN a = ? THEN b ELSE a END AS id FROM links WHERE (a = ? OR b = ?) AND status = 'accepted'").bind(me, me, me).all();
  return [me, ...results.map((r) => r.id)];
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = { "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(o, status, headers) {
  return new Response(JSON.stringify(o), { status, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, headers) });
}
