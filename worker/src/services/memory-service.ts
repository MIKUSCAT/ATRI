import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { getEffectiveRuntimeSettings } from './runtime-settings';

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function embedText(text: string, env: Env): Promise<number[]> {
  const settings = await getEffectiveRuntimeSettings(env);
  const base = String(settings.embeddingsApiUrl || '').trim();
  const model = String(settings.embeddingsModel || '').trim();
  const apiKey = String(settings.embeddingsApiKey || '').trim();
  if (!base || !model || !apiKey) {
    throw new Error('missing_embeddings_config');
  }

  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, input: text })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Embeddings API error: ${res.status} ${t}`);
  }
  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Invalid embeddings response');
  }
  return embedding as number[];
}

export async function searchMemories(
  env: Env,
  userId: string,
  queryText: string,
  topK = 5
) {
  const vector = await embedText(queryText, env);
  const queryKs = Array.from(
    new Set<number>([
      Math.min(Math.max(200, topK * 50), 500),
      Math.min(Math.max(100, topK * 10), 200),
      50
    ])
  );

  let result: any;
  let lastError: unknown;
  for (const k of queryKs) {
    try {
      result = await (env as any).VECTORIZE.query(vector, { topK: k, returnMetadata: 'all' });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!result) {
    throw lastError || new Error('VECTORIZE.query failed');
  }
  const matches = Array.isArray(result?.matches) ? result.matches : [];

  const items: any[] = [];

  for (const m of matches) {
    if (m?.metadata?.u !== userId) continue;

    const category = m?.metadata?.c || 'general';
    const date = String(m?.metadata?.d || '').trim();
    const mood = String(m?.metadata?.m || '').trim();
    const matchedHighlight = String(m?.metadata?.text || '').trim();

    // 只保留 highlight 记忆（不再按日期去重，避免漏掉同一天的关键片段）
    if (category === 'highlight' && date) {
      items.push({
        id: m.id,
        score: m.score,
        category,
        date,
        matchedHighlight,
        mood,
        importance: m?.metadata?.imp ?? 6,
        timestamp: m?.metadata?.ts ?? 0
      });
      if (items.length >= topK) break;
      continue;
    }
  }

  return items;
}

export async function upsertDiaryHighlightsMemory(
  env: Env,
  params: {
    userId: string;
    date: string;
    highlights: string[];
    mood?: string;
    timestamp?: number;
  }
) {
  const date = String(params.date || '').trim();
  if (!date) throw new Error('Diary date is missing');

  const MAX_HIGHLIGHTS_PER_DAY = 10;

  const rawHighlights = Array.isArray(params.highlights) ? params.highlights : [];
  const highlights = rawHighlights
    .map((h) => sanitizeText(String(h || '')).trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, MAX_HIGHLIGHTS_PER_DAY);

  if (!highlights.length) {
    throw new Error('Diary highlights are empty');
  }

  const metadataBase = {
    u: params.userId,
    c: 'highlight',
    d: date,
    m: params.mood || '',
    imp: 6,
    ts: params.timestamp ?? Date.now()
  };

  const records: Array<{ id: string; values: number[]; metadata: any }> = [];
  for (let i = 0; i < highlights.length; i++) {
    const text = highlights[i];
    const values = await embedText(text, env);
    records.push({
      id: `hl:${params.userId}:${date}:${i}`,
      values,
      metadata: { ...metadataBase, i, text }
    });
  }

  await (env as any).VECTORIZE.upsert(records);

  if (highlights.length < MAX_HIGHLIGHTS_PER_DAY) {
    const idsToDelete: string[] = [];
    for (let i = highlights.length; i < MAX_HIGHLIGHTS_PER_DAY; i++) {
      idsToDelete.push(`hl:${params.userId}:${date}:${i}`);
    }
    await deleteDiaryVectors(env, idsToDelete);
  }
  return { count: records.length };
}

export async function deleteDiaryVectors(env: Env, ids: string[]) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0;
  }
  const index = (env as any).VECTORIZE;
  const chunkSize = 400;
  let removed = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    try {
      const result = await index.deleteByIds(batch);
      const count = Number(result?.count ?? 0);
      removed += count || batch.length;
    } catch (error) {
      console.warn('[ATRI] Failed to delete diary vectors batch:', error);
    }
  }
  return removed;
}

// ============ 实时事实记忆 (Fact Memory) ============

export type FactMemoryRecord = {
  id: string;
  text: string;
  timestamp: number;
};

export async function upsertFactMemory(
  env: Env,
  userId: string,
  content: string
): Promise<{ id: string; isNew: boolean }> {
  const cleaned = sanitizeText(String(content || '')).trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    throw new Error('Fact content is empty');
  }

  const safeUserId = String(userId || '').trim();
  if (!safeUserId) {
    throw new Error('userId is missing');
  }

  const hash = (await sha256Hex(cleaned)).slice(0, 12);
  const id = `fact:${safeUserId}:${hash}`;
  const now = Date.now();

  const existed = await env.ATRI_DB.prepare(
    `SELECT 1 AS ok
       FROM fact_memories
      WHERE id = ? AND user_id = ?
      LIMIT 1`
  )
    .bind(id, safeUserId)
    .first<{ ok?: number }>();

  await env.ATRI_DB.prepare(
    `INSERT INTO fact_memories (id, user_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       content = excluded.content,
       updated_at = excluded.updated_at`
  )
    .bind(id, safeUserId, cleaned, now, now)
    .run();

  return { id, isNew: !existed };
}

export async function deleteFactMemory(env: Env, userId: string, factId: string): Promise<boolean> {
  const safeUserId = String(userId || '').trim();
  const trimmedId = String(factId || '').trim();
  if (!safeUserId || !trimmedId) return false;

  if (!trimmedId.startsWith(`fact:${safeUserId}:`)) {
    console.warn('[ATRI] deleteFactMemory: id mismatch', { userId: safeUserId, factId: trimmedId });
    return false;
  }

  const result = await env.ATRI_DB.prepare(
    `DELETE FROM fact_memories WHERE id = ? AND user_id = ?`
  )
    .bind(trimmedId, safeUserId)
    .run();

  return Number(result?.meta?.changes ?? 0) > 0;
}

export async function getActiveFacts(env: Env, userId: string, limit = 20): Promise<FactMemoryRecord[]> {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) return [];

  const safeLimit = clampInt(Number(limit || 0), 1, 50);
  const result = await env.ATRI_DB.prepare(
    `SELECT id, content, updated_at as timestamp
       FROM fact_memories
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?`
  )
    .bind(safeUserId, safeLimit)
    .all<{ id: string; content: string; timestamp: number }>();

  return (result.results || []).map((row) => ({
    id: String(row?.id || '').trim(),
    text: String(row?.content || '').trim(),
    timestamp: Number(row?.timestamp || 0)
  }));
}
