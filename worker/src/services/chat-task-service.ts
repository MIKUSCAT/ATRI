import type { AttachmentPayload, Env } from '../types';
import { sanitizeAssistantReply, sanitizeText } from '../utils/sanitize';
import { applySideEffects, runAgentChat } from './agent-service';
import {
  fetchLatestAtriReplyToLog,
  getUserState,
  isConversationLogDeleted,
  saveConversationLog
} from './data-service';

export type ChatTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ChatTaskRequest = {
  userId: string;
  platform: string;
  userName?: string;
  clientTimeIso?: string;
  messageText: string;
  attachments: AttachmentPayload[];
  inlineImage?: string;
  model: string;
  logId: string;
  replyTo: string;
  timeZone?: string;
  anchorTimestamp?: number | null;
};

export type ChatTaskResultPayload = {
  reply: string;
  status: { label: string; pillColor: string; textColor: string; reason?: string };
  action: null;
  replyLogId: string;
  replyTimestamp: number;
  replyTo: string;
};

export type ChatTaskRecord = {
  taskId: string;
  userId: string;
  logId: string;
  status: ChatTaskStatus;
  request: ChatTaskRequest;
  result: ChatTaskResultPayload | null;
  error: string | null;
  attempts: number;
  replyLogId: string;
  replyTimestamp: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type ChatQueueMessage = { taskId: string };

let chatTaskTablesEnsured = false;
let ensuringChatTaskTables: Promise<void> | null = null;

export async function ensureChatTaskTables(env: Env) {
  if (chatTaskTablesEnsured) return;
  if (ensuringChatTaskTables) return ensuringChatTaskTables;

  ensuringChatTaskTables = (async () => {
    await env.ATRI_DB.prepare(
      `CREATE TABLE IF NOT EXISTS chat_tasks (
        task_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        log_id TEXT NOT NULL,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        reply_log_id TEXT NOT NULL,
        reply_timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      )`
    ).run();
    await env.ATRI_DB.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_tasks_user_log
        ON chat_tasks(user_id, log_id)`
    ).run();
    await env.ATRI_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_chat_tasks_status_updated
        ON chat_tasks(status, updated_at)`
    ).run();
    chatTaskTablesEnsured = true;
  })().finally(() => {
    ensuringChatTaskTables = null;
  });

  return ensuringChatTaskTables;
}

