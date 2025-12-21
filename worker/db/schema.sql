-- 会话日志记录
CREATE TABLE IF NOT EXISTS conversation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT,
  mood TEXT,
  timestamp INTEGER NOT NULL,
  user_name TEXT,
  time_zone TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_user_date
  ON conversation_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_conversation_user_timestamp
  ON conversation_logs(user_id, timestamp);

-- 用户状态记录（PAD/亲密度等）
CREATE TABLE IF NOT EXISTS user_states (
  user_id TEXT PRIMARY KEY,
  pad_values TEXT NOT NULL,
  intimacy INTEGER DEFAULT 0,
  energy INTEGER DEFAULT 100,
  last_interaction_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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

-- 用户偏好设置（模型等）
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  model_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 用户长期档案（事实/喜好/雷区/说话风格/关系进展）
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  content TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ATRI 说话方式自我审查表（仅 ATRI 自己看，每天更新一份）
CREATE TABLE IF NOT EXISTS atri_self_reviews (
  user_id TEXT PRIMARY KEY,
  content TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
