// 休憩タイマーの通知サーバー（Cloudflare Workers + Durable Objects）
//
// 手帳から「この宛先（プッシュ通知の購読）に、この時刻に知らせて」と受け取り、その時刻に Web Push を送る。
// 受け取るのは購読の宛先と終了時刻だけ（記録は受け取らない）。
//
// POST /schedule  { subscription: {endpoint, ...}, at: 終了時刻(ms) }  … 予約（同じ宛先の前の予約は置き換え）
// POST /cancel    { endpoint }                                         … 取り消し
// GET  /health                                                         … 動作確認
//
// 環境変数: VAPID_PUBLIC（公開鍵 base64url）, VAPID_PRIVATE_JWK（秘密鍵 JWK の JSON。secret に入れる）,
//          VAPID_SUBJECT（連絡先 URL）, ALLOWED_ORIGINS（カンマ区切り）
import { DurableObject } from "cloudflare:workers";
import { sendPush, validEndpoint } from "./vapid.js";

const MAX_DELAY_MS = 60 * 60 * 1000; // 予約は1時間先まで

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/health") return json({ ok: true, key: env.VAPID_PUBLIC }, 200, cors);
      if (req.method !== "POST") return json({ error: "not found" }, 404, cors);
      if (!cors["Access-Control-Allow-Origin"]) return json({ error: "origin not allowed" }, 403, cors);
      const body = await req.json();
      const endpoint = url.pathname === "/schedule" ? body.subscription && body.subscription.endpoint : body.endpoint;
      if (!validEndpoint(endpoint) && !(env.ALLOW_TEST_ENDPOINT && endpoint === env.ALLOW_TEST_ENDPOINT)) return json({ error: "bad endpoint" }, 400, cors);
      const stub = env.TIMERS.get(env.TIMERS.idFromName(endpoint));
      if (url.pathname === "/schedule") {
        const at = Number(body.at);
        if (!Number.isFinite(at) || at < Date.now() - 5000 || at > Date.now() + MAX_DELAY_MS) return json({ error: "bad time" }, 400, cors);
        await stub.schedule(endpoint, at);
        return json({ ok: true, at }, 200, cors);
      }
      if (url.pathname === "/cancel") {
        await stub.cancel();
        return json({ ok: true }, 200, cors);
      }
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500, cors);
    }
  },
};

// 宛先ごとに1つ。予約の時刻にアラームを鳴らして通知を送る
export class RestTimer extends DurableObject {
  async schedule(endpoint, at) {
    await this.ctx.storage.put("endpoint", endpoint);
    await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 100));
  }
  async cancel() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
  async alarm() {
    const endpoint = await this.ctx.storage.get("endpoint");
    await this.ctx.storage.deleteAll();
    if (endpoint) await sendPush(endpoint, this.env);
  }
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = { "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(o, status, headers) {
  return new Response(JSON.stringify(o), { status, headers: Object.assign({ "Content-Type": "application/json" }, headers) });
}
