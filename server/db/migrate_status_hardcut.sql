BEGIN;

ALTER TABLE conversation_logs DROP COLUMN IF EXISTS mood;

ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_label TEXT;
ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_pill_color TEXT;
ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_text_color TEXT;
ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_updated_at BIGINT;

UPDATE user_states
SET status_label = '陪着你'
WHERE status_label IS NULL OR btrim(status_label) = '';

UPDATE user_states
SET status_pill_color = '#7E8EA3'
WHERE status_pill_color IS NULL OR btrim(status_pill_color) = '';

UPDATE user_states
SET status_text_color = '#FFFFFF'
WHERE status_text_color IS NULL OR btrim(status_text_color) = '';

UPDATE user_states
SET status_updated_at = COALESCE(status_updated_at, updated_at, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000);

ALTER TABLE user_states ALTER COLUMN status_label SET NOT NULL;
ALTER TABLE user_states ALTER COLUMN status_pill_color SET NOT NULL;
ALTER TABLE user_states ALTER COLUMN status_text_color SET NOT NULL;
ALTER TABLE user_states ALTER COLUMN status_updated_at SET NOT NULL;

ALTER TABLE user_states DROP COLUMN IF EXISTS status_category;
ALTER TABLE user_states DROP COLUMN IF EXISTS pad_values;

COMMIT;
