-- 会话日志记录
CREATE TABLE IF NOT EXISTS conversation_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT,
  reply_to TEXT,
  timestamp INTEGER NOT NULL,
  user_name TEXT,
  time_zone TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_user_date
  ON conversation_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_conversation_user_timestamp
  ON conversation_logs(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_conversation_user_reply_to
  ON conversation_logs(user_id, reply_to);

-- 对话删除墓碑（用于多端同步删除）
CREATE TABLE IF NOT EXISTS conversation_log_tombstones (
  user_id TEXT NOT NULL,
  log_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, log_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_tombstone_user_deleted_at
  ON conversation_log_tombstones(user_id, deleted_at);

-- 用户状态记录（状态胶囊/亲密度）
CREATE TABLE IF NOT EXISTS user_states (
  user_id TEXT PRIMARY KEY,
  status_label TEXT NOT NULL DEFAULT '陪着你',
  status_pill_color TEXT NOT NULL DEFAULT '#7E8EA3',
  status_text_color TEXT NOT NULL DEFAULT '#FFFFFF',
  status_reason TEXT,
  status_updated_at INTEGER NOT NULL,
  intimacy INTEGER DEFAULT 0,
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

-- 主动消息队列（由 cron 生成，App 拉取）
CREATE TABLE IF NOT EXISTS proactive_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  trigger_context TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  notification_channel TEXT,
  notification_sent INTEGER NOT NULL DEFAULT 0,
  notification_error TEXT,
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

-- 事实记忆（用于 remember_fact / forget_fact）
CREATE TABLE IF NOT EXISTS fact_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fact_user_updated_at
  ON fact_memories(user_id, updated_at);

-- 运行时配置（与 server 对齐，供 runtime-settings 读取）
CREATE TABLE IF NOT EXISTS admin_runtime_config (
  id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  secrets_ciphertext TEXT,
  secrets_iv TEXT,
  secrets_tag TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_prompts_override (
  id TEXT PRIMARY KEY,
  prompts_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
