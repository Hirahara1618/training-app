# 休憩タイマーの通知サーバー

手帳で休憩タイマーを始めると、終了時刻をこのサーバーに予約し、時刻になったら Web Push で「休憩終了」を通知する。
画面を消していても届く（iPhone はホーム画面に追加した手帳で、iOS 16.4 以降）。

- Cloudflare Workers ＋ Durable Objects（SQLite 版、アラーム）。無料プランの範囲で動く。
- 受け取るのは**プッシュの宛先（endpoint）と終了時刻だけ**。記録は送らない。予約は終わると消す。
- 通知は本文なし（暗号化が不要）。文言は端末の Service Worker（`src/pwa/sw.js`）が出す。
- 受け付けるのは `ALLOWED_ORIGINS` からの要求と、Apple・Google・Mozilla・Microsoft のプッシュの宛先だけ。

## ファイル

| ファイル | 内容 |
|---|---|
| `src/index.js` | Worker（`/schedule`, `/cancel`, `/health`）と Durable Object `RestTimer` |
| `src/vapid.js` | VAPID の署名（ES256）と送信 |
| `wrangler.toml` | 設定。`VAPID_PUBLIC` に公開鍵 |
| `vapid-keys.mjs` | 鍵を作る（1回だけ） |
| `test.mjs` | 署名・ヘッダー・宛先制限の検査（`node test.mjs`） |
| `e2e.mjs` | `wrangler dev` を動かし、偽の宛先に予約どおり届くか・取り消せるかの通し検査（`npm run e2e`） |
| `client.json` | 手帳に入れる `{url, key}`。ビルド（`tools/build.mjs`）が読む。なければ通知の設定欄を出さない |

## はじめての公開

1. Cloudflare のアカウントを作る（無料）: https://dash.cloudflare.com/sign-up
2. ログイン: `cd push-server && npm install && npx wrangler login`（ブラウザが開くので許可）
3. 鍵を作る: `node vapid-keys.mjs` → 公開鍵を `wrangler.toml` の `VAPID_PUBLIC` へ、秘密鍵は
   `npx wrangler secret put VAPID_PRIVATE_JWK` で入れる（**リポジトリには入れない**）
4. 公開: `npx wrangler deploy` → 表示された `https://training-push.<名前>.workers.dev` を `client.json` の `url` に、公開鍵を `key` に
5. 手帳をビルドして公開すると、履歴タブに「休憩タイマーの通知」が出る

鍵を作り直すと、端末の購読がすべて無効になる（各端末で通知をオンにし直す）。