export async function deleteChatTaskForLog(env: Env, userId: string, logId: string) {
  await ensureChatTaskTables(env);
  const trimmedUserId = String(userId || '').trim();
  const trimmedLogId = String(logId || '').trim();
  if (!trimmedUserId || !trimmedLogId) return 0;
  const result = await env.ATRI_DB.prepare(
    `DELETE FROM chat_tasks
      WHERE user_id = ? AND log_id = ?`
  )
    .bind(trimmedUserId, trimmedLogId)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

export async function createOrGetChatTask(env: Env, request: ChatTaskRequest): Promise<{ task: ChatTaskRecord; created: boolean }> {
  await ensureChatTaskTables(env);

  const userId = String(request.userId || '').trim();
  const logId = String(request.logId || '').trim();
  if (!userId || !logId) throw new Error('chat_task_missing_user_or_log');

  const now = Date.now();
  const replyLogId = crypto.randomUUID();
  const replyTimestamp = typeof request.anchorTimestamp === 'number'
    ? Math.max(now, request.anchorTimestamp + 1)
    : now;
  const taskId = crypto.randomUUID();

  const result = await env.ATRI_DB.prepare(
    `INSERT OR IGNORE INTO chat_tasks
        (task_id, user_id, log_id, status, request_json, result_json, error, attempts,
         reply_log_id, reply_timestamp, created_at, updated_at, started_at, completed_at)
     VALUES (?, ?, ?, 'queued', ?, NULL, NULL, 0, ?, ?, ?, ?, NULL, NULL)`
  )
    .bind(
      taskId,
      userId,
      logId,
      JSON.stringify({ ...request, userId, logId }),
      replyLogId,
      replyTimestamp,
      now,
      now
    )
    .run();

  const created = Number(result?.meta?.changes ?? 0) > 0;
  const task = await getChatTaskByUserLog(env, userId, logId);
  if (!task) throw new Error('chat_task_create_failed');
  return { task, created };
}

export async function getChatTaskById(env: Env, taskId: string): Promise<ChatTaskRecord | null> {
  await ensureChatTaskTables(env);
  const id = String(taskId || '').trim();
  if (!id) return null;
  const row = await env.ATRI_DB.prepare(
    `SELECT task_id, user_id, log_id, status, request_json, result_json, error, attempts,
            reply_log_id, reply_timestamp, created_at, updated_at, started_at, completed_at
       FROM chat_tasks
      WHERE task_id = ?
      LIMIT 1`
  )
    .bind(id)
    .first<any>();
  return row ? normalizeChatTaskRow(row) : null;
}

async function getChatTaskByUserLog(env: Env, userId: string, logId: string): Promise<ChatTaskRecord | null> {
  const row = await env.ATRI_DB.prepare(
    `SELECT task_id, user_id, log_id, status, request_json, result_json, error, attempts,
            reply_log_id, reply_timestamp, created_at, updated_at, started_at, completed_at
       FROM chat_tasks
      WHERE user_id = ? AND log_id = ?
      LIMIT 1`
  )
    .bind(userId, logId)
    .first<any>();
  return row ? normalizeChatTaskRow(row) : null;
}

async function claimChatTask(env: Env, taskId: string): Promise<ChatTaskRecord | null> {
  await ensureChatTaskTables(env);
  const now = Date.now();
  const staleBefore = now - 15 * 60 * 1000;
  const result = await env.ATRI_DB.prepare(
    `UPDATE chat_tasks
        SET status = 'running',
            attempts = attempts + 1,
            started_at = COALESCE(started_at, ?),
            updated_at = ?
      WHERE task_id = ?
        AND (status = 'queued' OR (status = 'running' AND updated_at < ?))`
  )
    .bind(now, now, taskId, staleBefore)
    .run();

  if (Number(result?.meta?.changes ?? 0) <= 0) return null;
  return getChatTaskById(env, taskId);
}

async function completeChatTask(env: Env, taskId: string, payload: ChatTaskResultPayload) {
  const now = Date.now();
  await env.ATRI_DB.prepare(
    `UPDATE chat_tasks
        SET status = 'completed',
            result_json = ?,
            error = NULL,
            updated_at = ?,
            completed_at = ?
      WHERE task_id = ?`
  )
    .bind(JSON.stringify(payload), now, now, taskId)
    .run();
}

async function failChatTask(env: Env, taskId: string, error: string) {
  const now = Date.now();
  await env.ATRI_DB.prepare(
    `UPDATE chat_tasks
        SET status = 'failed',
            error = ?,
            updated_at = ?,
            completed_at = ?
      WHERE task_id = ? AND status <> 'completed'`
  )
    .bind(error.slice(0, 2000), now, now, taskId)
    .run();
}

export async function processChatTaskQueueBatch(batch: MessageBatch<ChatQueueMessage>, env: Env) {
  for (const message of batch.messages) {
    const taskId = String(message.body?.taskId || '').trim();
    try {
      if (taskId) await processChatTask(env, taskId);
      message.ack();
    } catch (e) {
      console.error('[ATRI] chat_task_queue_failed', { taskId, e });
      message.retry({ delaySeconds: 10 });
    }
  }
}

export async function processChatTask(env: Env, taskId: string) {
  const task = await claimChatTask(env, taskId);
  if (!task) return;

  try {
    const request = task.request;
    const existing = await fetchExistingReplyPayload(env, task);
    if (existing) {
      await completeChatTask(env, task.taskId, existing);
      return;
    }

    const result = await runAgentChat(env, {
      userId: request.userId,
      platform: request.platform,
      userName: request.userName,
      clientTimeIso: request.clientTimeIso,
      messageText: request.messageText,
      attachments: request.attachments || [],
      inlineImage: request.inlineImage,
      model: request.model,
      logId: request.logId,
      anchorTimestamp: request.anchorTimestamp
    });

    const replyText = sanitizeAssistantReply(result.reply).trim();
    if (!replyText) throw new Error('empty_agent_reply');

    const deleted = await isConversationLogDeleted(env, request.userId, request.replyTo);
    if (deleted) {
      await failChatTask(env, task.taskId, 'message_deleted');
      return;
    }

    const payload: ChatTaskResultPayload = {
      reply: replyText,
      status: result.status,
      action: null,
      replyLogId: task.replyLogId,
      replyTimestamp: task.replyTimestamp,
      replyTo: request.replyTo
    };

    await saveConversationLog(env, {
      id: task.replyLogId,
      userId: request.userId,
      role: 'atri',
      content: replyText,
      attachments: [],
      replyTo: request.replyTo,
      timestamp: task.replyTimestamp,
      userName: request.userName,
      timeZone: request.timeZone
    });
    await completeChatTask(env, task.taskId, payload);

    try {
      await applySideEffects(env, result.sideEffects);
    } catch (e) {
      console.warn('[ATRI] chat_task_side_effects_failed', { taskId: task.taskId, userId: request.userId, e });
    }
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[ATRI] chat_task_failed', { taskId: task.taskId, userId: task.userId, message: msg });
    await failChatTask(env, task.taskId, msg || 'chat_task_failed');
  }
}

async function fetchExistingReplyPayload(env: Env, task: ChatTaskRecord): Promise<ChatTaskResultPayload | null> {
  const request = task.request;
  const existing = await fetchLatestAtriReplyToLog(env, request.userId, request.replyTo);
  const existingText = sanitizeText(String(existing?.content || '')).trim();
  if (!existing || !existingText) return null;

  const state = await getUserState(env, request.userId);
  return {
    reply: existingText,
    status: {
      label: state.statusLabel,
      pillColor: state.statusPillColor,
      textColor: state.statusTextColor,
      reason: state.statusReason ?? undefined
    },
    action: null,
    replyLogId: existing.id,
    replyTimestamp: existing.timestamp,
    replyTo: request.replyTo
  };
}

function normalizeChatTaskRow(row: any): ChatTaskRecord {
  const request = safeJsonParse(row.request_json) || {};
  const result = safeJsonParse(row.result_json);
  return {
    taskId: String(row.task_id || ''),
    userId: String(row.user_id || ''),
    logId: String(row.log_id || ''),
    status: normalizeTaskStatus(row.status),
    request,
    result: result && typeof result === 'object' ? result as ChatTaskResultPayload : null,
    error: typeof row.error === 'string' && row.error ? row.error : null,
    attempts: Number(row.attempts || 0),
    replyLogId: String(row.reply_log_id || ''),
    replyTimestamp: Number(row.reply_timestamp || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at)
  };
}

function normalizeTaskStatus(value: unknown): ChatTaskStatus {
  const text = String(value || '').trim();
  if (text === 'running' || text === 'completed' || text === 'failed') return text;
  return 'queued';
}

function safeJsonParse(text: unknown): any {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
