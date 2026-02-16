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

export type TombstoneRecord = {
  logId: string;
  deletedAt: number;
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

export type ProactiveMessageStatus = 'pending' | 'delivered' | 'expired';

export type ProactiveMessageRecord = {
  id: string;
  userId: string;
  content: string;
  triggerContext: string | null;
  status: ProactiveMessageStatus;
  notificationChannel: 'email' | 'wechat_work' | 'none' | null;
  notificationSent: boolean;
  notificationError: string | null;
  createdAt: number;
  deliveredAt: number | null;
  expiresAt: number;
};

export type ProactiveUserStateRecord = {
  userId: string;
  lastProactiveAt: number;
  dailyCount: number;
  dailyCountDate: string | null;
  updatedAt: number;
};

export type ProactiveCandidateUser = {
  userId: string;
  lastInteractionAt: number;
  userName?: string;
  timeZone?: string;
};

let conversationTablesEnsured = false;
let ensuringConversationTables: Promise<void> | null = null;
let proactiveTablesEnsured = false;
let ensuringProactiveTables: Promise<void> | null = null;
let userStateColumnsEnsured = false;
let ensuringUserStateColumns: Promise<void> | null = null;

async function ensureConversationTables(env: Env) {
  if (conversationTablesEnsured) return;
  if (ensuringConversationTables) return ensuringConversationTables;

  ensuringConversationTables = (async () => {
    await env.ATRI_DB.prepare(
      `CREATE TABLE IF NOT EXISTS conversation_log_tombstones (
        user_id TEXT NOT NULL,
        log_id TEXT NOT NULL,
        deleted_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, log_id)
      )`
    ).run();
    await env.ATRI_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_conversation_tombstone_user_deleted_at
        ON conversation_log_tombstones(user_id, deleted_at)`
    ).run();
    await env.ATRI_DB.prepare(`ALTER TABLE conversation_logs ADD COLUMN reply_to TEXT`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(`ALTER TABLE conversation_logs DROP COLUMN mood`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(`DROP TABLE IF EXISTS atri_self_reviews`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_conversation_user_reply_to
        ON conversation_logs(user_id, reply_to)`
    ).run();
    conversationTablesEnsured = true;
  })().finally(() => {
    ensuringConversationTables = null;
  });

  return ensuringConversationTables;
}

const DEFAULT_STATUS_LABEL = '陪着你';
const DEFAULT_STATUS_PILL_COLOR = '#7E8EA3';
const DEFAULT_STATUS_TEXT_COLOR = '#FFFFFF';

