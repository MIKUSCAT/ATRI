-- 清理没有接入主链路的旧用户档案表，长期认知统一进入 fact_memories / episodic_memories
DROP TABLE IF EXISTS user_profiles;
