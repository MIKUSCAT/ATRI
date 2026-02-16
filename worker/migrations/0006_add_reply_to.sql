-- 为会话日志补充 reply_to（支持续写/重试链路）
ALTER TABLE conversation_logs ADD COLUMN reply_to TEXT;

CREATE INDEX IF NOT EXISTS idx_conversation_user_reply_to
  ON conversation_logs(user_id, reply_to);
