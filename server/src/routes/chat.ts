import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { AttachmentPayload, CHAT_MODEL, Env } from '../runtime/types';
import { normalizeAttachmentList } from '../utils/attachments';
import { sanitizeText } from '../utils/sanitize';
import { requireAppToken } from '../utils/auth';
import { sendJson } from '../utils/reply';
import { runAgentChat } from '../services/agent-service';
import { deleteConversationLogsByIds, isConversationLogDeleted, saveConversationLog, saveUserModelPreference } from '../services/data-service';
import { getEffectiveRuntimeSettings } from '../services/runtime-settings';

interface ChatRequestBody {
  userId: string;
  content: string;
  logId?: string;
  platform?: string;
  userName?: string;
  clientTimeIso?: string;
  modelKey?: string;
  imageUrl?: string;
  attachments?: AttachmentPayload[];
  timeZone?: string;
}

function getString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  return undefined;
}

function getAnyString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string') {
      return val;
    }
  }
  return undefined;
}

function parseChatRequest(body: Record<string, unknown>): ChatRequestBody | null {
  const userId = getString(body, ['userId', 'user_id']);
  const content = getAnyString(body, ['content', 'message']);

  if (!userId) return null;

  const imageUrl = getString(body, ['imageUrl']);
  const attachments = Array.isArray((body as any).attachments)
    ? normalizeAttachmentList((body as any).attachments)
    : undefined;
  const hasImage = Boolean(imageUrl) || (attachments || []).some(att => att.type === 'image');
  const cleanedContent = (content || '').trim();

  if (!cleanedContent && !hasImage) return null;

  return {
    userId,
    content: cleanedContent,
    logId: getString(body, ['logId', 'log_id', 'messageId', 'message_id']),
    platform: getString(body, ['platform', 'client']) || 'android',
    userName: getString(body, ['userName', 'user_name']),
    clientTimeIso: getString(body, ['clientTimeIso', 'client_time']),
    modelKey: getString(body, ['modelKey', 'model']),
    imageUrl,
    attachments,
    timeZone: getString(body, ['timeZone', 'time_zone'])
  };
}

export function registerChatRoutes(app: FastifyInstance, env: Env) {
  app.post('/api/v1/chat', async (request, reply) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return sendJson(reply, auth.body, auth.status);

      const body = (request.body || {}) as Record<string, unknown>;
      const parsed = parseChatRequest(body);
      if (!parsed) {
        return sendJson(reply, { error: 'invalid_request', message: 'userId and content are required' }, 400);
      }

      const messageText = sanitizeText(parsed.content || '');
      const hasImage = Boolean(parsed.imageUrl) || (parsed.attachments || []).some(att => att.type === 'image');
      if (!messageText && !hasImage) {
        return sendJson(reply, { error: 'invalid_request', message: 'content cannot be empty' }, 400);
      }

      if (parsed.modelKey) {
        try {
          await saveUserModelPreference(env, parsed.userId, parsed.modelKey);
        } catch (err) {
          request.log.warn({ err, userId: parsed.userId }, '[ATRI] save user model preference failed');
        }
      }

      const settings = await getEffectiveRuntimeSettings(env);
      const modelToUse = parsed.modelKey?.trim() ? parsed.modelKey.trim() : settings.defaultChatModel || CHAT_MODEL;

      const replyTo = typeof parsed.logId === 'string' && parsed.logId.trim() ? parsed.logId.trim() : undefined;
      let anchorTimestamp: number | null = null;

      if (replyTo) {
        try {
          await isConversationLogDeleted(env, parsed.userId, replyTo);

          const tsResult = await env.db.query(
            `SELECT timestamp
               FROM conversation_logs
              WHERE user_id = $1 AND id = $2
              LIMIT 1`,
            [parsed.userId, replyTo]
          );
          const tsRaw = tsResult.rows?.[0]?.timestamp;
          const tsNum = typeof tsRaw === 'number' ? tsRaw : Number(tsRaw);
          anchorTimestamp = Number.isFinite(tsNum) ? tsNum : null;

          const hasReply = await env.db.query(
            `SELECT 1 as ok
               FROM conversation_logs
              WHERE user_id = $1 AND reply_to = $2
              LIMIT 1`,
            [parsed.userId, replyTo]
          );

          if (hasReply.rows?.[0]?.ok) {
            const replyIdsResult = await env.db.query(
              `SELECT id
                 FROM conversation_logs
                WHERE user_id = $1 AND reply_to = $2`,
              [parsed.userId, replyTo]
            );
            const replyIdsToDelete = (replyIdsResult.rows || [])
              .map((row: any) => String(row?.id || '').trim())
              .filter(Boolean);
            if (replyIdsToDelete.length) {
              await deleteConversationLogsByIds(env, parsed.userId, replyIdsToDelete);
            }

            if (typeof anchorTimestamp === 'number') {
              const idsResult = await env.db.query(
                `SELECT id
                   FROM conversation_logs
                  WHERE user_id = $1 AND timestamp > $2`,
                [parsed.userId, anchorTimestamp]
              );
              const idsToDelete = (idsResult.rows || [])
                .map((row: any) => String(row?.id || '').trim())
                .filter(Boolean);
              if (idsToDelete.length) {
                await deleteConversationLogsByIds(env, parsed.userId, idsToDelete);
              }
            }
          }
        } catch (err) {
          request.log.warn({ err, userId: parsed.userId, logId: replyTo }, '[ATRI] prune logs before chat failed');
        }
      }

      const result = await runAgentChat(env, {
        userId: parsed.userId,
        platform: parsed.platform || 'android',
        userName: parsed.userName,
        clientTimeIso: parsed.clientTimeIso,
        messageText,
        attachments: parsed.attachments || [],
        inlineImage: parsed.imageUrl,
        model: modelToUse,
        logId: parsed.logId
      });

      const replyLogId = randomUUID();
      const replyTimestamp =
        typeof anchorTimestamp === 'number' ? Math.max(Date.now(), anchorTimestamp + 1) : Date.now();

      const shouldSkip = replyTo
        ? await isConversationLogDeleted(env, parsed.userId, replyTo)
        : false;

      if (!shouldSkip) {
        try {
          await saveConversationLog(env, {
            id: replyLogId,
            userId: parsed.userId,
            role: 'atri',
            content: result.reply,
            attachments: [],
            replyTo,
            timestamp: replyTimestamp,
            userName: parsed.userName,
            timeZone: parsed.timeZone
          });
        } catch (err) {
          request.log.warn({ err, userId: parsed.userId }, '[ATRI] reply log failed');
        }
      }

      return sendJson(reply, {
        ...result,
        replyLogId,
        replyTimestamp,
        replyTo
      });
    } catch (error: unknown) {
      request.log.error({ error }, '[ATRI] Bio chat error');
      const errMsg = error instanceof Error ? error.message : String(error);
      return sendJson(reply, { error: 'bio_chat_failed', details: errMsg }, 500);
    }
  });
}
