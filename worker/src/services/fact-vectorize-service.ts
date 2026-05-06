import type { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { embedText, getActiveFacts, getArchivedFactIds } from './memory-service';

async function ensureFactVectorStateTable(env: Env) {
  await env.ATRI_DB.prepare(
    `CREATE TABLE IF NOT EXISTS fact_vector_state (
      user_id TEXT NOT NULL,
      fact_id TEXT NOT NULL,
      vectorized_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, fact_id)
    )`
  ).run();
  await env.ATRI_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_fact_vector_state_user ON fact_vector_state(user_id)`
  ).run();
}

async function loadFactVectorState(env: Env, userId: string): Promise<Set<string>> {
  await ensureFactVectorStateTable(env);
  const result = await env.ATRI_DB.prepare(
    `SELECT fact_id as factId FROM fact_vector_state WHERE user_id = ?`
  ).bind(userId).all<{ factId: string }>();
  return new Set((result.results || []).map(row => String(row?.factId || '').trim()).filter(Boolean));
}

async function markFactVectorized(env: Env, userId: string, factId: string) {
  await env.ATRI_DB.prepare(
    `INSERT INTO fact_vector_state (user_id, fact_id, vectorized_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, fact_id) DO UPDATE SET vectorized_at = excluded.vectorized_at`
  ).bind(userId, factId, Date.now()).run();
}

async function removeFactVectorState(env: Env, userId: string, factIds: string[]) {
  const ids = factIds.map(id => String(id || '').trim()).filter(Boolean);
  if (!ids.length) return;
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    const placeholders = batch.map(() => '?').join(', ');
    await env.ATRI_DB.prepare(
      `DELETE FROM fact_vector_state WHERE user_id = ? AND fact_id IN (${placeholders})`
    ).bind(userId, ...batch).run();
  }
}

export async function syncFactVectorsNightly(env: Env, userId: string): Promise<void> {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) return;

  const [active, archived, alreadyVectorized] = await Promise.all([
    getActiveFacts(env, safeUserId, 1000),
    getArchivedFactIds(env, safeUserId),
    loadFactVectorState(env, safeUserId)
  ]);

  const toInsert = active.filter(f => !alreadyVectorized.has(f.id));
  const toRemove = archived.filter(id => alreadyVectorized.has(id));

  for (const fact of toInsert) {
    const text = sanitizeText(fact.text).trim();
    if (!text) continue;
    const values = await embedText(text, env);
    await (env as any).VECTORIZE.upsert([{
      id: `fact:${fact.id}`,
      values,
      metadata: {
        u: safeUserId,
        c: 'fact',
        cat: 'fact',
        key: fact.id,
        text,
        imp: fact.importance,
        ts: Date.now()
      }
    }]);
    await markFactVectorized(env, safeUserId, fact.id);
  }

  if (toRemove.length) {
    await (env as any).VECTORIZE.deleteByIds(toRemove.map(id => `fact:${id}`));
    await removeFactVectorState(env, safeUserId, toRemove);
  }

  console.log('[ATRI] fact_vectors_synced', {
    userId: safeUserId,
    inserted: toInsert.length,
    removed: toRemove.length
  });
}
