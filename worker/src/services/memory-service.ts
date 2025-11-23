import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';

export async function embedText(text: string, env: Env): Promise<number[]> {
  const base = env.EMBEDDINGS_API_URL || 'https://api.siliconflow.cn/v1';
  const model = env.EMBEDDINGS_MODEL || 'BAAI/bge-m3';
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.EMBEDDINGS_API_KEY}`,
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
  topK = 3
) {
  const vector = await embedText(queryText, env);
  const result: any = await (env as any).VECTORIZE.query(vector, { topK, returnMetadata: 'all' });
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  const items = matches
    .filter((m: any) => m?.metadata?.u === userId)
    .map((m: any) => ({
      id: m.id,
      score: m.score,
      category: m?.metadata?.c || 'general',
      key: m?.metadata?.c === 'diary' ? '' : (m?.metadata?.k || ''),
      value: m?.metadata?.c === 'diary' ? '' : (m?.metadata?.t || m?.metadata?.k || ''),
      importance: m?.metadata?.imp ?? 5,
      timestamp: m?.metadata?.ts ?? 0,
      diaryId: m?.metadata?.d || null,
      date: m?.metadata?.d || null,
      mood: m?.metadata?.m || ''
    }));
  return items.slice(0, topK);
}

export async function upsertDiaryMemory(
  env: Env,
  params: {
    entryId?: string;
    userId: string;
    content: string;
    date?: string;
    mood?: string;
    timestamp?: number;
  }
) {
  const text = sanitizeText(String(params.content || ''));
  if (!text) {
    throw new Error('Diary content is empty');
  }
  const date = params.date || '';
  if (!date) {
    throw new Error('Diary date is missing');
  }
  const summary = text.slice(0, 200);
  const values = await embedText(summary, env);
  const entryId = params.entryId || `diary:${params.userId}:${date}`;
  const metadata = {
    u: params.userId,
    c: 'diary',
    d: date,
    m: params.mood || '',
    imp: 6,
    ts: params.timestamp ?? Date.now()
  };
  await (env as any).VECTORIZE.upsert([{ id: entryId, values, metadata }]);
  return {
    id: entryId,
    category: metadata.c,
    importance: metadata.imp,
    timestamp: metadata.ts,
    userId: metadata.u,
    diaryId: metadata.d,
    date: metadata.d
  };
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
