import { randomUUID } from 'node:crypto';
import { Env } from '../runtime/types';
import { DEFAULT_TIMEZONE, formatDateInZone, resolveTimestamp } from '../utils/date';

export type ConversationRole = 'user' | 'atri';

export type ConversationLogInput = {
  id?: string;
  userId: string;
  role: ConversationRole;
  content: string;
  timestamp?: number;
  attachments?: unknown[];
  replyTo?: string;
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
  replyTo?: string;
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

export type UserStateRecord = {
  userId: string;
  statusLabel: string;
  statusPillColor: string;
  statusTextColor: string;
  statusReason: string | null;
  statusUpdatedAt: number;
  intimacy: number;
  lastInteractionAt: number;
  updatedAt: number;
};

let conversationTablesEnsured = false;
let ensuringConversationTables: Promise<void> | null = null;

async function ensureConversationTables(env: Env) {
  if (conversationTablesEnsured) return;
  if (ensuringConversationTables) return ensuringConversationTables;

  ensuringConversationTables = (async () => {
    await env.db.query(
      `CREATE TABLE IF NOT EXISTS conversation_log_tombstones (
        user_id TEXT NOT NULL,
        log_id TEXT NOT NULL,
        deleted_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, log_id)
      )`
    );
    await env.db.query(
      `CREATE INDEX IF NOT EXISTS idx_conversation_tombstone_user
        ON conversation_log_tombstones(user_id)`
    );

    await env.db.query(`ALTER TABLE conversation_logs ADD COLUMN IF NOT EXISTS reply_to TEXT`);
    await env.db.query(
      `CREATE INDEX IF NOT EXISTS idx_conversation_user_reply_to
        ON conversation_logs(user_id, reply_to)`
    );

    conversationTablesEnsured = true;
  })().finally(() => {
    ensuringConversationTables = null;
  });

  return ensuringConversationTables;
}

export async function saveConversationLog(env: Env, payload: ConversationLogInput) {
  await ensureConversationTables(env);
  const timestamp = resolveTimestamp(payload.timestamp);
  const timeZone = payload.timeZone || DEFAULT_TIMEZONE;
  const date = payload.date || formatDateInZone(timestamp, timeZone);
  const id = payload.id || randomUUID();
  const attachments = payload.attachments ?? [];
  const replyTo = typeof payload.replyTo === 'string' && payload.replyTo.trim() ? payload.replyTo.trim() : null;
  const now = Date.now();

  const result = await env.db.query(
    `INSERT INTO conversation_logs
        (id, user_id, date, role, content, attachments, reply_to, timestamp, user_name, time_zone, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       date = EXCLUDED.date,
       role = EXCLUDED.role,
       content = EXCLUDED.content,
       attachments = EXCLUDED.attachments,
       reply_to = COALESCE(EXCLUDED.reply_to, conversation_logs.reply_to),
       timestamp = EXCLUDED.timestamp,
       user_name = EXCLUDED.user_name,
       time_zone = EXCLUDED.time_zone
     RETURNING id, date, timestamp`,
    [
      id,
      payload.userId,
      date,
      payload.role,
      payload.content,
      JSON.stringify(attachments),
      replyTo,
      timestamp,
      payload.userName ?? null,
      timeZone,
      now
    ]
  );

  const row = result.rows?.[0] || {};
  return { id: String(row.id || id), date: String(row.date || date), timestamp: Number(row.timestamp || timestamp) };
}

export async function fetchConversationLogs(env: Env, userId: string, date: string): Promise<ConversationLogRecord[]> {
  await ensureConversationTables(env);
  const result = await env.db.query(
    `SELECT logs.id,
            logs.user_id as "userId",
            logs.date,
            logs.role,
            logs.content,
            logs.attachments,
            logs.reply_to as "replyTo",
            logs.timestamp,
            logs.user_name as "userName",
            logs.time_zone as "timeZone"
       FROM conversation_logs logs
       LEFT JOIN conversation_log_tombstones tombstones
         ON logs.user_id = tombstones.user_id AND logs.id = tombstones.log_id
      WHERE logs.user_id = $1 AND logs.date = $2 AND tombstones.log_id IS NULL
      ORDER BY logs.timestamp ASC`,
    [userId, date]
  );

  return (result.rows || []).map(mapConversationLogRow);
}

export async function fetchConversationLogsAfter(
  env: Env,
  params: {
    userId: string;
    after?: number;
    limit?: number;
    roles?: ConversationRole[];
  }
): Promise<ConversationLogRecord[]> {
  await ensureConversationTables(env);

  const userId = String(params.userId || '').trim();
  if (!userId) return [];

  const after = typeof params.after === 'number' && Number.isFinite(params.after) ? params.after : 0;
  const rawLimit = typeof params.limit === 'number' ? params.limit : 50;
  const limit = Math.min(Math.max(rawLimit, 1), 200);
  const roles = Array.isArray(params.roles)
    ? params.roles.filter(role => role === 'user' || role === 'atri')
    : [];

  let sql = `SELECT logs.id,
                    logs.user_id as "userId",
                    logs.date,
                    logs.role,
                    logs.content,
                    logs.attachments,
                    logs.reply_to as "replyTo",
                    logs.timestamp,
                    logs.user_name as "userName",
                    logs.time_zone as "timeZone"
               FROM conversation_logs logs
               LEFT JOIN conversation_log_tombstones tombstones
                 ON logs.user_id = tombstones.user_id AND logs.id = tombstones.log_id
              WHERE logs.user_id = $1 AND logs.timestamp > $2 AND tombstones.log_id IS NULL`;
  const binds: any[] = [userId, after];
  if (roles.length) {
    sql += ` AND logs.role = ANY($3::text[])`;
    binds.push(roles);
  }
  sql += ` ORDER BY logs.timestamp ASC LIMIT $${binds.length + 1}`;
  binds.push(limit);

  const result = await env.db.query(sql, binds);
  return (result.rows || []).map(mapConversationLogRow);
}

export async function fetchConversationLogsByDateRange(
  env: Env,
  params: {
    userId: string;
    dateFrom?: string;
    dateTo?: string;
    after?: number;
    limit?: number;
    roles?: ConversationRole[];
  }
): Promise<ConversationLogRecord[]> {
  await ensureConversationTables(env);

  const userId = String(params.userId || '').trim();
  if (!userId) return [];

  const parseDate = (value: unknown) => {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  };

  let dateFrom = parseDate(params.dateFrom);
  let dateTo = parseDate(params.dateTo);
  if (!dateFrom && !dateTo) return [];
  if (!dateFrom) dateFrom = dateTo;
  if (!dateTo) dateTo = dateFrom;
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];

  const after = typeof params.after === 'number' && Number.isFinite(params.after) ? params.after : 0;
  const rawLimit = typeof params.limit === 'number' ? params.limit : 100;
  const limit = Math.min(Math.max(rawLimit, 1), 500);
  const roles = Array.isArray(params.roles)
    ? params.roles.filter(role => role === 'user' || role === 'atri')
    : [];

  let sql = `SELECT logs.id,
                    logs.user_id as "userId",
                    logs.date,
                    logs.role,
                    logs.content,
                    logs.attachments,
                    logs.reply_to as "replyTo",
                    logs.timestamp,
                    logs.user_name as "userName",
                    logs.time_zone as "timeZone"
               FROM conversation_logs logs
               LEFT JOIN conversation_log_tombstones tombstones
                 ON logs.user_id = tombstones.user_id AND logs.id = tombstones.log_id
              WHERE logs.user_id = $1
                AND logs.date >= $2
                AND logs.date <= $3
                AND tombstones.log_id IS NULL`;
  const binds: any[] = [userId, dateFrom, dateTo];

  if (after > 0) {
    sql += ` AND logs.timestamp > $${binds.length + 1}`;
    binds.push(after);
  }

  if (roles.length) {
    sql += ` AND logs.role = ANY($${binds.length + 1}::text[])`;
    binds.push(roles);
  }

  sql += ` ORDER BY logs.date ASC, logs.timestamp ASC LIMIT $${binds.length + 1}`;
  binds.push(limit);

  const result = await env.db.query(sql, binds);
  return (result.rows || []).map(mapConversationLogRow);
}

