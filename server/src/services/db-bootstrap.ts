import type { Env } from '../runtime/types';

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runSchemaBootstrap(env: Env) {
  await env.db.query('CREATE EXTENSION IF NOT EXISTS vector');

  await env.db.query(
    `CREATE TABLE IF NOT EXISTS conversation_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments TEXT,
      reply_to TEXT,
      timestamp BIGINT NOT NULL,
      user_name TEXT,
      time_zone TEXT,
      created_at BIGINT NOT NULL
    )`
  );
  await env.db.query(
    `CREATE INDEX IF NOT EXISTS idx_conversation_user_date
      ON conversation_logs(user_id, date)`
  );
  await env.db.query(
    `CREATE INDEX IF NOT EXISTS idx_conversation_user_timestamp
      ON conversation_logs(user_id, timestamp)`
  );
  await env.db.query(`ALTER TABLE conversation_logs ADD COLUMN IF NOT EXISTS reply_to TEXT`);
  await env.db.query(`ALTER TABLE conversation_logs DROP COLUMN IF EXISTS mood`);
  await env.db.query(
    `CREATE INDEX IF NOT EXISTS idx_conversation_user_reply_to
      ON conversation_logs(user_id, reply_to)`
  );

  await env.db.query(
    `CREATE TABLE IF NOT EXISTS conversation_log_tombstones (
      user_id TEXT NOT NULL,
      log_id TEXT NOT NULL,
      deleted_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, log_id)
    )`
  );
  await env.db.query(
    `CREATE INDEX IF NOT EXISTS idx_conversation_tombstone_user
      ON conversation_log_tombstones(user_id)`
  );

  await env.db.query(
    `CREATE TABLE IF NOT EXISTS user_states (
      user_id TEXT PRIMARY KEY,
      status_label TEXT NOT NULL,
      status_pill_color TEXT NOT NULL,
      status_text_color TEXT NOT NULL,
      status_reason TEXT,
      status_updated_at BIGINT NOT NULL,
      intimacy INTEGER DEFAULT 0,
      last_interaction_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`
  );
  await env.db.query(`ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_label TEXT`);
  await env.db.query(`ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_pill_color TEXT`);
  await env.db.query(`ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_text_color TEXT`);
  await env.db.query(`ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_reason TEXT`);
  await env.db.query(`ALTER TABLE user_states ADD COLUMN IF NOT EXISTS status_updated_at BIGINT`);
  await env.db.query(
    `UPDATE user_states
        SET status_label = '陪着你'
      WHERE status_label IS NULL OR btrim(status_label) = ''`
  );
  await env.db.query(
    `UPDATE user_states
        SET status_pill_color = '#7E8EA3'
      WHERE status_pill_color IS NULL OR btrim(status_pill_color) = ''`
  );
  await env.db.query(
    `UPDATE user_states
        SET status_text_color = '#FFFFFF'
      WHERE status_text_color IS NULL OR btrim(status_text_color) = ''`
  );
  await env.db.query(
    `UPDATE user_states
        SET status_updated_at = COALESCE(status_updated_at, updated_at, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)`
  );
  await env.db.query(`ALTER TABLE user_states ALTER COLUMN status_label SET NOT NULL`);
  await env.db.query(`ALTER TABLE user_states ALTER COLUMN status_pill_color SET NOT NULL`);
  await env.db.query(`ALTER TABLE user_states ALTER COLUMN status_text_color SET NOT NULL`);
  await env.db.query(`ALTER TABLE user_states ALTER COLUMN status_updated_at SET NOT NULL`);
  await env.db.query(`ALTER TABLE user_states DROP COLUMN IF EXISTS status_category`);
  await env.db.query(`ALTER TABLE user_states DROP COLUMN IF EXISTS pad_values`);

  await env.db.query(
    `CREATE TABLE IF NOT EXISTS diary_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      summary TEXT,
      content TEXT,
      mood TEXT,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`
  );
  await env.db.query(
    `CREATE INDEX IF NOT EXISTS idx_diary_user_date
      ON diary_entries(user_id, date)`
  );

  await env.db.query(
    `CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      model_key TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`
  );

  await env.db.query(
    `CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      content TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`
  );

  await env.db.query(
    `CREATE TABLE IF NOT EXISTS memory_vectors (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      idx INTEGER NOT NULL,
      text TEXT NOT NULL,
      mood TEXT,
      importance INTEGER DEFAULT 6,
      timestamp BIGINT NOT NULL,
      embedding vector(1024)
    )`
  );
  await env.db.query(
    `CREATE INDEX IF NOT EXISTS idx_memory_user_date
      ON memory_vectors(user_id, date)`
  );
}

export async function bootstrapDatabase(env: Env, options?: { maxWaitMs?: number }) {
  const maxWaitMs = options?.maxWaitMs ?? 120_000;
  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      await runSchemaBootstrap(env);
      return;
    } catch (error: any) {
      const waited = Date.now() - startedAt;
      const message = String(error?.message || error);
      if (waited >= maxWaitMs) {
        throw new Error(`db_bootstrap_failed: ${message}`);
      }
      const delay = Math.min(5000, 400 + attempt * 300);
      console.warn(`[ATRI] DB 初始化失败，${Math.round(delay)}ms 后重试（${attempt}），原因：${message}`);
      await sleep(delay);
    }
  }
}
