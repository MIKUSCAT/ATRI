-- 新增对话删除墓碑表（用于 /conversation/pull 增量同步删除）
CREATE TABLE IF NOT EXISTS conversation_log_tombstones (
  user_id TEXT NOT NULL,
  log_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, log_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_tombstone_user_deleted_at
  ON conversation_log_tombstones(user_id, deleted_at);