function mapConversationLogRow(row: any): ConversationLogRecord {
  return {
    id: String(row.id || ''),
    userId: String(row.userId || ''),
    date: String(row.date || ''),
    role: row.role as ConversationRole,
    content: String(row.content || ''),
    attachments: parseJson(row.attachments),
    replyTo: typeof row.replyTo === 'string' ? row.replyTo : undefined,
    timestamp: Number(row.timestamp || 0),
    userName: typeof row.userName === 'string' ? row.userName : undefined,
    timeZone: typeof row.timeZone === 'string' ? row.timeZone : undefined
  };
}

export async function getConversationLogDate(env: Env, userId: string, logId: string): Promise<string | null> {
  await ensureConversationTables(env);
  const trimmedUserId = String(userId || '').trim();
  const trimmedLogId = String(logId || '').trim();
  if (!trimmedUserId || !trimmedLogId) {
    return null;
  }

  const result = await env.db.query(
    `SELECT date
       FROM conversation_logs
      WHERE user_id = $1 AND id = $2
      LIMIT 1`,
    [trimmedUserId, trimmedLogId]
  );

  const row = result.rows?.[0];
  const date = String(row?.date || '').trim();
  return date ? date : null;
}

export async function listPendingDiaryUsers(env: Env, date: string) {
  const result = await env.db.query(
    `SELECT logs.user_id as "userId",
            MAX(logs.user_name) as "userName",
            MAX(logs.time_zone) as "timeZone"
       FROM conversation_logs logs
       LEFT JOIN diary_entries diary
         ON diary.user_id = logs.user_id AND diary.date = logs.date AND diary.status = 'ready'
      WHERE logs.date = $1 AND diary.id IS NULL
      GROUP BY logs.user_id`,
    [date]
  );
  return (result.rows || []).map((row: any) => ({
    userId: String(row.userId || ''),
    userName: typeof row.userName === 'string' ? row.userName : undefined,
    timeZone: typeof row.timeZone === 'string' ? row.timeZone : undefined
  }));
}

