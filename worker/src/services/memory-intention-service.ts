import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { recordMemoryEvent } from './memory-event-service';

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));
}

export type MemoryIntentionInput = {
  content: string;
  triggerHint?: string;
  urgency?: number;
  emotionalWeight?: number;
  expiresInDays?: number;
};

export type MemoryIntentionRecord = {
  id: string;
  userId: string;
  sourceDate: string;
  content: string;
  triggerHint?: string;
  urgency: number;
  emotionalWeight: number;
  expiresAt?: number | null;
};

export async function upsertMemoryIntentions(env: Env, params: {
  userId: string;
  sourceDate: string;
  intentions: MemoryIntentionInput[];
}) {
  const userId = String(params.userId || '').trim();
  const sourceDate = String(params.sourceDate || '').trim();
  if (!userId || !sourceDate) return { count: 0 };
  const now = Date.now();
  const clean = (Array.isArray(params.intentions) ? params.intentions : [])
    .map((i) => ({
      content: sanitizeText(String(i?.content || '')).trim(),
      triggerHint: sanitizeText(String(i?.triggerHint || '')).trim(),
      urgency: clampInt(Number(i?.urgency ?? 5), 1, 10),
      emotionalWeight: clampInt(Number(i?.emotionalWeight ?? 5), 1, 10),
      expiresInDays: clampInt(Number(i?.expiresInDays ?? 7), 1, 30)
    }))
    .filter(i => i.content)
    .slice(0, 5);

  let count = 0;
  for (let i = 0; i < clean.length; i++) {
    const item = clean[i];
    const id = `intent:${userId}:${sourceDate}:${i}`;
    const expiresAt = now + item.expiresInDays * 86400000;
    await env.ATRI_DB.prepare(
      `INSERT INTO memory_intentions (
         id, user_id, source_date, content, trigger_hint, urgency, emotional_weight,
         status, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         content = excluded.content,
         trigger_hint = excluded.trigger_hint,
         urgency = excluded.urgency,
         emotional_weight = excluded.emotional_weight,
         status = 'pending',
         expires_at = excluded.expires_at,
         archived_at = NULL`
    ).bind(id, userId, sourceDate, item.content, item.triggerHint || null, item.urgency, item.emotionalWeight, expiresAt, now).run();
    count++;
  }
  return { count };
}

export async function listPendingIntentions(env: Env, userId: string, limit = 3): Promise<MemoryIntentionRecord[]> {
  const now = Date.now();
  await env.ATRI_DB.prepare(
    `UPDATE memory_intentions SET status = 'expired', archived_at = ?
      WHERE user_id = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`
  ).bind(now, userId, now).run().catch(() => undefined);

  const result = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, source_date as sourceDate, content,
            trigger_hint as triggerHint, urgency, emotional_weight as emotionalWeight, expires_at as expiresAt
       FROM memory_intentions
      WHERE user_id = ? AND status = 'pending' AND archived_at IS NULL
      ORDER BY urgency DESC, emotional_weight DESC, created_at DESC
      LIMIT ?`
  ).bind(userId, clampInt(limit, 1, 10)).all<any>();

  return (result.results || []).map((row: any) => ({
    id: String(row?.id || ''),
    userId: String(row?.userId || ''),
    sourceDate: String(row?.sourceDate || ''),
    content: String(row?.content || ''),
    triggerHint: String(row?.triggerHint || '') || undefined,
    urgency: clampInt(Number(row?.urgency ?? 5), 1, 10),
    emotionalWeight: clampInt(Number(row?.emotionalWeight ?? 5), 1, 10),
    expiresAt: row?.expiresAt == null ? null : Number(row.expiresAt)
  }));
}

export async function markIntentionRecalled(env: Env, userId: string, id: string, conversationLogId?: string) {
  await recordMemoryEvent(env, { userId, memoryId: id, memoryType: 'intention', eventType: 'recalled', conversationLogId });
}

export async function markIntentionUsed(env: Env, userId: string, id: string, conversationLogId?: string) {
  const now = Date.now();
  await env.ATRI_DB.prepare(
    `UPDATE memory_intentions SET status = 'used', used_at = ?, archived_at = ? WHERE user_id = ? AND id = ?`
  ).bind(now, now, userId, id).run();
  await recordMemoryEvent(env, { userId, memoryId: id, memoryType: 'intention', eventType: 'used', conversationLogId });
}

export async function deleteMemoryIntentionsByUser(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(`DELETE FROM memory_intentions WHERE user_id = ?`).bind(userId).run();
  return Number(result?.meta?.changes ?? 0);
}
