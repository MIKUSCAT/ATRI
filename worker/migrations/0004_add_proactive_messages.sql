-- 主动消息计划表（每日生成）
CREATE TABLE IF NOT EXISTS proactive_schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  slot INTEGER NOT NULL,
  scheduled_hour INTEGER NOT NULL,
  scheduled_minute INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  trigger_type TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_proactive_user_date 
  ON proactive_schedules(user_id, date, status);

-- 主动消息记录表
CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  schedule_id TEXT,
  content TEXT NOT NULL,
  context_type TEXT,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proactive_msg_user 
  ON proactive_messages(user_id, timestamp);

-- 用户主动消息偏好
CREATE TABLE IF NOT EXISTS proactive_settings (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  daily_count INTEGER DEFAULT 2,
  quiet_start INTEGER DEFAULT 22,
  quiet_end INTEGER DEFAULT 8,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);