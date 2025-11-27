import { Env } from '../types';
import { DEFAULT_TIMEZONE, formatDateInZone, resolveTimestamp } from '../utils/date';

export type ConversationRole = 'user' | 'atri';

export type ConversationLogInput = {
  id?: string;
  userId: string;
  role: ConversationRole;
  content: string;
  timestamp?: number;
  attachments?: unknown[];
  userName?: string;
  timeZone?: string;
  date?: string;
};

export type ConversationLogRecord = {
  id: string;
  userId: string;
  date: string;
  role: ConversationRole;
  content: string;
  attachments: unknown[];
  timestamp: number;
  userName?: string;
  timeZone?: string;
};

export type DiaryEntryRecord = {
  id: string;
  userId: string;
  date: string;
  summary?: string;
  content?: string;
  mood?: string;
  status: 'pending' | 'ready' | 'error';
  createdAt: number;
  updatedAt: number;
};

export type DailyLearningRecord = {
  id: string;
  userId: string;
  date: string;
  summary?: string;
  payload?: string;
  createdAt: number;
  updatedAt: number;
};

export type MemoryCategory = 'user_fact' | 'user_preference' | 'relationship' | 'taboo' | 'atri_growth';

export type UserMemoryRecord = {
  id: string;
  userId: string;
  category: MemoryCategory;
  key: string;
  value: string;
  importance: number;
  evidence?: string;
  sourceDate?: string;
  createdAt: number;
  updatedAt: number;
};

export type UserMemoryInput = {
  userId: string;
  category: MemoryCategory;
  key: string;
  value: string;
  importance?: number;
  evidence?: string;
  sourceDate?: string;
};

export async function saveConversationLog(env: Env, payload: ConversationLogInput) {
  const timestamp = resolveTimestamp(payload.timestamp);
  const timeZone = payload.timeZone || DEFAULT_TIMEZONE;
  const date = payload.date || formatDateInZone(timestamp, timeZone);
  const id = payload.id || crypto.randomUUID();
  const attachments = payload.attachments ?? [];
  await env.ATRI_DB.prepare(
    `INSERT INTO conversation_logs
        (id, user_id, date, role, content, attachments, timestamp, user_name, time_zone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       date = excluded.date,
       role = excluded.role,
       content = excluded.content,
       attachments = excluded.attachments,
       timestamp = excluded.timestamp,
       user_name = excluded.user_name,
       time_zone = excluded.time_zone`
  )
    .bind(
      id,
      payload.userId,
      date,
      payload.role,
      payload.content,
      JSON.stringify(attachments),
      timestamp,
      payload.userName ?? null,
      timeZone,
      Date.now()
    )
    .run();
  return { id, date, timestamp };
}

export async function fetchConversationLogs(env: Env, userId: string, date: string): Promise<ConversationLogRecord[]> {
  const result = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, date, role, content, attachments, timestamp, user_name as userName, time_zone as timeZone
     FROM conversation_logs
     WHERE user_id = ? AND date = ?
     ORDER BY timestamp ASC`
  )
    .bind(userId, date)
  .all<ConversationLogRecord>();

  return (result.results || []).map((row) => ({
    ...row,
    attachments: parseJson(row.attachments),
  }));
}

export async function fetchConversationLogsSince(
  env: Env,
  userId: string,
  startTimestamp: number
): Promise<ConversationLogRecord[]> {
  const result = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, date, role, content, attachments, timestamp, user_name as userName, time_zone as timeZone
     FROM conversation_logs
     WHERE user_id = ? AND timestamp >= ?
     ORDER BY timestamp ASC`
  )
    .bind(userId, startTimestamp)
    .all<ConversationLogRecord>();

  return (result.results || []).map((row) => ({
    ...row,
    attachments: parseJson(row.attachments)
  }));
}

