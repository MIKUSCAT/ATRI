import { Env } from '../types';

export type MemoryType = 'fact' | 'episodic' | 'intention';
export type MemoryEventType = 'recalled' | 'used' | 'corrected' | 'archived' | 'merged';

export async function recordMemoryEvent(env: Env, params: {
  userId: string;
  memoryId: string;
  memoryType: MemoryType;
  eventType: MemoryEventType;
  conversationLogId?: string;
}) {
  const userId = String(params.userId || '').trim();
  const memoryId = String(params.memoryId || '').trim();
  if (!userId || !memoryId) return;
  const now = Date.now();
  const id = `me:${userId}:${now}:${crypto.randomUUID()}`;
  await env.ATRI_DB.prepare(
    `INSERT INTO memory_events (id, user_id, memory_id, memory_type, event_type, conversation_log_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, memoryId, params.memoryType, params.eventType, params.conversationLogId || null, now).run();
}
