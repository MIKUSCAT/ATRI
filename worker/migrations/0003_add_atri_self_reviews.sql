-- 新增 ATRI 说话方式自我审查表（仅 ATRI 自己看）
CREATE TABLE IF NOT EXISTS atri_self_reviews (
  user_id TEXT PRIMARY KEY,
  content TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