export async function getLastConversationDate(env: Env, userId: string, beforeDate: string): Promise<string | null> {
  const result = await env.db.query(
    `SELECT date
       FROM conversation_logs
      WHERE user_id = $1 AND date < $2
      ORDER BY date DESC
      LIMIT 1`,
    [userId, beforeDate]
  );
  const row = result.rows?.[0];
  return row?.date ? String(row.date) : null;
}

export async function getFirstConversationTimestamp(env: Env, userId: string): Promise<number | null> {
  const result = await env.db.query(
    `SELECT timestamp
       FROM conversation_logs
      WHERE user_id = $1
      ORDER BY timestamp ASC
      LIMIT 1`,
    [userId]
  );
  const row = result.rows?.[0];
  const ts = row?.timestamp;
  const n = typeof ts === 'number' ? ts : Number(ts);
  return Number.isFinite(n) ? n : null;
}

export function calculateDaysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

export async function getDiaryEntry(env: Env, userId: string, date: string) {
  const result = await env.db.query(
    `SELECT id,
            user_id as "userId",
            date,
            summary,
            content,
            mood,
            status,
            created_at as "createdAt",
            updated_at as "updatedAt"
       FROM diary_entries
      WHERE user_id = $1 AND date = $2
      LIMIT 1`,
    [userId, date]
  );
  const row = result.rows?.[0];
  if (!row) return null;

  return {
    id: String(row.id),
    userId: String(row.userId),
    date: String(row.date),
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    content: typeof row.content === 'string' ? row.content : undefined,
    mood: typeof row.mood === 'string' ? row.mood : undefined,
    status: row.status as any,
    createdAt: Number(row.createdAt || 0),
    updatedAt: Number(row.updatedAt || 0)
  } as DiaryEntryRecord;
}

