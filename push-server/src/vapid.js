// Web Push の送信（本文なし、RFC 8030）と VAPID の署名（RFC 8292）。Node でも動く（検査用）

// 本文なしで送る。暗号化が要らず、通知の文言は端末の Service Worker が決める
export async function sendPush(endpoint, env, fetchImpl) {
  const jwt = await vapidJwt(new URL(endpoint).origin, env);
  const res = await (fetchImpl || fetch)(endpoint, {
    method: "POST",
    headers: { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, TTL: "120", Urgency: "high", "Content-Length": "0" },
  });
  return res.status;
}

export async function vapidJwt(aud, env) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "https://hirahara1618.github.io/training-app/" };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto の ECDSA 署名は r||s（64バイト）で、JWT の ES256 の形そのもの
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

// プッシュサービスの宛先だけを受け付ける（任意の URL へ送らせない）
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
export function validEndpoint(e) {
  if (typeof e !== "string" || e.length > 1000) return false;
  let u;
  try { u = new URL(e); } catch (err) { return false; }
  return u.protocol === "https:" && PUSH_HOSTS.some((r) => r.test(u.hostname));
}

export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
