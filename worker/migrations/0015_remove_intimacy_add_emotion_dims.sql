-- 0015_remove_intimacy_add_emotion_dims.sql
-- 删除 user_states.intimacy（亲密度数值化设计 deprecated）
-- 新增 valence/arousal/certainty 连续情绪维度

ALTER TABLE user_states DROP COLUMN intimacy;

ALTER TABLE user_states ADD COLUMN valence REAL NOT NULL DEFAULT 0;
ALTER TABLE user_states ADD COLUMN arousal REAL NOT NULL DEFAULT 0;
ALTER TABLE user_states ADD COLUMN certainty REAL NOT NULL DEFAULT 0.5;
