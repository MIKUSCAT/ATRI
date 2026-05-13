-- 运行时配置表（与 server 对齐）
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