export async function listPendingDiaryUsers(env: Env, date: string) {
  const result = await env.ATRI_DB.prepare(
    `SELECT DISTINCT logs.user_id as userId, MAX(logs.user_name) as userName, MAX(logs.time_zone) as timeZone
     FROM conversation_logs logs
     LEFT JOIN diary_entries diary
       ON diary.user_id = logs.user_id AND diary.date = logs.date AND diary.status = 'ready'
     WHERE logs.date = ? AND diary.id IS NULL
     GROUP BY logs.user_id`
  )
    .bind(date)
    .all<{ userId: string; userName?: string; timeZone?: string }>();
  return result.results || [];
}

export async function getLastConversationDate(env: Env, userId: string, beforeDate: string): Promise<string | null> {
  const result = await env.ATRI_DB.prepare(
    `SELECT date
     FROM conversation_logs
     WHERE user_id = ? AND date < ?
     ORDER BY date DESC
     LIMIT 1`
  )
    .bind(userId, beforeDate)
    .first<{ date: string }>();
  return result?.date ?? null;
}

export function calculateDaysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

export async function getDiaryEntry(env: Env, userId: string, date: string) {
  const result = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, date, summary, content, mood, status, created_at as createdAt, updated_at as updatedAt
     FROM diary_entries
     WHERE user_id = ? AND date = ?`
  )
    .bind(userId, date)
    .first<DiaryEntryRecord>();
  return result ?? null;
}

export async function getDiaryEntryById(env: Env, id: string) {
  const result = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, date, summary, content, mood, status, created_at as createdAt, updated_at as updatedAt
     FROM diary_entries
     WHERE id = ?`
  )
    .bind(id)
    .first<DiaryEntryRecord>();
  return result ?? null;
}

export async function saveDiaryEntry(
  env: Env,
  entry: {
    userId: string;
    date: string;
    content: string;
    summary?: string;
    mood?: string;
    status?: DiaryEntryRecord['status'];
  }
) {
  const now = Date.now();
  const id = `diary:${entry.userId}:${entry.date}`;
  const summary = entry.summary ?? entry.content.slice(0, 80);
  const status = entry.status ?? 'ready';

  await env.ATRI_DB.prepare(
    `INSERT INTO diary_entries (id, user_id, date, summary, content, mood, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       summary = excluded.summary,
       content = excluded.content,
       mood = excluded.mood,
       status = excluded.status,
       updated_at = excluded.updated_at`
  )
    .bind(id, entry.userId, entry.date, summary, entry.content, entry.mood ?? null, status, now, now)
    .run();

  return { id, summary, status };
}

export async function listDiaryEntries(env: Env, userId: string, limit = 7) {
  const result = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, date, summary, content, mood, status, created_at as createdAt, updated_at as updatedAt
     FROM diary_entries
     WHERE user_id = ?
     ORDER BY date DESC
     LIMIT ?`
  )
    .bind(userId, limit)
    .all<DiaryEntryRecord>();
  return result.results || [];
}

export async function saveDailyLearning(
  env: Env,
  record: {
    userId: string;
    date: string;
    summary?: string;
    payload?: string;
  }
) {
  const now = Date.now();
  const id = `learn:${record.userId}:${record.date}`;

  await env.ATRI_DB.prepare(
    `INSERT INTO daily_learning (id, user_id, date, summary, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       summary = excluded.summary,
       payload = excluded.payload,
       updated_at = excluded.updated_at`
  )
    .bind(id, record.userId, record.date, record.summary ?? null, record.payload ?? null, now, now)
    .run();

  return { id, summary: record.summary };
}

export async function getRecentDailyLearnings(env: Env, userId: string, limit = 3) {
  const result = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, date, summary, payload, created_at as createdAt, updated_at as updatedAt
     FROM daily_learning
     WHERE user_id = ?
     ORDER BY date DESC
     LIMIT ?`
  )
    .bind(userId, Math.max(1, Math.min(limit, 10)))
    .all<DailyLearningRecord>();

  return result.results || [];
}

