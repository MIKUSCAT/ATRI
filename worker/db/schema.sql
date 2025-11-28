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

-- 每日学习总结（从当天对话+日记提炼）
CREATE TABLE IF NOT EXISTS daily_learning (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  summary TEXT,
  payload TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_user_date
  ON daily_learning(user_id, date);

-- 结构化长期记忆（用户偏好/禁忌/关系等）
CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  importance INTEGER DEFAULT 5,
  evidence TEXT,
  source_date TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_user
  ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_category
  ON user_memories(user_id, category);
CREATE INDEX IF NOT EXISTS idx_memories_user_importance
  ON user_memories(user_id, importance DESC);
