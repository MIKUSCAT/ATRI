-- 记忆系统完整改造：fact 权重化 + 情景记忆 + 心里挂着的念头 + 记忆事件

ALTER TABLE fact_memories ADD COLUMN type TEXT DEFAULT 'other';
ALTER TABLE fact_memories ADD COLUMN importance INTEGER NOT NULL DEFAULT 5;
ALTER TABLE fact_memories ADD COLUMN confidence REAL NOT NULL DEFAULT 0.7;
ALTER TABLE fact_memories ADD COLUMN source TEXT DEFAULT 'legacy';
ALTER TABLE fact_memories ADD COLUMN source_date TEXT;
ALTER TABLE fact_memories ADD COLUMN last_seen_at INTEGER;
ALTER TABLE fact_memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fact_memories ADD COLUMN last_recalled_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_fact_user_type_importance
  ON fact_memories(user_id, type, importance DESC);
CREATE INDEX IF NOT EXISTS idx_fact_user_source_date
  ON fact_memories(user_id, source_date);

CREATE TABLE IF NOT EXISTS episodic_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_date TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  emotion TEXT,
  tags TEXT,
  importance INTEGER NOT NULL DEFAULT 5,
  confidence REAL NOT NULL DEFAULT 0.8,
  emotional_weight INTEGER NOT NULL DEFAULT 5,
  embedding_id TEXT,
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_episodic_user_date
  ON episodic_memories(user_id, source_date DESC);
CREATE INDEX IF NOT EXISTS idx_episodic_user_active_importance
  ON episodic_memories(user_id, archived_at, importance DESC, emotional_weight DESC);

CREATE TABLE IF NOT EXISTS memory_intentions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_date TEXT NOT NULL,
  content TEXT NOT NULL,
  trigger_hint TEXT,
  urgency INTEGER NOT NULL DEFAULT 5,
  emotional_weight INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  archived_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_intentions_user_status_urgency
  ON memory_intentions(user_id, status, urgency DESC, emotional_weight DESC);
CREATE INDEX IF NOT EXISTS idx_intentions_user_expires
  ON memory_intentions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conversation_log_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_events_user_created
  ON memory_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_events_memory
  ON memory_events(memory_type, memory_id, created_at DESC);

-- 明确清理旧的自我复盘表，已被 fact/episodic/intention 替代
DROP TABLE IF EXISTS atri_self_reviews;
