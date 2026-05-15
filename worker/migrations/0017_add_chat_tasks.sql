-- 0017_add_chat_tasks.sql
-- 聊天异步任务：POST /api/v1/chat 创建任务，队列消费生成回复，GET /api/v1/chat/task 查询结果

CREATE TABLE IF NOT EXISTS chat_tasks (
  task_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  log_id TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  reply_log_id TEXT NOT NULL,
  reply_timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_tasks_user_log
  ON chat_tasks(user_id, log_id);

CREATE INDEX IF NOT EXISTS idx_chat_tasks_status_updated
  ON chat_tasks(status, updated_at);
