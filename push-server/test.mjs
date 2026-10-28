// 通知サーバーの検査（Node だけで動く部分）: VAPID の署名が公開鍵で検証できるか、送信のヘッダー、宛先の制限
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { vapidJwt, sendPush, validEndpoint, b64url } = await import("./src/vapid.js");

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const pub = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
const env = { VAPID_PUBLIC: pub, VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_SUBJECT: "https://example.com/" };

const unb64 = (s) => Uint8Array.from(Buffer.from(s, "base64url"));

// 1. JWT が ES256 で、公開鍵（raw）で検証できる
const jwt = await vapidJwt("https://web.push.apple.com", env);
const [h, p, s] = jwt.split(".");
assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { typ: "JWT", alg: "ES256" });
const claims = JSON.parse(Buffer.from(p, "base64url"));
assert.equal(claims.aud, "https://web.push.apple.com");
assert.equal(claims.sub, "https://example.com/");
assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, "exp は24時間以内");
assert.equal(unb64(s).length, 64, "署名は r||s の64バイト");
const verifyKey = await crypto.subtle.importKey("raw", unb64(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, unb64(s), new TextEncoder().encode(`${h}.${p}`)), "署名が検証できる");
console.log("OK VAPID の署名");

// 2. 送信のヘッダー
let sent;
const status = await sendPush("https://web.push.apple.com/abc", env, async (url, init) => { sent = { url, init }; return { status: 201 }; });
assert.equal(status, 201);
assert.equal(sent.url, "https://web.push.apple.com/abc");
assert.equal(sent.init.method, "POST");
assert.match(sent.init.headers.Authorization, new RegExp("^vapid t=[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+, k=" + pub + "$"));
assert.equal(sent.init.headers.Urgency, "high");
assert.ok(Number(sent.init.headers.TTL) > 0);
console.log("OK 送信のヘッダー");

// 3. 宛先の制限
assert.ok(validEndpoint("https://web.push.apple.com/QGx"));
assert.ok(validEndpoint("https://fcm.googleapis.com/fcm/send/x"));
assert.ok(!validEndpoint("http://web.push.apple.com/x"));
assert.ok(!validEndpoint("https://evil.example.com/x"));
assert.ok(!validEndpoint("https://push.apple.com.evil.com/x"));
assert.ok(!validEndpoint(null));
console.log("OK 宛先の制限");
