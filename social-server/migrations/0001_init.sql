-- 仲間とのランキングと記録の共有（CLAUDE.md 14.4）
-- 時刻はすべてミリ秒（Date.now()）。日付は日本時間の 'YYYY-MM-DD'。

-- token_hash・recovery_hash はトークンと復旧コードの SHA-256（元の値は持たない）
-- plan_weekdays はルーティンに曜日を設定した曜日（"135" なら月・水・金）。日ごとの記録が届いていない日の予定日の判定に使う
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  friend_code TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  recovery_hash TEXT NOT NULL UNIQUE,
  show_weight INTEGER NOT NULL DEFAULT 1,
  in_ranking INTEGER NOT NULL DEFAULT 1,
  plan_weekdays TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- つながり。a < b の順で1行。status は pending（申請中）か accepted
CREATE TABLE links (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX links_b ON links (b);

-- 共有した記録。key は手帳の workouts のキー（<YYYY-MM-DD>_<dayKey>）。共有し直すと上書き
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  date TEXT NOT NULL,
  routine_title TEXT NOT NULL,
  body_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, key)
);
CREATE INDEX posts_user_date ON posts (user_id, date);

CREATE TABLE likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX likes_user ON likes (user_id);

-- ランキング用の日ごとの記録
CREATE TABLE days (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  planned INTEGER NOT NULL,
  trained INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);

-- 引き継ぎコード（10分・1回だけ）。1人1つ
CREATE TABLE transfers (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);

-- 送信回数の制限。key は "u:<id>" か "ip:<接続元>"、win は分（Date.now()/60000 の整数部）
CREATE TABLE rate (
  key TEXT NOT NULL,
  win INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);
