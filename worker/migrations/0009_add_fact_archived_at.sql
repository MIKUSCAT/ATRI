-- 为 fact_memories 添加软删除支持（归档）
ALTER TABLE fact_memories ADD COLUMN archived_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_fact_user_archived ON fact_memories(user_id, archived_at);
