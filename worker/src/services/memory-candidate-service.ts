import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { upsertFactMemory } from './memory-service';

export type MemoryCandidateInput = {
  type?: string;
  content: string;
  importance?: number;
  confidence?: number;
  note?: string;
  sourceLogId?: string;
};

export type MemoryCandidateRecord = {
  id: string;
  userId: string;
  sourceLogId: string | null;
  type: string;
  content: string;
  importance: number;
  confidence: number;
  note: string | null;
  status: 'pending' | 'promoted' | 'archived';
  createdAt: number;
  processedAt: number | null;
};

let ensured = false;
let ensuring: Promise<void> | null = null;

async function ensureMemoryCandidateTable(env: Env) {
  if (ensured) return;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    await env.ATRI_DB.prepare(
      `CREATE TABLE IF NOT EXISTS memory_candidates (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source_log_id TEXT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 5,
        confidence REAL NOT NULL DEFAULT 0.7,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      )`
    ).run();
    await env.ATRI_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_memory_candidates_user_status_created
        ON memory_candidates(user_id, status, created_at DESC)`
    ).run();
    ensured = true;
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

export async function saveMemoryCandidates(env: Env, params: {
  userId: string;
  sourceLogId?: string;
  candidates: MemoryCandidateInput[];
}) {
  await ensureMemoryCandidateTable(env);
  const userId = String(params.userId || '').trim();
  if (!userId) return { count: 0 };

  const normalized = (Array.isArray(params.candidates) ? params.candidates : [])
    .map(c => normalizeCandidate(c, params.sourceLogId))
    .filter((c): c is Required<MemoryCandidateInput> & { type: string; sourceLogId: string } => Boolean(c))
    .slice(0, 8);

  let count = 0;
  const now = Date.now();
  for (const c of normalized) {
    const id = `cand:${userId}:${now}:${count}:${hashText(c.type + ':' + c.content).slice(0, 10)}`;
    await env.ATRI_DB.prepare(
      `INSERT OR IGNORE INTO memory_candidates
        (id, user_id, source_log_id, type, content, importance, confidence, note, status, created_at, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`
    ).bind(
      id,
      userId,
      c.sourceLogId || null,
      c.type,
      c.content,
      c.importance,
      c.confidence,
      c.note || null,
      now
    ).run();
    count++;
  }
  return { count };
}

export async function listPendingMemoryCandidates(env: Env, userId: string, limit = 30): Promise<MemoryCandidateRecord[]> {
  await ensureMemoryCandidateTable(env);
  const result = await env.ATRI_DB.prepare(
    `SELECT id,
            user_id as userId,
            source_log_id as sourceLogId,
            type,
            content,
            importance,
            confidence,
            note,
            status,
            created_at as createdAt,
            processed_at as processedAt
       FROM memory_candidates
      WHERE user_id = ? AND status = 'pending'
      ORDER BY importance DESC, created_at DESC
      LIMIT ?`
  ).bind(userId, Math.max(1, Math.min(100, Math.trunc(limit)))).all<any>();
  return (result.results || []).map(row => ({
    id: String(row.id || ''),
    userId: String(row.userId || userId),
    sourceLogId: row.sourceLogId ? String(row.sourceLogId) : null,
    type: String(row.type || 'other'),
    content: String(row.content || ''),
    importance: Number(row.importance || 5),
    confidence: Number(row.confidence || 0.7),
    note: row.note ? String(row.note) : null,
    status: row.status === 'promoted' || row.status === 'archived' ? row.status : 'pending',
    createdAt: Number(row.createdAt || 0),
    processedAt: row.processedAt == null ? null : Number(row.processedAt)
  })).filter(row => row.id && row.content);
}

export async function markMemoryCandidateStatus(env: Env, userId: string, ids: string[], status: 'promoted' | 'archived') {
  await ensureMemoryCandidateTable(env);
  const now = Date.now();
  let count = 0;
  for (const id of ids.map(s => String(s || '').trim()).filter(Boolean).slice(0, 100)) {
    const result = await env.ATRI_DB.prepare(
      `UPDATE memory_candidates SET status = ?, processed_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'`
    ).bind(status, now, id, userId).run();
    count += Number(result?.meta?.changes ?? 0);
  }
  return count;
}

export async function promoteStrongMemoryCandidates(env: Env, userId: string, sourceDate?: string) {
  const candidates = await listPendingMemoryCandidates(env, userId, 50);
  const promoted: string[] = [];
  const archived: string[] = [];

  for (const c of candidates) {
    const type = normalizeFactType(c.type);
    const shouldPromote =
      (c.type === 'fact_candidate' || c.type === 'semantic' || c.type === 'preference' || c.type === 'taboo' || c.type === 'promise')
      && c.importance >= 7
      && c.confidence >= 0.55
      && c.content.length >= 6
      && !looksLikeDailyJunk(c.content);

    if (!shouldPromote) {
      archived.push(c.id);
      continue;
    }

    try {
      await upsertFactMemory(env, userId, c.content, {
        type,
        importance: c.importance,
        confidence: c.confidence,
        source: 'candidate',
        sourceDate
      });
      promoted.push(c.id);
    } catch (err) {
      console.warn('[ATRI] promote memory candidate failed', { userId, id: c.id, err });
    }
  }

  if (promoted.length) await markMemoryCandidateStatus(env, userId, promoted, 'promoted');
  if (archived.length) await markMemoryCandidateStatus(env, userId, archived, 'archived');
  return { promoted: promoted.length, archived: archived.length };
}

function normalizeCandidate(raw: MemoryCandidateInput, fallbackSourceLogId?: string) {
  const content = sanitizeText(String(raw?.content || '')).trim();
  if (!content || content.length < 3) return null;
  const type = normalizeCandidateType(raw?.type);
  return {
    type,
    content: content.slice(0, 500),
    importance: clampInt(raw?.importance, 1, 10, 5),
    confidence: clampNumber(raw?.confidence, 0.1, 1, 0.7),
    note: sanitizeText(String(raw?.note || '')).trim().slice(0, 240),
    sourceLogId: String(raw?.sourceLogId || fallbackSourceLogId || '').trim()
  };
}

function normalizeCandidateType(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  if (['fact', 'fact_candidate', 'semantic', 'preference', 'taboo', 'promise', 'relationship', 'habit', 'important', 'self_model', 'self_model_candidate', 'intention', 'episodic'].includes(text)) {
    return text;
  }
  return 'other';
}

function normalizeFactType(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  if (['preference', 'taboo', 'promise', 'relationship', 'habit', 'important'].includes(text)) return text as any;
  if (text === 'fact_candidate' || text === 'semantic') return 'important' as any;
  return 'other' as any;
}

function looksLikeDailyJunk(text: string) {
  return [
    /今天.*(困|累|吃|睡|洗澡|出门|回来)/,
    /刚刚/,
    /临时/,
    /今天聊了/,
    /这次.*讨论/,
    /晚上要/,
    /明天可能/
  ].some(re => re.test(text));
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  return Math.trunc(clampNumber(value, min, max, fallback));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function hashText(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
