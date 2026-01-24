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
  mood?: string;
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
  mood?: string;
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

export type UserSettingsRecord = {
  userId: string;
  modelKey?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type UserProfileRecord = {
  userId: string;
  content?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AtriSelfReviewRecord = {
  userId: string;
  content?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type PadValues = [number, number, number];

export type UserStateRecord = {
  userId: string;
  padValues: PadValues;
  intimacy: number;
  lastInteractionAt: number;
  updatedAt: number;
};

export async function saveConversationLog(env: Env, payload: ConversationLogInput) {
  const timestamp = resolveTimestamp(payload.timestamp);
  const timeZone = payload.timeZone || DEFAULT_TIMEZONE;
  const date = payload.date || formatDateInZone(timestamp, timeZone);
  const id = payload.id || crypto.randomUUID();
  const attachments = payload.attachments ?? [];
  await env.ATRI_DB.prepare(
    `INSERT INTO conversation_logs
        (id, user_id, date, role, content, attachments, mood, timestamp, user_name, time_zone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       date = excluded.date,
       role = excluded.role,
       content = excluded.content,
       attachments = excluded.attachments,
       mood = excluded.mood,
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
      payload.mood ?? null,
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
    `SELECT id, user_id as userId, date, role, content, attachments, mood, timestamp, user_name as userName, time_zone as timeZone
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

export async function getConversationLogDate(env: Env, userId: string, logId: string): Promise<string | null> {
  const trimmedUserId = String(userId || '').trim();
  const trimmedLogId = String(logId || '').trim();
  if (!trimmedUserId || !trimmedLogId) {
    return null;
  }

  const row = await env.ATRI_DB.prepare(
    `SELECT date
     FROM conversation_logs
     WHERE user_id = ? AND id = ?
     LIMIT 1`
  )
    .bind(trimmedUserId, trimmedLogId)
    .first<{ date?: string }>();

  const date = String(row?.date || '').trim();
  return date ? date : null;
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

export async function getFirstConversationTimestamp(env: Env, userId: string): Promise<number | null> {
  const row = await env.ATRI_DB.prepare(
    `SELECT timestamp
     FROM conversation_logs
     WHERE user_id = ?
     ORDER BY timestamp ASC
     LIMIT 1`
  )
    .bind(userId)
    .first<{ timestamp?: number }>();

  const ts = row?.timestamp;
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
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
  const summary = entry.summary ?? entry.content;
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

export async function getUserModelPreference(env: Env, userId: string): Promise<string | null> {
  const row = await env.ATRI_DB.prepare(
    `SELECT model_key as modelKey
     FROM user_settings
     WHERE user_id = ?`
  )
    .bind(userId)
    .first<{ modelKey?: string }>();

  const trimmed = (row?.modelKey || '').trim();
  return trimmed ? trimmed : null;
}

export async function saveUserModelPreference(env: Env, userId: string, modelKey: string) {
  const trimmed = (modelKey || '').trim();
  if (!trimmed) {
    return;
  }
  const now = Date.now();
  await env.ATRI_DB.prepare(
    `INSERT INTO user_settings (user_id, model_key, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       model_key = excluded.model_key,
       updated_at = excluded.updated_at`
  )
    .bind(userId, trimmed, now, now)
    .run();
}

export async function getUserProfile(env: Env, userId: string): Promise<UserProfileRecord | null> {
  const row = await env.ATRI_DB.prepare(
    `SELECT user_id as userId, content, created_at as createdAt, updated_at as updatedAt
     FROM user_profiles
     WHERE user_id = ?`
  )
    .bind(userId)
    .first<UserProfileRecord>();
  return row ?? null;
}

export async function saveUserProfile(env: Env, params: {
  userId: string;
  content: string;
}) {
  const now = Date.now();
  const cleaned = (params.content || '').trim();
  await env.ATRI_DB.prepare(
    `INSERT INTO user_profiles (user_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       content = excluded.content,
       updated_at = excluded.updated_at`
  )
    .bind(params.userId, cleaned, now, now)
    .run();
  return { userId: params.userId, updatedAt: now };
}

export async function getAtriSelfReview(env: Env, userId: string): Promise<AtriSelfReviewRecord | null> {
  const row = await env.ATRI_DB.prepare(
    `SELECT user_id as userId, content, created_at as createdAt, updated_at as updatedAt
     FROM atri_self_reviews
     WHERE user_id = ?`
  )
    .bind(userId)
    .first<AtriSelfReviewRecord>();
  return row ?? null;
}

export async function saveAtriSelfReview(env: Env, params: {
  userId: string;
  content: string;
}) {
  const now = Date.now();
  const cleaned = (params.content || '').trim();
  await env.ATRI_DB.prepare(
    `INSERT INTO atri_self_reviews (user_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       content = excluded.content,
       updated_at = excluded.updated_at`
  )
    .bind(params.userId, cleaned, now, now)
    .run();
  return { userId: params.userId, updatedAt: now };
}

export async function deleteUserSettingsByUser(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(
    `DELETE FROM user_settings WHERE user_id = ?`
  )
    .bind(userId)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

export async function getUserState(env: Env, userId: string): Promise<UserStateRecord> {
  const row = await env.ATRI_DB.prepare(
    `SELECT user_id as userId, pad_values as padValues, intimacy, last_interaction_at as lastInteractionAt, updated_at as updatedAt
     FROM user_states
     WHERE user_id = ?`
  )
    .bind(userId)
    .first<{
      userId: string;
      padValues: string;
      intimacy?: number;
      lastInteractionAt?: number;
      updatedAt?: number;
    }>();

  const now = Date.now();
  if (!row) {
    return {
      userId,
      padValues: [...DEFAULT_PAD_VALUES],
      intimacy: 0,
      lastInteractionAt: now,
      updatedAt: now
    };
  }

  const rawPad = parsePadValues(row.padValues);
  const lastInteraction = Number.isFinite(row.lastInteractionAt) ? Number(row.lastInteractionAt) : now;
  const decayedPad = applyMoodDecay(rawPad, lastInteraction, now);
  const rawIntimacy = Number.isFinite(row.intimacy) ? Number(row.intimacy) : 0;
  const decayedIntimacy = applyIntimacyDecay(rawIntimacy, lastInteraction, now);

  return {
    userId: row.userId || userId,
    padValues: decayedPad,
    intimacy: decayedIntimacy,
    lastInteractionAt: lastInteraction,
    updatedAt: Number.isFinite(row.updatedAt) ? Number(row.updatedAt) : now
  };
}

function applyMoodDecay(pad: PadValues, lastInteractionAt: number, now: number): PadValues {
  const hoursSince = (now - lastInteractionAt) / 3600000;
  if (hoursSince < 0.5) return pad;

  const decayRate = 0.92;
  const cappedHours = Math.min(hoursSince, 48);
  const factor = Math.pow(decayRate, cappedHours);

  return [
    clampPad(pad[0] * factor),
    clampPad(pad[1] * factor),
    clampPad(pad[2] * factor)
  ];
}

function applyIntimacyDecay(intimacy: number, lastInteractionAt: number, now: number) {
  if (!Number.isFinite(intimacy)) return 0;

  const daysSince = (now - lastInteractionAt) / 86400000;
  const steps = Math.floor(daysSince / 3);
  if (steps <= 0) return clampIntimacy(intimacy);

  const current = clampIntimacy(intimacy);
  if (current === 0) return 0;

  if (current > 0) {
    return clampIntimacy(Math.max(0, current - steps));
  }
  return clampIntimacy(Math.min(0, current + steps));
}

export async function saveUserState(env: Env, state: UserStateRecord) {
  const payload = normalizeUserState(state);
  await env.ATRI_DB.prepare(
    `INSERT INTO user_states (user_id, pad_values, intimacy, last_interaction_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       pad_values = excluded.pad_values,
       intimacy = excluded.intimacy,
       last_interaction_at = excluded.last_interaction_at,
       updated_at = excluded.updated_at`
  )
    .bind(
      payload.userId,
      JSON.stringify(payload.padValues),
      payload.intimacy,
      payload.lastInteractionAt,
      payload.updatedAt
    )
    .run();
}

export async function updateMoodState(env: Env, params: {
  userId: string;
  pleasureDelta: number;
  arousalDelta: number;
  dominanceDelta?: number;
  touchedAt?: number;
  reason?: string;
  currentState?: UserStateRecord;
}) {
  const current = params.currentState ?? await getUserState(env, params.userId);
  const now = typeof params.touchedAt === 'number' ? params.touchedAt : Date.now();
  const nextPad: PadValues = [
    clampPad(current.padValues[0] + safeNumber(params.pleasureDelta)),
    clampPad(current.padValues[1] + safeNumber(params.arousalDelta)),
    clampPad(current.padValues[2] + safeNumber(params.dominanceDelta))
  ];

  const next: UserStateRecord = {
    ...current,
    padValues: nextPad,
    lastInteractionAt: now,
    updatedAt: now
  };

  await saveUserState(env, next);
  if (params.reason) {
    console.log('[ATRI] mood updated', { userId: params.userId, padValues: nextPad, reason: params.reason });
  }
  return next;
}

export async function updateIntimacyState(env: Env, params: {
  userId: string;
  delta: number;
  touchedAt?: number;
  reason?: string;
  currentState?: UserStateRecord;
}) {
  const current = params.currentState ?? await getUserState(env, params.userId);
  const now = typeof params.touchedAt === 'number' ? params.touchedAt : Date.now();
  const delta = clampIntimacyDelta(safeInt(params.delta));
  const effectiveDelta = applyIntimacyDelta(current.intimacy, delta);
  const nextIntimacy = clampIntimacy(current.intimacy + effectiveDelta);
  const next: UserStateRecord = {
    ...current,
    intimacy: nextIntimacy,
    lastInteractionAt: now,
    updatedAt: now
  };
  await saveUserState(env, next);
  if (params.reason) {
    console.log('[ATRI] intimacy updated', { userId: params.userId, intimacy: nextIntimacy, reason: params.reason });
  }
  return next;
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
  const lines: string[] = [];

  for (const log of logs) {
    const speaker = log.role === 'atri' ? 'ATRI' : (log.userName || name);
    const normalized = String(log.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (const rawLine of normalized.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      lines.push(`${speaker}：${line}`);
    }
  }

  return lines.join('\n');
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

export async function listDiaryDatesByUser(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(
    `SELECT date
     FROM diary_entries
     WHERE user_id = ?
     ORDER BY date DESC`
  )
    .bind(userId)
    .all<{ date: string }>();
  return (result.results || [])
    .map(row => String(row?.date || '').trim())
    .filter(Boolean);
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

const DEFAULT_PAD_VALUES: PadValues = [0.2, 0.3, 0];

function parsePadValues(value: string | null | undefined): PadValues {
  if (!value) {
    return [...DEFAULT_PAD_VALUES];
  }
  try {
    const arr = JSON.parse(value);
    if (Array.isArray(arr) && arr.length === 3) {
      return [
        clampPad(Number(arr[0] ?? 0)),
        clampPad(Number(arr[1] ?? 0)),
        clampPad(Number(arr[2] ?? 0))
      ];
    }
  } catch (error) {
    console.warn('[ATRI] parsePadValues failed', error);
  }
  return [...DEFAULT_PAD_VALUES];
}

function clampPad(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function safeNumber(value: any) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function safeInt(value: any) {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(Number(value));
}

function clampIntimacy(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, Math.trunc(value)));
}

function clampIntimacyDelta(delta: number) {
  if (!Number.isFinite(delta)) return 0;
  const n = Math.trunc(delta);
  if (n > 10) return 10;
  if (n < -50) return -50;
  return n;
}

function applyIntimacyDelta(currentIntimacy: number, delta: number) {
  if (!delta) return 0;

  // 修复更难：负数时的升温会打折
  if (delta > 0 && currentIntimacy < 0) {
    return Math.max(1, Math.round(delta * 0.6));
  }

  return delta;
}

function normalizeUserState(state: UserStateRecord): UserStateRecord {
  const now = Date.now();
  return {
    userId: state.userId,
    padValues: [
      clampPad(state.padValues?.[0] ?? 0),
      clampPad(state.padValues?.[1] ?? 0),
      clampPad(state.padValues?.[2] ?? 0)
    ],
    intimacy: clampIntimacy(state.intimacy),
    lastInteractionAt: Number.isFinite(state.lastInteractionAt) ? Number(state.lastInteractionAt) : now,
    updatedAt: Number.isFinite(state.updatedAt) ? Number(state.updatedAt) : now
  };
}