async function ensureUserStateColumns(env: Env) {
  if (userStateColumnsEnsured) return;
  if (ensuringUserStateColumns) return ensuringUserStateColumns;

  ensuringUserStateColumns = (async () => {
    await env.ATRI_DB.prepare(`ALTER TABLE user_states ADD COLUMN status_label TEXT`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(`ALTER TABLE user_states ADD COLUMN status_pill_color TEXT`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(`ALTER TABLE user_states ADD COLUMN status_text_color TEXT`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(`ALTER TABLE user_states ADD COLUMN status_reason TEXT`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(`ALTER TABLE user_states ADD COLUMN status_updated_at INTEGER`).run().catch(() => undefined);

    await env.ATRI_DB.prepare(
      `UPDATE user_states
          SET status_label = ?
        WHERE status_label IS NULL OR TRIM(status_label) = ''`
    )
      .bind(DEFAULT_STATUS_LABEL)
      .run()
      .catch(() => undefined);

    await env.ATRI_DB.prepare(
      `UPDATE user_states
          SET status_pill_color = ?
        WHERE status_pill_color IS NULL OR TRIM(status_pill_color) = ''`
    )
      .bind(DEFAULT_STATUS_PILL_COLOR)
      .run()
      .catch(() => undefined);

    await env.ATRI_DB.prepare(
      `UPDATE user_states
          SET status_text_color = ?
        WHERE status_text_color IS NULL OR TRIM(status_text_color) = ''`
    )
      .bind(DEFAULT_STATUS_TEXT_COLOR)
      .run()
      .catch(() => undefined);

    await env.ATRI_DB.prepare(
      `UPDATE user_states
          SET status_updated_at = COALESCE(status_updated_at, updated_at, CAST(strftime('%s','now') AS INTEGER) * 1000)`
    )
      .run()
      .catch(() => undefined);

    userStateColumnsEnsured = true;
  })().finally(() => {
    ensuringUserStateColumns = null;
  });

  return ensuringUserStateColumns;
}

async function ensureProactiveTables(env: Env) {
  if (proactiveTablesEnsured) return;
  if (ensuringProactiveTables) return ensuringProactiveTables;

  ensuringProactiveTables = (async () => {
    await env.ATRI_DB.prepare(
      `CREATE TABLE IF NOT EXISTS proactive_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        trigger_context TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        notification_channel TEXT,
        notification_sent INTEGER NOT NULL DEFAULT 0,
        notification_error TEXT,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        expires_at INTEGER NOT NULL
      )`
    ).run();
    await env.ATRI_DB.prepare(`ALTER TABLE proactive_messages ADD COLUMN notification_channel TEXT`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(`ALTER TABLE proactive_messages ADD COLUMN notification_sent INTEGER NOT NULL DEFAULT 0`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(`ALTER TABLE proactive_messages ADD COLUMN notification_error TEXT`).run().catch(() => undefined);
    await env.ATRI_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_proactive_messages_user_created
        ON proactive_messages(user_id, created_at DESC)`
    ).run();
    await env.ATRI_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_proactive_messages_status_created
        ON proactive_messages(status, created_at DESC)`
    ).run();
    await env.ATRI_DB.prepare(
      `CREATE TABLE IF NOT EXISTS proactive_user_state (
        user_id TEXT PRIMARY KEY,
        last_proactive_at INTEGER NOT NULL DEFAULT 0,
        daily_count INTEGER NOT NULL DEFAULT 0,
        daily_count_date TEXT,
        updated_at INTEGER NOT NULL
      )`
    ).run();
    proactiveTablesEnsured = true;
  })().finally(() => {
    ensuringProactiveTables = null;
  });

  return ensuringProactiveTables;
}

export async function saveConversationLog(env: Env, payload: ConversationLogInput) {
  await ensureConversationTables(env);
  const timestamp = resolveTimestamp(payload.timestamp);
  const timeZone = payload.timeZone || DEFAULT_TIMEZONE;
  const date = payload.date || formatDateInZone(timestamp, timeZone);
  const id = payload.id || crypto.randomUUID();
  const attachments = payload.attachments ?? [];
  const replyTo = typeof payload.replyTo === 'string' && payload.replyTo.trim() ? payload.replyTo.trim() : null;
  await env.ATRI_DB.prepare(
    `INSERT INTO conversation_logs
        (id, user_id, date, role, content, attachments, reply_to, timestamp, user_name, time_zone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       date = excluded.date,
       role = excluded.role,
       content = excluded.content,
       attachments = excluded.attachments,
       reply_to = CASE
         WHEN excluded.reply_to IS NOT NULL AND excluded.reply_to <> '' THEN excluded.reply_to
         ELSE conversation_logs.reply_to
       END,
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
      replyTo,
      timestamp,
      payload.userName ?? null,
      timeZone,
      Date.now()
    )
    .run();
  return { id, date, timestamp };
}

export async function fetchConversationLogs(env: Env, userId: string, date: string): Promise<ConversationLogRecord[]> {
  await ensureConversationTables(env);
  const result = await env.ATRI_DB.prepare(
    `SELECT logs.id,
            logs.user_id as userId,
            logs.date,
            logs.role,
            logs.content,
            logs.attachments,
            logs.reply_to as replyTo,
            logs.timestamp,
            logs.user_name as userName,
            logs.time_zone as timeZone
       FROM conversation_logs logs
       LEFT JOIN conversation_log_tombstones tombstones
         ON logs.user_id = tombstones.user_id AND logs.id = tombstones.log_id
      WHERE logs.user_id = ? AND logs.date = ? AND tombstones.log_id IS NULL
      ORDER BY logs.timestamp ASC`
  )
    .bind(userId, date)
  .all<ConversationLogRecord>();

  return (result.results || []).map((row) => ({
    ...row,
    attachments: parseJson(row.attachments),
  }));
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
  const roles = Array.isArray(params.roles) ? params.roles.filter((r) => r === 'user' || r === 'atri') : [];

  let sql = `SELECT logs.id,
                    logs.user_id as userId,
                    logs.date,
                    logs.role,
                    logs.content,
                    logs.attachments,
                    logs.reply_to as replyTo,
                    logs.timestamp,
                    logs.user_name as userName,
                    logs.time_zone as timeZone
               FROM conversation_logs logs
               LEFT JOIN conversation_log_tombstones tombstones
                 ON logs.user_id = tombstones.user_id AND logs.id = tombstones.log_id
              WHERE logs.user_id = ? AND logs.timestamp > ? AND tombstones.log_id IS NULL`;
  const binds: any[] = [userId, after];

  if (roles.length) {
    const placeholders = roles.map(() => '?').join(', ');
    sql += ` AND logs.role IN (${placeholders})`;
    binds.push(...roles);
  }

  sql += ` ORDER BY logs.timestamp ASC LIMIT ?`;
  binds.push(limit);

  const result = await env.ATRI_DB.prepare(sql)
    .bind(...binds)
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

export async function getConversationLogTimestamp(env: Env, userId: string, logId: string): Promise<number | null> {
  const trimmedUserId = String(userId || '').trim();
  const trimmedLogId = String(logId || '').trim();
  if (!trimmedUserId || !trimmedLogId) {
    return null;
  }

  const row = await env.ATRI_DB.prepare(
    `SELECT timestamp
       FROM conversation_logs
      WHERE user_id = ? AND id = ?
      LIMIT 1`
  )
    .bind(trimmedUserId, trimmedLogId)
    .first<{ timestamp?: number }>();

  const ts = Number(row?.timestamp);
  return Number.isFinite(ts) ? ts : null;
}

export async function isConversationLogDeleted(env: Env, userId: string, logId: string): Promise<boolean> {
  await ensureConversationTables(env);

  const trimmedUserId = String(userId || '').trim();
  const trimmedLogId = String(logId || '').trim();
  if (!trimmedUserId || !trimmedLogId) {
    return false;
  }

  const row = await env.ATRI_DB.prepare(
    `SELECT 1 AS ok
       FROM conversation_log_tombstones
      WHERE user_id = ? AND log_id = ?
      LIMIT 1`
  )
    .bind(trimmedUserId, trimmedLogId)
    .first<{ ok?: number }>();

  return Boolean(row?.ok);
}

export async function markConversationLogsDeleted(env: Env, userId: string, ids: string[]) {
  await ensureConversationTables(env);

  const trimmedUserId = String(userId || '').trim();
  const trimmedIds = Array.isArray(ids) ? ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (!trimmedUserId || trimmedIds.length === 0) return 0;

  const deletedAt = Date.now();
  const sql = `INSERT INTO conversation_log_tombstones (user_id, log_id, deleted_at)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id, log_id) DO UPDATE SET
                 deleted_at = CASE
                   WHEN excluded.deleted_at > conversation_log_tombstones.deleted_at THEN excluded.deleted_at
                   ELSE conversation_log_tombstones.deleted_at
                 END`;

  const chunkSize = 200;
  for (let i = 0; i < trimmedIds.length; i += chunkSize) {
    const batch = trimmedIds.slice(i, i + chunkSize);
    await env.ATRI_DB.batch(
      batch.map((logId) => env.ATRI_DB.prepare(sql).bind(trimmedUserId, logId, deletedAt))
    );
  }

  return trimmedIds.length;
}

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

  const result = await env.ATRI_DB.prepare(
    `SELECT log_id as logId, deleted_at as deletedAt
       FROM conversation_log_tombstones
      WHERE user_id = ? AND deleted_at > ?
      ORDER BY deleted_at ASC
      LIMIT ?`
  )
    .bind(userId, after, limit)
    .all<{ logId: string; deletedAt: number }>();

  return (result.results || []).map((row) => ({
    logId: String(row?.logId || '').trim(),
    deletedAt: Number(row?.deletedAt || 0)
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

export async function markDiaryPending(env: Env, userId: string, date: string) {
  const now = Date.now();
  const id = `diary:${userId}:${date}`;
  await env.ATRI_DB.prepare(
    `INSERT INTO diary_entries (id, user_id, date, summary, content, mood, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = 'pending',
       updated_at = excluded.updated_at`
  )
    .bind(id, userId, date, '', '', null, now, now)
    .run();
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

export async function deleteUserSettingsByUser(env: Env, userId: string) {
  const result = await env.ATRI_DB.prepare(
    `DELETE FROM user_settings WHERE user_id = ?`
  )
    .bind(userId)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

export async function getUserState(env: Env, userId: string): Promise<UserStateRecord> {
  await ensureUserStateColumns(env);
  const row = await env.ATRI_DB.prepare(
    `SELECT user_id as userId,
            status_label as statusLabel,
            status_pill_color as statusPillColor,
            status_text_color as statusTextColor,
            status_reason as statusReason,
            status_updated_at as statusUpdatedAt,
            intimacy,
            last_interaction_at as lastInteractionAt,
            updated_at as updatedAt
     FROM user_states
     WHERE user_id = ?`
  )
    .bind(userId)
    .first<{
      userId?: string;
      statusLabel?: string;
      statusPillColor?: string;
      statusTextColor?: string;
      statusReason?: string | null;
      statusUpdatedAt?: number;
      intimacy?: number;
      lastInteractionAt?: number;
      updatedAt?: number;
    }>();

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
  const rawIntimacy = Number.isFinite(row.intimacy) ? Number(row.intimacy) : 0;
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
  await ensureUserStateColumns(env);
  const payload = normalizeUserState(state);
  await env.ATRI_DB.prepare(
    `INSERT INTO user_states
      (user_id, status_label, status_pill_color, status_text_color, status_reason, status_updated_at, intimacy, last_interaction_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       status_label = excluded.status_label,
       status_pill_color = excluded.status_pill_color,
       status_text_color = excluded.status_text_color,
       status_reason = excluded.status_reason,
       status_updated_at = excluded.status_updated_at,
       intimacy = excluded.intimacy,
       last_interaction_at = excluded.last_interaction_at,
       updated_at = excluded.updated_at`
  )
    .bind(
      payload.userId,
      payload.statusLabel,
      payload.statusPillColor,
      payload.statusTextColor,
      payload.statusReason,
      payload.statusUpdatedAt,
      payload.intimacy,
      payload.lastInteractionAt,
      payload.updatedAt
    )
    .run();
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

export async function listProactiveCandidateUsers(env: Env, params?: {
  lookbackHours?: number;
  limit?: number;
}): Promise<ProactiveCandidateUser[]> {
  await ensureProactiveTables(env);

  const lookbackHoursRaw = typeof params?.lookbackHours === 'number' ? params.lookbackHours : 24 * 30;
  const lookbackHours = Math.min(Math.max(Math.trunc(lookbackHoursRaw), 1), 24 * 365);
  const limitRaw = typeof params?.limit === 'number' ? params.limit : 300;
  const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), 2000);
  const afterTs = Date.now() - lookbackHours * 3600000;

  const result = await env.ATRI_DB.prepare(
    `SELECT states.user_id as userId,
            states.last_interaction_at as lastInteractionAt,
            MAX(logs.user_name) as userName,
            MAX(logs.time_zone) as timeZone
       FROM user_states states
       LEFT JOIN conversation_logs logs
         ON logs.user_id = states.user_id
      WHERE states.last_interaction_at >= ?
      GROUP BY states.user_id, states.last_interaction_at
      ORDER BY states.last_interaction_at DESC
      LIMIT ?`
  )
    .bind(afterTs, limit)
    .all<{
      userId: string;
      lastInteractionAt: number;
      userName?: string;
      timeZone?: string;
    }>();

  return (result.results || [])
    .map((row) => ({
      userId: String(row?.userId || '').trim(),
      lastInteractionAt: Number(row?.lastInteractionAt || 0),
      userName: typeof row?.userName === 'string' ? row.userName : undefined,
      timeZone: typeof row?.timeZone === 'string' ? row.timeZone : undefined
    }))
    .filter((row) => Boolean(row.userId) && Number.isFinite(row.lastInteractionAt));
}

export async function getProactiveUserState(env: Env, userId: string): Promise<ProactiveUserStateRecord> {
  await ensureProactiveTables(env);
  const trimmed = String(userId || '').trim();
  const now = Date.now();
  if (!trimmed) {
    return {
      userId: '',
      lastProactiveAt: 0,
      dailyCount: 0,
      dailyCountDate: null,
      updatedAt: now
    };
  }

  const row = await env.ATRI_DB.prepare(
    `SELECT user_id as userId,
            last_proactive_at as lastProactiveAt,
            daily_count as dailyCount,
            daily_count_date as dailyCountDate,
            updated_at as updatedAt
       FROM proactive_user_state
      WHERE user_id = ?
      LIMIT 1`
  )
    .bind(trimmed)
    .first<{
      userId?: string;
      lastProactiveAt?: number;
      dailyCount?: number;
      dailyCountDate?: string | null;
      updatedAt?: number;
    }>();

  if (!row) {
    return {
      userId: trimmed,
      lastProactiveAt: 0,
      dailyCount: 0,
      dailyCountDate: null,
      updatedAt: now
    };
  }
  return {
    userId: String(row.userId || trimmed),
    lastProactiveAt: Number.isFinite(row.lastProactiveAt) ? Number(row.lastProactiveAt) : 0,
    dailyCount: Number.isFinite(row.dailyCount) ? Math.max(0, Math.trunc(Number(row.dailyCount))) : 0,
    dailyCountDate: typeof row.dailyCountDate === 'string' ? row.dailyCountDate : null,
    updatedAt: Number.isFinite(row.updatedAt) ? Number(row.updatedAt) : now
  };
}

export async function saveProactiveUserState(env: Env, state: ProactiveUserStateRecord) {
  await ensureProactiveTables(env);
  const payload: ProactiveUserStateRecord = {
    userId: String(state.userId || '').trim(),
    lastProactiveAt: Number.isFinite(Number(state.lastProactiveAt)) ? Number(state.lastProactiveAt) : 0,
    dailyCount: Number.isFinite(Number(state.dailyCount)) ? Math.max(0, Math.trunc(Number(state.dailyCount))) : 0,
    dailyCountDate: typeof state.dailyCountDate === 'string' ? state.dailyCountDate : null,
    updatedAt: Number.isFinite(Number(state.updatedAt)) ? Number(state.updatedAt) : Date.now()
  };
  if (!payload.userId) return;

  await env.ATRI_DB.prepare(
    `INSERT INTO proactive_user_state (user_id, last_proactive_at, daily_count, daily_count_date, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       last_proactive_at = excluded.last_proactive_at,
       daily_count = excluded.daily_count,
       daily_count_date = excluded.daily_count_date,
       updated_at = excluded.updated_at`
  )
    .bind(
      payload.userId,
      payload.lastProactiveAt,
      payload.dailyCount,
      payload.dailyCountDate,
      payload.updatedAt
    )
    .run();
}

export async function saveProactiveMessage(env: Env, params: {
  id?: string;
  userId: string;
  content: string;
  triggerContext?: string | null;
  status?: ProactiveMessageStatus;
  notificationChannel?: 'email' | 'wechat_work' | 'none' | null;
  notificationSent?: boolean;
  notificationError?: string | null;
  createdAt?: number;
  deliveredAt?: number | null;
  expiresAt?: number;
}) {
  await ensureProactiveTables(env);
  const userId = String(params.userId || '').trim();
  const content = String(params.content || '').trim();
  if (!userId || !content) {
    throw new Error('invalid_proactive_message');
  }

  const now = Date.now();
  const createdAt = Number.isFinite(Number(params.createdAt)) ? Number(params.createdAt) : now;
  const expiresAt = Number.isFinite(Number(params.expiresAt))
    ? Number(params.expiresAt)
    : createdAt + 3 * 24 * 3600000;
  const deliveredAt = params.deliveredAt == null
    ? null
    : Number.isFinite(Number(params.deliveredAt))
      ? Number(params.deliveredAt)
      : null;
  const status: ProactiveMessageStatus = params.status === 'delivered' || params.status === 'expired'
    ? params.status
    : 'pending';
  const notificationChannel =
    params.notificationChannel === 'email' || params.notificationChannel === 'wechat_work' || params.notificationChannel === 'none'
      ? params.notificationChannel
      : null;
  const notificationSent = params.notificationSent === true;
  const notificationError = params.notificationError == null ? null : String(params.notificationError);
  const id = String(params.id || '').trim() || crypto.randomUUID();

  await env.ATRI_DB.prepare(
    `INSERT INTO proactive_messages
      (id, user_id, content, trigger_context, status, notification_channel, notification_sent, notification_error, created_at, delivered_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       content = excluded.content,
       trigger_context = excluded.trigger_context,
       status = excluded.status,
       notification_channel = excluded.notification_channel,
       notification_sent = excluded.notification_sent,
       notification_error = excluded.notification_error,
       created_at = excluded.created_at,
       delivered_at = excluded.delivered_at,
       expires_at = excluded.expires_at`
  )
    .bind(
      id,
      userId,
      content,
      params.triggerContext == null ? null : String(params.triggerContext),
      status,
      notificationChannel,
      notificationSent ? 1 : 0,
      notificationError,
      createdAt,
      deliveredAt,
      expiresAt
    )
    .run();

  return { id, userId, status, notificationChannel, notificationSent, createdAt, expiresAt };
}

export async function fetchPendingProactiveMessages(env: Env, params: {
  userId: string;
  limit?: number;
  now?: number;
}): Promise<ProactiveMessageRecord[]> {
  await ensureProactiveTables(env);
  const userId = String(params.userId || '').trim();
  if (!userId) return [];

  const now = Number.isFinite(Number(params.now)) ? Number(params.now) : Date.now();
  const limitRaw = typeof params.limit === 'number' ? params.limit : 20;
  const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), 100);

  await env.ATRI_DB.prepare(
    `UPDATE proactive_messages
        SET status = 'expired'
      WHERE user_id = ? AND status = 'pending' AND expires_at <= ?`
  )
    .bind(userId, now)
    .run();

  const result = await env.ATRI_DB.prepare(
    `SELECT id,
            user_id as userId,
            content,
            trigger_context as triggerContext,
            status,
            notification_channel as notificationChannel,
            notification_sent as notificationSent,
            notification_error as notificationError,
            created_at as createdAt,
            delivered_at as deliveredAt,
            expires_at as expiresAt
       FROM proactive_messages
      WHERE user_id = ? AND status = 'pending' AND expires_at > ?
      ORDER BY created_at ASC
      LIMIT ?`
  )
    .bind(userId, now, limit)
    .all<ProactiveMessageRecord>();

  return (result.results || []).map((row) => ({
    id: String(row.id || ''),
    userId: String(row.userId || ''),
    content: String(row.content || ''),
    triggerContext: row.triggerContext == null ? null : String(row.triggerContext),
    status: row.status as ProactiveMessageStatus,
    notificationChannel:
      row.notificationChannel === 'email' || row.notificationChannel === 'wechat_work' || row.notificationChannel === 'none'
        ? row.notificationChannel
        : null,
    notificationSent: Boolean(Number((row as any).notificationSent ?? 0)),
    notificationError: row.notificationError == null ? null : String(row.notificationError),
    createdAt: Number(row.createdAt || 0),
    deliveredAt: row.deliveredAt == null ? null : Number(row.deliveredAt),
    expiresAt: Number(row.expiresAt || 0)
  }));
}

export async function markProactiveMessagesDelivered(env: Env, params: {
  userId: string;
  ids: string[];
  deliveredAt?: number;
}) {
  await ensureProactiveTables(env);
  const userId = String(params.userId || '').trim();
  const ids = Array.isArray(params.ids) ? params.ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (!userId || !ids.length) return 0;

  const deliveredAt = Number.isFinite(Number(params.deliveredAt)) ? Number(params.deliveredAt) : Date.now();
  let changed = 0;
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    const placeholders = batch.map(() => '?').join(', ');
    const result = await env.ATRI_DB.prepare(
      `UPDATE proactive_messages
          SET status = 'delivered',
              delivered_at = ?
        WHERE user_id = ?
          AND status = 'pending'
          AND id IN (${placeholders})`
    )
      .bind(deliveredAt, userId, ...batch)
      .run();
    changed += Number(result?.meta?.changes ?? 0);
  }
  return changed;
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
  await ensureProactiveTables(env);
  const result = await env.ATRI_DB.prepare(`DELETE FROM conversation_logs WHERE user_id = ?`)
    .bind(userId)
    .run();

  await env.ATRI_DB.prepare(`DELETE FROM conversation_log_tombstones WHERE user_id = ?`).bind(userId).run();
  await env.ATRI_DB.prepare(`DELETE FROM proactive_messages WHERE user_id = ?`).bind(userId).run();
  await env.ATRI_DB.prepare(`DELETE FROM proactive_user_state WHERE user_id = ?`).bind(userId).run();
  return Number(result?.meta?.changes ?? 0);
}

export async function deleteConversationLogsByIds(env: Env, userId: string, ids: string[]) {
  const trimmedUserId = String(userId || '').trim();
  const trimmedIds = Array.isArray(ids) ? ids.map((item) => String(item || '').trim()).filter(Boolean) : [];
  if (!trimmedUserId || trimmedIds.length === 0) {
    return 0;
  }

  const replyChildIds = await listConversationReplyIds(env, trimmedUserId, trimmedIds);
  const deleteIds = Array.from(new Set([...trimmedIds, ...replyChildIds]));
  await markConversationLogsDeleted(env, trimmedUserId, deleteIds);

  const chunkSize = 200;
  let deleted = 0;
  for (let i = 0; i < deleteIds.length; i += chunkSize) {
    const batch = deleteIds.slice(i, i + chunkSize);
    const placeholders = batch.map(() => '?').join(', ');
    const statement = `DELETE FROM conversation_logs WHERE user_id = ? AND id IN (${placeholders})`;
    const result = await env.ATRI_DB.prepare(statement)
      .bind(trimmedUserId, ...batch)
      .run();
    deleted += Number(result?.meta?.changes ?? 0);
  }

  return deleted;
}

export async function listConversationReplyIds(env: Env, userId: string, replyToIds: string[]) {
  const trimmedUserId = String(userId || '').trim();
  const ids = Array.isArray(replyToIds) ? replyToIds.map((v) => String(v || '').trim()).filter(Boolean) : [];
  if (!trimmedUserId || !ids.length) return [] as string[];

  const out: string[] = [];
  const chunkSize = 150;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    const placeholders = batch.map(() => '?').join(', ');
    const result = await env.ATRI_DB.prepare(
      `SELECT id
         FROM conversation_logs
        WHERE user_id = ?
          AND reply_to IN (${placeholders})`
    )
      .bind(trimmedUserId, ...batch)
      .all<{ id: string }>();
    for (const row of result.results || []) {
      const id = String(row?.id || '').trim();
      if (id) out.push(id);
    }
  }
  return Array.from(new Set(out));
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
