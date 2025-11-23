-- 会话日志记录
CREATE TABLE IF NOT EXISTS conversation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT,
  timestamp INTEGER NOT NULL,
  user_name TEXT,
  time_zone TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_user_date
  ON conversation_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_conversation_user_timestamp
  ON conversation_logs(user_id, timestamp);

-- 日记缓存
CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  mood TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diary_user_date
  ON diary_entries(user_id, date);
