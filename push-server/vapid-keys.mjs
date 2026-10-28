// VAPID の鍵を作る（1回だけ）。使い方: node vapid-keys.mjs
// 出力の「公開鍵」を wrangler.toml の VAPID_PUBLIC と手帳の設定に、「秘密鍵」を secret に入れる:
//   npx wrangler secret put VAPID_PRIVATE_JWK   （聞かれたら秘密鍵の JSON を貼る）
import { webcrypto as crypto } from "node:crypto";

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const b64url = (b) => Buffer.from(b).toString("base64url");
console.log("公開鍵（VAPID_PUBLIC）:");
console.log(b64url(raw));
console.log("\n秘密鍵（VAPID_PRIVATE_JWK、人に見せない）:");
console.log(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
