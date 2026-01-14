-- 记录被撤回/删除的对话日志，用于阻止晚到回复落库
CREATE TABLE IF NOT EXISTS conversation_log_tombstones (
  user_id TEXT NOT NULL,
  log_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, log_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_tombstone_user
  ON conversation_log_tombstones(user_id);
