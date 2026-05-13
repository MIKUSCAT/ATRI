CREATE TABLE IF NOT EXISTS fact_vector_state (
  user_id TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  vectorized_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, fact_id)
);
CREATE INDEX IF NOT EXISTS idx_fact_vector_state_user ON fact_vector_state(user_id);
