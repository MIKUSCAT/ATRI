-- 0016_add_regenerate_tasks.sql
-- 异步日记重生成任务进度跟踪表
-- 用于 POST /diary/regenerate 立即返回 taskId + 后续 GET /diary/regenerate/status 轮询

CREATE TABLE IF NOT EXISTS regenerate_tasks (
  task_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  percent INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_regenerate_tasks_user_date
  ON regenerate_tasks(user_id, date, updated_at DESC);