function parseJson(value: any) {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export function buildConversationTranscript(
  logs: ConversationLogRecord[],
  fallbackUserName = '你'
): string {
  const name = fallbackUserName || '你';
  return logs
    .map((log) => {
      const speaker = log.role === 'atri' ? 'ATRI' : (log.userName || name);
      return `${speaker}：${log.content}`;
    })
    .join('\n');
}

export async function listDiaryIdsByUser(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(
    `SELECT id
     FROM diary_entries
     WHERE user_id = ?`
  )
    .bind(userId)
    .all<{ id: string }>();
  return (result.results || []).map(row => row.id);
}

export async function deleteDiaryEntriesByUser(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(
    `DELETE FROM diary_entries WHERE user_id = ?`
  )
    .bind(userId)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

export async function deleteConversationLogsByUser(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(
    `DELETE FROM conversation_logs WHERE user_id = ?`
  )
    .bind(userId)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

export async function deleteConversationLogsByIds(env: Env, userId: string, ids: string[]) {
  if (!ids.length) {
    return 0;
  }
  const placeholders = ids.map(() => '?').join(', ');
  const statement = `DELETE FROM conversation_logs WHERE user_id = ? AND id IN (${placeholders})`;
  const result = await env.ATRI_DB.prepare(statement)
    .bind(userId, ...ids)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

export async function saveUserMemory(env: Env, input: UserMemoryInput) {
  const now = Date.now();
  const id = `mem:${input.userId}:${input.category}:${hashKey(input.key)}`;
  const importance = input.importance ?? 5;

  await env.ATRI_DB.prepare(
    `INSERT INTO user_memories (id, user_id, category, key, value, importance, evidence, source_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       value = excluded.value,
       importance = MAX(user_memories.importance, excluded.importance),
       evidence = COALESCE(excluded.evidence, user_memories.evidence),
       source_date = excluded.source_date,
       updated_at = excluded.updated_at`
  )
    .bind(
      id,
      input.userId,
      input.category,
      input.key,
      input.value,
      importance,
      input.evidence ?? null,
      input.sourceDate ?? null,
      now,
      now
    )
    .run();

  return { id, key: input.key, category: input.category };
}

export async function saveUserMemories(env: Env, inputs: UserMemoryInput[]) {
  const results = [];
  for (const input of inputs) {
    const result = await saveUserMemory(env, input);
    results.push(result);
  }
  return results;
}

export async function getUserMemories(
  env: Env,
  userId: string,
  options?: { category?: MemoryCategory; limit?: number }
): Promise<UserMemoryRecord[]> {
  const category = options?.category;
  const limit = options?.limit ?? 20;

  let sql = `SELECT id, user_id as userId, category, key, value, importance, evidence, source_date as sourceDate, created_at as createdAt, updated_at as updatedAt
     FROM user_memories
     WHERE user_id = ?`;
  const bindings: any[] = [userId];

  if (category) {
    sql += ` AND category = ?`;
    bindings.push(category);
  }

  sql += ` ORDER BY importance DESC, updated_at DESC LIMIT ?`;
  bindings.push(limit);

  const result = await env.ATRI_DB.prepare(sql).bind(...bindings).all<UserMemoryRecord>();
  return result.results || [];
}

export async function getTopUserMemories(env: Env, userId: string, limit = 10): Promise<UserMemoryRecord[]> {
  const result = await env.ATRI_DB.prepare(
    `SELECT id, user_id as userId, category, key, value, importance, evidence, source_date as sourceDate, created_at as createdAt, updated_at as updatedAt
     FROM user_memories
     WHERE user_id = ?
     ORDER BY importance DESC, updated_at DESC
     LIMIT ?`
  )
    .bind(userId, limit)
    .all<UserMemoryRecord>();
  return result.results || [];
}

export async function deleteUserMemoriesByUser(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(
    `DELETE FROM user_memories WHERE user_id = ?`
  )
    .bind(userId)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

function hashKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
