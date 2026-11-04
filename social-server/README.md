# 共有サーバー（仲間とのランキングと記録の共有）

CLAUDE.md 14章のサーバー。Cloudflare Workers + D1（無料枠）。API の一覧は `src/index.js` の冒頭。

## 検査

```
npm install
npm test        # 日付・コード・入力の検査・ランキングの計算（Node だけ）
npm run e2e     # wrangler dev のローカル D1 で、登録から削除までを通しで確かめる
```

## 公開（初回）

```
npx wrangler login
npx wrangler d1 create training-social
# 表示された database_id を wrangler.toml に書く
npm run deploy  # D1 に表を作り（migrations）、Worker を公開する
```

表を変えるときは `migrations/` に `0002_*.sql` を足して `npm run deploy`。
