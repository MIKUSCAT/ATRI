-- 新增事实记忆表（用于 remember_fact / forget_fact）
CREATE TABLE IF NOT EXISTS fact_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fact_user_updated_at
  ON fact_memories(user_id, updated_at);
