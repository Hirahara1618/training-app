// 手帳のテスト用の共有サーバー：social-server の Worker 本体を、D1 の代わりに Node の SQLite（メモリ上）で動かす。
// ブラウザの通信は Playwright の page.route でここへ流す（wrangler なしで、本物と同じ処理を通す）。
//
//   const mock = await createSocialMock({ origins: ["http://localhost:8094"] });
//   await mock.attach(context, "https://social.test");   // その URL への通信を Worker に流す
//   mock.requests  … 届いた要求の一覧 [{ method, path }]
//   mock.offline = true  … 通信を失敗させる（オフラインの再現）
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "social-server");

// D1 と同じ形（prepare().bind().first/all/run と batch）の薄い包み
function d1(sqlite) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    _run() { return sqlite.prepare(sql).run(...args); },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      sqlite.exec("BEGIN");
      try { for (const s of list) s._run(); sqlite.exec("COMMIT"); }
      catch (e) { sqlite.exec("ROLLBACK"); throw e; }
      return [];
    },
  };
}

export async function createSocialMock({ origins }) {
  const sqlite = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync(path.join(SERVER, "migrations")).sort()) sqlite.exec(fs.readFileSync(path.join(SERVER, "migrations", f), "utf8"));
  const worker = (await import(pathToFileURL(path.join(SERVER, "src/index.js")).href)).default;
  const env = { DB: d1(sqlite), ALLOWED_ORIGINS: origins.join(","), RATE_USER: "1000", RATE_IP: "1000" };
  const mock = {
    sqlite, requests: [], offline: false,
    query: (sql, ...args) => sqlite.prepare(sql).all(...args),
    async fetch(req) { return worker.fetch(req, env); },
    async attach(context, base) {
      await context.route(`${base}/**`, async (route) => {
        const r = route.request();
        const url = new URL(r.url());
        if (r.method() !== "OPTIONS") mock.requests.push({ method: r.method(), path: url.pathname });
        if (mock.offline) return route.abort("internetdisconnected");
        const res = await mock.fetch(new Request(r.url(), { method: r.method(), headers: r.headers(), body: r.method() === "POST" ? r.postData() : undefined }));
        await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
      });
    },
    // テストの中から直接呼ぶ（仲間役のユーザーを作るときなど）
    async call(method, p, body, token) {
      const headers = { "Content-Type": "application/json", Origin: origins[0] };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await mock.fetch(new Request(`https://mock${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
      const j = await res.json();
      if (!res.ok) throw new Error(`${p} ${res.status} ${JSON.stringify(j)}`);
      return j;
    },
  };
  return mock;
}
