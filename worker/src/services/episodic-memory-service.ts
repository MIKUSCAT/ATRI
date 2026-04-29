import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { upsertEpisodicMemoryVector } from './memory-service';
import { recordMemoryEvent } from './memory-event-service';

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));
}

export type EpisodicMemoryInput = {
  title: string;
  content: string;
  emotion?: string;
  tags?: string[];
  importance?: number;
  confidence?: number;
  emotionalWeight?: number;
};

export type EpisodicMemoryRecord = {
  id: string;
  userId: string;
  sourceDate: string;
  title: string;
  content: string;
  emotion?: string;
  tags: string[];
  importance: number;
  confidence: number;
  emotionalWeight: number;
  embeddingId?: string;
  recallCount: number;
  lastRecalledAt?: number | null;
};

export async function upsertEpisodicMemories(env: Env, params: {
  userId: string;
  sourceDate: string;
  memories: EpisodicMemoryInput[];
}) {
  const userId = String(params.userId || '').trim();
  const sourceDate = String(params.sourceDate || '').trim();
  if (!userId || !sourceDate) return { count: 0 };

  const clean = (Array.isArray(params.memories) ? params.memories : [])
    .map((m) => ({
      title: sanitizeText(String(m?.title || '')).trim(),
      content: sanitizeText(String(m?.content || '')).trim(),
      emotion: sanitizeText(String(m?.emotion || '')).trim(),
      tags: Array.isArray(m?.tags) ? m.tags.map(t => sanitizeText(String(t || '')).trim()).filter(Boolean).slice(0, 8) : [],
      importance: clampInt(Number(m?.importance ?? 5), 1, 10),
      confidence: Math.min(1, Math.max(0.1, Number(m?.confidence ?? 0.8))),
      emotionalWeight: clampInt(Number(m?.emotionalWeight ?? 5), 1, 10)
    }))
    .filter(m => m.title && m.content)
    .slice(0, 8);

  let count = 0;
  const now = Date.now();
  for (let i = 0; i < clean.length; i++) {
    const m = clean[i];
    const id = `epi:${userId}:${sourceDate}:${i}`;
    const embeddingId = await upsertEpisodicMemoryVector(env, {
      userId,
      memoryId: `${sourceDate}:${i}`,
      sourceDate,
      title: m.title,
      content: m.content,
      emotion: m.emotion,
      importance: m.importance,
      emotionalWeight: m.emotionalWeight,
      timestamp: now
    }).catch((err) => {
      console.warn('[ATRI] episodic vector upsert failed', { userId, sourceDate, i, err });
      return null;
    });

    await env.ATRI_DB.prepare(
      `INSERT INTO episodic_memories (
         id, user_id, source_date, title, content, emotion, tags,
         importance, confidence, emotional_weight, embedding_id,
         recall_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         emotion = excluded.emotion,
         tags = excluded.tags,
         importance = excluded.importance,
         confidence = excluded.confidence,
         emotional_weight = excluded.emotional_weight,
         embedding_id = COALESCE(excluded.embedding_id, episodic_memories.embedding_id),
         updated_at = excluded.updated_at,
         archived_at = NULL`
    ).bind(
      id, userId, sourceDate, m.title, m.content, m.emotion || null, JSON.stringify(m.tags),
      m.importance, m.confidence, m.emotionalWeight, embeddingId, now, now
    ).run();
    count++;
  }
  return { count };
}

export async function getEpisodicMemoryById(env: Env, userId: string, id: string): Promise<EpisodicMemoryRecord | null> {
  const row = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, source_date as sourceDate, title, content, emotion, tags,
            importance, confidence, emotional_weight as emotionalWeight, embedding_id as embeddingId,
            recall_count as recallCount, last_recalled_at as lastRecalledAt
       FROM episodic_memories
      WHERE user_id = ? AND id = ? AND archived_at IS NULL`
  ).bind(userId, id).first<any>();
  if (!row) return null;
  return mapRow(row);
}

export async function listRecentEpisodicMemories(env: Env, userId: string, limit = 8) {
  const result = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, source_date as sourceDate, title, content, emotion, tags,
            importance, confidence, emotional_weight as emotionalWeight, embedding_id as embeddingId,
            recall_count as recallCount, last_recalled_at as lastRecalledAt
       FROM episodic_memories
      WHERE user_id = ? AND archived_at IS NULL
      ORDER BY source_date DESC, importance DESC
      LIMIT ?`
  ).bind(userId, clampInt(limit, 1, 30)).all<any>();
  return (result.results || []).map(mapRow);
}

export async function markEpisodicRecalled(env: Env, userId: string, id: string, conversationLogId?: string) {
  const now = Date.now();
  await env.ATRI_DB.prepare(
    `UPDATE episodic_memories
        SET recall_count = COALESCE(recall_count, 0) + 1,
            last_recalled_at = ?,
            updated_at = ?
      WHERE user_id = ? AND id = ? AND archived_at IS NULL`
  ).bind(now, now, userId, id).run();
  await recordMemoryEvent(env, { userId, memoryId: id, memoryType: 'episodic', eventType: 'recalled', conversationLogId });
}

export async function deleteEpisodicMemoriesByUser(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(`DELETE FROM episodic_memories WHERE user_id = ?`).bind(userId).run();
  return Number(result?.meta?.changes ?? 0);
}

function mapRow(row: any): EpisodicMemoryRecord {
  let tags: string[] = [];
  try { tags = Array.isArray(JSON.parse(String(row?.tags || '[]'))) ? JSON.parse(String(row?.tags || '[]')) : []; } catch {}
  return {
    id: String(row?.id || ''),
    userId: String(row?.userId || ''),
    sourceDate: String(row?.sourceDate || ''),
    title: String(row?.title || ''),
    content: String(row?.content || ''),
    emotion: String(row?.emotion || '') || undefined,
    tags,
    importance: clampInt(Number(row?.importance ?? 5), 1, 10),
    confidence: Math.min(1, Math.max(0, Number(row?.confidence ?? 0.8))),
    emotionalWeight: clampInt(Number(row?.emotionalWeight ?? 5), 1, 10),
    embeddingId: String(row?.embeddingId || '') || undefined,
    recallCount: Number(row?.recallCount || 0),
    lastRecalledAt: row?.lastRecalledAt == null ? null : Number(row.lastRecalledAt)
  };
}
