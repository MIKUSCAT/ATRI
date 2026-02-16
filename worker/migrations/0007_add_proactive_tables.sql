-- 主动消息队列与状态表
CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  trigger_context TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_user_created
  ON proactive_messages(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_status_created
  ON proactive_messages(status, created_at DESC);

CREATE TABLE IF NOT EXISTS proactive_user_state (
  user_id TEXT PRIMARY KEY,
  last_proactive_at INTEGER NOT NULL DEFAULT 0,
  daily_count INTEGER NOT NULL DEFAULT 0,
  daily_count_date TEXT,
  updated_at INTEGER NOT NULL
);
