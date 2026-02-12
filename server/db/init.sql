-- 只放“必需、可重复执行”的初始化（首次启动会自动执行）

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS conversation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT,
  reply_to TEXT,
  timestamp BIGINT NOT NULL,
  user_name TEXT,
  time_zone TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_user_date
  ON conversation_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_conversation_user_timestamp
  ON conversation_logs(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_conversation_user_reply_to
  ON conversation_logs(user_id, reply_to);

-- 记录被撤回/删除的对话日志，用于阻止晚到消息/回复落库
CREATE TABLE IF NOT EXISTS conversation_log_tombstones (
  user_id TEXT NOT NULL,
  log_id TEXT NOT NULL,
  deleted_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, log_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_tombstone_user
  ON conversation_log_tombstones(user_id);

CREATE TABLE IF NOT EXISTS user_states (
  user_id TEXT PRIMARY KEY,
  status_label TEXT NOT NULL,
  status_pill_color TEXT NOT NULL,
  status_text_color TEXT NOT NULL,
  status_reason TEXT,
  status_updated_at BIGINT NOT NULL,
  intimacy INTEGER DEFAULT 0,
  last_interaction_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  mood TEXT,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diary_user_date
  ON diary_entries(user_id, date);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  model_key TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  content TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_vectors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  mood TEXT,
  importance INTEGER DEFAULT 6,
  timestamp BIGINT NOT NULL,
  embedding vector(1024)
);

CREATE INDEX IF NOT EXISTS idx_memory_user_date
  ON memory_vectors(user_id, date);

-- 管理后台：运行时配置与提示词覆盖（可选，不影响旧部署）

CREATE TABLE IF NOT EXISTS admin_runtime_config (
  id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  secrets_ciphertext TEXT,
  secrets_iv TEXT,
  secrets_tag TEXT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_prompts_override (
  id TEXT PRIMARY KEY,
  prompts_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
