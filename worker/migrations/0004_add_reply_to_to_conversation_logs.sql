-- 为 conversation_logs 表添加 reply_to 字段
ALTER TABLE conversation_logs ADD COLUMN reply_to TEXT;

CREATE INDEX IF NOT EXISTS idx_conversation_user_reply_to
  ON conversation_logs(user_id, reply_to);
