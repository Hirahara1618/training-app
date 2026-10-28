// 手元での通し検査: wrangler dev で Worker を動かし、偽のプッシュ宛先（localhost）に予約どおり届くか・取り消せるかを見る
// 使い方: node e2e.mjs（.dev.vars を一時的に作り、終わったら消す）
import { webcrypto } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import assert from "node:assert/strict";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { b64url } = await import("./src/vapid.js");

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const pub = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
const MOCK = "http://127.0.0.1:8799/push/abc";
fs.writeFileSync(".dev.vars", `VAPID_PRIVATE_JWK='${JSON.stringify(jwk)}'\nVAPID_PUBLIC=${pub}\nALLOW_TEST_ENDPOINT=${MOCK}\n`);

const hits = [];
const mock = http.createServer((req, res) => { hits.push({ t: Date.now(), url: req.url, auth: req.headers.authorization, urgency: req.headers.urgency }); res.writeHead(201); res.end(); }).listen(8799);
const dev = spawn("npx", ["wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1"], { shell: true, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = "http://127.0.0.1:8787";
const post = (p, body, origin = "http://localhost:8080") => fetch(W + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });

let ok = false;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(W + "/health")).ok) break; } catch (e) {} await sleep(1000); }
  // 許可されていない場所からは断る
  assert.equal((await post("/schedule", { subscription: { endpoint: MOCK }, at: Date.now() + 1000 }, "https://evil.example.com")).status, 403);
  assert.equal((await post("/schedule", { subscription: { endpoint: "https://evil.example.com/x" }, at: Date.now() + 1000 })).status, 400);
  // 予約 → 届く
  const at = Date.now() + 2500;
  const r = await post("/schedule", { subscription: { endpoint: MOCK }, at });
  assert.equal(r.status, 200, await r.text());
  assert.equal(r.headers.get("access-control-allow-origin"), "http://localhost:8080");
  for (let i = 0; i < 40 && !hits.length; i++) await sleep(250);
  assert.equal(hits.length, 1, "予約の時刻に届く");
  assert.ok(hits[0].t >= at - 300, `早すぎない（${hits[0].t - at}ms）`);
  assert.ok(hits[0].t <= at + 3000, `遅すぎない（${hits[0].t - at}ms）`);
  assert.equal(hits[0].urgency, "high");
  const [, jwt, k] = hits[0].auth.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, pub);
  const [h, p, s] = jwt.split(".");
  const vk = await crypto.subtle.importKey("raw", Buffer.from(pub, "base64url"), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${p}`)));
  console.log(`OK 予約どおり届いた（${hits[0].t - at}ms 差）、署名も正しい`);
  // 予約の置き換え → 取り消し → 届かない
  await post("/schedule", { subscription: { endpoint: MOCK }, at: Date.now() + 1500 });
  await post("/schedule", { subscription: { endpoint: MOCK }, at: Date.now() + 2000 });
  assert.equal((await post("/cancel", { endpoint: MOCK })).status, 200);
  await sleep(3500);
  assert.equal(hits.length, 1, "取り消した予約は届かない");
  console.log("OK 取り消し");
  ok = true;
} catch (e) {
  console.error(e);
  console.error(log.slice(-3000));
} finally {
  mock.close();
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(dev.pid), "/t", "/f"]);
  else dev.kill();
  fs.rmSync(".dev.vars", { force: true });
  setTimeout(() => process.exit(ok ? 0 : 1), 500);
}