export async function getDiaryEntryById(env: Env, id: string) {
  const result = await env.db.query(
    `SELECT id,
            user_id as "userId",
            date,
            summary,
            content,
            mood,
            status,
            created_at as "createdAt",
            updated_at as "updatedAt"
       FROM diary_entries
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  const row = result.rows?.[0];
  if (!row) return null;

  return {
    id: String(row.id),
    userId: String(row.userId),
    date: String(row.date),
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    content: typeof row.content === 'string' ? row.content : undefined,
    mood: typeof row.mood === 'string' ? row.mood : undefined,
    status: row.status as any,
    createdAt: Number(row.createdAt || 0),
    updatedAt: Number(row.updatedAt || 0)
  } as DiaryEntryRecord;
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

  await env.db.query(
    `INSERT INTO diary_entries (id, user_id, date, summary, content, mood, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET
       summary = EXCLUDED.summary,
       content = EXCLUDED.content,
       mood = EXCLUDED.mood,
       status = EXCLUDED.status,
       updated_at = EXCLUDED.updated_at`,
    [id, entry.userId, entry.date, summary, entry.content, entry.mood ?? null, status, now, now]
  );

  return { id, summary, status };
}

export async function listDiaryEntries(env: Env, userId: string, limit = 7) {
  const result = await env.db.query(
    `SELECT id,
            user_id as "userId",
            date,
            summary,
            content,
            mood,
            status,
            created_at as "createdAt",
            updated_at as "updatedAt"
       FROM diary_entries
      WHERE user_id = $1
      ORDER BY date DESC
      LIMIT $2`,
    [userId, limit]
  );

  return (result.rows || []).map((row: any) => ({
    id: String(row.id),
    userId: String(row.userId),
    date: String(row.date),
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    content: typeof row.content === 'string' ? row.content : undefined,
    mood: typeof row.mood === 'string' ? row.mood : undefined,
    status: row.status as any,
    createdAt: Number(row.createdAt || 0),
    updatedAt: Number(row.updatedAt || 0)
  })) as DiaryEntryRecord[];
}

export async function markDiaryPending(env: Env, userId: string, date: string) {
  const now = Date.now();
  const result = await env.db.query(
    `UPDATE diary_entries
        SET status = 'pending', updated_at = $3
      WHERE user_id = $1 AND date = $2`,
    [userId, date, now]
  );
  return Number(result.rowCount || 0);
}

export async function getUserModelPreference(env: Env, userId: string): Promise<string | null> {
  const result = await env.db.query(
    `SELECT model_key as "modelKey"
       FROM user_settings
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );
  const row = result.rows?.[0];
  const trimmed = String(row?.modelKey || '').trim();
  return trimmed ? trimmed : null;
}

export async function saveUserModelPreference(env: Env, userId: string, modelKey: string) {
  const trimmed = String(modelKey || '').trim();
  if (!trimmed) return;
  const now = Date.now();
  await env.db.query(
    `INSERT INTO user_settings (user_id, model_key, created_at, updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET
       model_key = EXCLUDED.model_key,
       updated_at = EXCLUDED.updated_at`,
    [userId, trimmed, now, now]
  );
}

export async function getUserProfile(env: Env, userId: string): Promise<UserProfileRecord | null> {
  const result = await env.db.query(
    `SELECT user_id as "userId",
            content,
            created_at as "createdAt",
            updated_at as "updatedAt"
       FROM user_profiles
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );
  const row = result.rows?.[0];
  if (!row) return null;
  return {
    userId: String(row.userId),
    content: typeof row.content === 'string' ? row.content : null,
    createdAt: Number(row.createdAt || 0),
    updatedAt: Number(row.updatedAt || 0)
  };
}

export async function saveUserProfile(env: Env, params: { userId: string; content: string }) {
  const now = Date.now();
  const cleaned = String(params.content || '').trim();
  await env.db.query(
    `INSERT INTO user_profiles (user_id, content, created_at, updated_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET
       content = EXCLUDED.content,
       updated_at = EXCLUDED.updated_at`,
    [params.userId, cleaned, now, now]
  );
  return { userId: params.userId, updatedAt: now };
}

export async function deleteUserSettingsByUser(env: Env, userId: string) {
  const result = await env.db.query(
    `DELETE FROM user_settings WHERE user_id = $1`,
    [userId]
  );
  return Number(result.rowCount || 0);
}

export async function getUserState(env: Env, userId: string): Promise<UserStateRecord> {
  const result = await env.db.query(
    `SELECT user_id as "userId",
            status_label as "statusLabel",
            status_pill_color as "statusPillColor",
            status_text_color as "statusTextColor",
            status_reason as "statusReason",
            status_updated_at as "statusUpdatedAt",
            intimacy,
            last_interaction_at as "lastInteractionAt",
            updated_at as "updatedAt"
       FROM user_states
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );

  const row = result.rows?.[0] as any;
  const now = Date.now();
  if (!row) {
    return {
      userId,
      statusLabel: DEFAULT_STATUS_LABEL,
      statusPillColor: DEFAULT_STATUS_PILL_COLOR,
      statusTextColor: DEFAULT_STATUS_TEXT_COLOR,
      statusReason: null,
      statusUpdatedAt: now,
      intimacy: 0,
      lastInteractionAt: now,
      updatedAt: now
    };
  }

  const lastInteraction = Number.isFinite(Number(row.lastInteractionAt)) ? Number(row.lastInteractionAt) : now;
  const rawIntimacy = Number.isFinite(Number(row.intimacy)) ? Number(row.intimacy) : 0;
  const decayedIntimacy = applyIntimacyDecay(rawIntimacy, lastInteraction, now);

  return {
    userId: String(row.userId || userId),
    statusLabel: normalizeStatusLabel(row.statusLabel),
    statusPillColor: normalizeStatusColor(row.statusPillColor, DEFAULT_STATUS_PILL_COLOR),
    statusTextColor: normalizeStatusColor(row.statusTextColor, DEFAULT_STATUS_TEXT_COLOR),
    statusReason: normalizeStatusReason(row.statusReason),
    statusUpdatedAt: Number.isFinite(Number(row.statusUpdatedAt))
      ? Number(row.statusUpdatedAt)
      : now,
    intimacy: decayedIntimacy,
    lastInteractionAt: lastInteraction,
    updatedAt: Number.isFinite(Number(row.updatedAt)) ? Number(row.updatedAt) : now
  };
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
  await env.db.query(
    `INSERT INTO user_states
        (user_id, status_label, status_pill_color, status_text_color, status_reason, status_updated_at, intimacy, last_interaction_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id) DO UPDATE SET
       status_label = EXCLUDED.status_label,
       status_pill_color = EXCLUDED.status_pill_color,
       status_text_color = EXCLUDED.status_text_color,
       status_reason = EXCLUDED.status_reason,
       status_updated_at = EXCLUDED.status_updated_at,
       intimacy = EXCLUDED.intimacy,
       last_interaction_at = EXCLUDED.last_interaction_at,
       updated_at = EXCLUDED.updated_at`,
    [
      payload.userId,
      payload.statusLabel,
      payload.statusPillColor,
      payload.statusTextColor,
      payload.statusReason,
      payload.statusUpdatedAt,
      payload.intimacy,
      payload.lastInteractionAt,
      payload.updatedAt
    ]
  );
}

export async function updateStatusState(env: Env, params: {
  userId: string;
  label?: string;
  pillColor?: string;
  textColor?: string;
  reason?: string;
  touchedAt?: number;
  currentState?: UserStateRecord;
}) {
  const current = params.currentState ?? await getUserState(env, params.userId);
  const now = typeof params.touchedAt === 'number' ? params.touchedAt : Date.now();
  const next: UserStateRecord = {
    ...current,
    statusLabel: normalizeStatusLabel(params.label, current.statusLabel),
    statusPillColor: normalizeStatusColor(params.pillColor, current.statusPillColor),
    statusTextColor: normalizeStatusColor(params.textColor, current.statusTextColor),
    statusReason: normalizeStatusReason(params.reason, current.statusReason),
    statusUpdatedAt: now,
    lastInteractionAt: now,
    updatedAt: now
  };

  await saveUserState(env, next);
  console.log('[ATRI] status updated', {
    userId: params.userId,
    statusLabel: next.statusLabel,
    statusPillColor: next.statusPillColor,
    statusTextColor: next.statusTextColor,
    statusReason: next.statusReason
  });
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
  const result = await env.db.query(
    `SELECT id FROM diary_entries WHERE user_id = $1`,
    [userId]
  );
  return (result.rows || []).map((row: any) => String(row.id));
}

export async function listDiaryDatesByUser(env: Env, userId: string) {
  const result = await env.db.query(
    `SELECT date
       FROM diary_entries
      WHERE user_id = $1
      ORDER BY date DESC`,
    [userId]
  );
  return (result.rows || [])
    .map((row: any) => String(row?.date || '').trim())
    .filter(Boolean);
}

export async function deleteDiaryEntriesByUser(env: Env, userId: string) {
  const result = await env.db.query(
    `DELETE FROM diary_entries WHERE user_id = $1`,
    [userId]
  );
  return Number(result.rowCount || 0);
}

export async function deleteConversationLogsByUser(env: Env, userId: string) {
  await ensureConversationTables(env);
  await env.db.query(
    `DELETE FROM conversation_log_tombstones WHERE user_id = $1`,
    [userId]
  );
  const result = await env.db.query(
    `DELETE FROM conversation_logs WHERE user_id = $1`,
    [userId]
  );
  return Number(result.rowCount || 0);
}

export async function isConversationLogDeleted(env: Env, userId: string, logId: string) {
  await ensureConversationTables(env);
  const trimmedUserId = String(userId || '').trim();
  const trimmedLogId = String(logId || '').trim();
  if (!trimmedUserId || !trimmedLogId) return false;

  const result = await env.db.query(
    `SELECT 1 as ok
       FROM conversation_log_tombstones
      WHERE user_id = $1 AND log_id = $2
      LIMIT 1`,
    [trimmedUserId, trimmedLogId]
  );
  return Boolean(result.rows?.[0]?.ok);
}

export async function markConversationLogsDeleted(env: Env, userId: string, ids: string[]) {
  await ensureConversationTables(env);
  const trimmedUserId = String(userId || '').trim();
  const trimmedIds = Array.isArray(ids) ? ids.map(id => String(id || '').trim()).filter(Boolean) : [];
  if (!trimmedUserId || trimmedIds.length === 0) return 0;

  const deletedAt = Date.now();
  const result = await env.db.query(
    `INSERT INTO conversation_log_tombstones (user_id, log_id, deleted_at)
     SELECT $1, UNNEST($2::text[]), $3
     ON CONFLICT (user_id, log_id) DO UPDATE SET
       deleted_at = GREATEST(conversation_log_tombstones.deleted_at, EXCLUDED.deleted_at)`,
    [trimmedUserId, trimmedIds, deletedAt]
  );
  return Number(result.rowCount || 0);
}

export type TombstoneRecord = {
  logId: string;
  deletedAt: number;
};

export async function fetchTombstonesAfter(
  env: Env,
  params: { userId: string; after?: number; limit?: number }
): Promise<TombstoneRecord[]> {
  await ensureConversationTables(env);

  const userId = String(params.userId || '').trim();
  if (!userId) return [];

  const after = typeof params.after === 'number' && Number.isFinite(params.after) ? params.after : 0;
  const rawLimit = typeof params.limit === 'number' ? params.limit : 100;
  const limit = Math.min(Math.max(rawLimit, 1), 500);

  const result = await env.db.query(
    `SELECT log_id as "logId", deleted_at as "deletedAt"
       FROM conversation_log_tombstones
      WHERE user_id = $1 AND deleted_at > $2
      ORDER BY deleted_at ASC
      LIMIT $3`,
    [userId, after, limit]
  );

  return (result.rows || []).map((row: any) => ({
    logId: String(row.logId || ''),
    deletedAt: Number(row.deletedAt || 0)
  }));
}

export async function deleteConversationLogsByIds(env: Env, userId: string, ids: string[]) {
  await ensureConversationTables(env);
  const trimmedUserId = String(userId || '').trim();
  const trimmedIds = Array.isArray(ids) ? ids.map(id => String(id || '').trim()).filter(Boolean) : [];
  if (!trimmedUserId || trimmedIds.length === 0) return 0;

  const replyResult = await env.db.query(
    `SELECT id
       FROM conversation_logs
      WHERE user_id = $1 AND reply_to = ANY($2::text[])`,
    [trimmedUserId, trimmedIds]
  );
  const replyIds = (replyResult.rows || []).map((row: any) => String(row?.id || '').trim()).filter(Boolean);

  const tombstoneIds = Array.from(new Set([...trimmedIds, ...replyIds]));
  await markConversationLogsDeleted(env, trimmedUserId, tombstoneIds);

  const result = await env.db.query(
    `DELETE FROM conversation_logs
      WHERE user_id = $1
        AND (id = ANY($2::text[]) OR reply_to = ANY($3::text[]))`,
    [trimmedUserId, tombstoneIds, trimmedIds]
  );
  return Number(result.rowCount || 0);
}

const DEFAULT_STATUS_LABEL = '陪着你';
const DEFAULT_STATUS_PILL_COLOR = '#7E8EA3';
const DEFAULT_STATUS_TEXT_COLOR = '#FFFFFF';

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
  if (delta > 0 && currentIntimacy < 0) {
    return Math.max(1, Math.round(delta * 0.6));
  }
  return delta;
}

function normalizeUserState(state: UserStateRecord): UserStateRecord {
  const now = Date.now();
  return {
    userId: state.userId,
    statusLabel: normalizeStatusLabel(state.statusLabel),
    statusPillColor: normalizeStatusColor(state.statusPillColor, DEFAULT_STATUS_PILL_COLOR),
    statusTextColor: normalizeStatusColor(state.statusTextColor, DEFAULT_STATUS_TEXT_COLOR),
    statusReason: normalizeStatusReason(state.statusReason),
    statusUpdatedAt: Number.isFinite(state.statusUpdatedAt) ? Number(state.statusUpdatedAt) : now,
    intimacy: clampIntimacy(state.intimacy),
    lastInteractionAt: Number.isFinite(state.lastInteractionAt) ? Number(state.lastInteractionAt) : now,
    updatedAt: Number.isFinite(state.updatedAt) ? Number(state.updatedAt) : now
  };
}

function normalizeStatusLabel(value: unknown, fallback = DEFAULT_STATUS_LABEL) {
  const raw = String(value || '').trim();
  if (raw) {
    return raw.slice(0, 40);
  }
  const fallbackText = String(fallback || '').trim();
  return fallbackText ? fallbackText.slice(0, 40) : DEFAULT_STATUS_LABEL;
}

function normalizeStatusColor(value: unknown, fallback: string) {
  const raw = String(value || '').trim();
  if (raw) {
    return raw.slice(0, 32);
  }
  const fallbackText = String(fallback || '').trim();
  return fallbackText || '#7E8EA3';
}

function normalizeStatusReason(value: unknown, fallback: string | null = null) {
  const raw = String(value || '').trim();
  if (raw) {
    return raw.slice(0, 120);
  }
  const fallbackText = String(fallback || '').trim();
  return fallbackText ? fallbackText.slice(0, 120) : null;
}
