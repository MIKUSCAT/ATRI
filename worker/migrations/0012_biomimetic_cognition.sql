-- 仿生认知重构：白天轻量聊天 + 夜间深整理

CREATE TABLE IF NOT EXISTS chat_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_log_id TEXT,
  reply_log_id TEXT,
  status TEXT NOT NULL,
  route TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_turns_user_started
  ON chat_turns(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_log_id TEXT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 5,
  confidence REAL NOT NULL DEFAULT 0.7,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_user_status_created
  ON memory_candidates(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS atri_self_model (
  user_id TEXT PRIMARY KEY,
  model_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nightly_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_nightly_runs_user_date
  ON nightly_runs(user_id, date, stage);
