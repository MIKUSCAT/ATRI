import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';

function normalizeOpenAiCompatibleBaseUrl(input: string) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (raw.endsWith('/v1')) return raw;
  return `${raw}/v1`;
}

export async function embedText(text: string, env: Env): Promise<number[]> {
  const baseRaw = typeof env.EMBEDDINGS_API_URL === 'string' ? env.EMBEDDINGS_API_URL.trim() : '';
  const base = normalizeOpenAiCompatibleBaseUrl(baseRaw || 'https://api.siliconflow.cn');
  const apiKey = String(env.EMBEDDINGS_API_KEY || env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Missing embeddings API key: set EMBEDDINGS_API_KEY (or OPENAI_API_KEY)');
  }
  const model = String(env.EMBEDDINGS_MODEL || 'BAAI/bge-m3').trim();
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

  const rawHighlights = Array.isArray(params.highlights) ? params.highlights : [];
  const highlights = rawHighlights
    .map((h) => sanitizeText(String(h || '')).trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, 10);

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
