import type { Router } from 'itty-router';
import { Env, CHAT_MODEL, AttachmentPayload } from '../types';
import { jsonResponse } from '../utils/json-response';
import { normalizeAttachmentList } from '../utils/attachments';
import { sanitizeText } from '../utils/sanitize';
import { runAgentChat } from '../services/agent-service';
import { getEffectiveRuntimeSettings } from '../services/runtime-settings';
import {
  deleteConversationLogsByIds,
  getConversationLogTimestamp,
  isConversationLogDeleted,
  listConversationReplyIds,
  saveConversationLog
} from '../services/data-service';
import { requireAppToken } from '../utils/auth';

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

function parseChatRequest(body: Record<string, unknown>): ChatRequestBody | null {
  const userId = getString(body, ['userId', 'user_id']);
  const content = getAnyString(body, ['content', 'message']);

  if (!userId) return null;

  const imageUrl = getString(body, ['imageUrl']);
  const attachments = Array.isArray(body.attachments)
    ? normalizeAttachmentList(body.attachments)
    : undefined;
  const hasImage = Boolean(imageUrl) || (attachments || []).some(att => att.type === 'image');
  const cleanedContent = (content || '').trim();

  // 允许“只发图不发字”，但不允许完全空消息
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

export function registerChatRoutes(router: Router) {
  router.post('/api/v1/chat', async (request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const body = await request.json() as Record<string, unknown>;
      const parsed = parseChatRequest(body);

      if (!parsed) {
        return jsonResponse({ error: 'invalid_request', message: 'userId and content are required' }, 400);
      }

      const messageText = sanitizeText(parsed.content || '');
      const hasImage = Boolean(parsed.imageUrl) || (parsed.attachments || []).some(att => att.type === 'image');
      if (!messageText && !hasImage) {
        return jsonResponse({ error: 'invalid_request', message: 'content cannot be empty' }, 400);
      }

      const settings = await getEffectiveRuntimeSettings(env);
      const modelToUse = settings.defaultChatModel || CHAT_MODEL;

      const replyTo = typeof parsed.logId === 'string' && parsed.logId.trim() ? parsed.logId.trim() : undefined;
      let anchorTimestamp: number | null = null;

      if (replyTo) {
        try {
          await isConversationLogDeleted(env, parsed.userId, replyTo);
          anchorTimestamp = await getConversationLogTimestamp(env, parsed.userId, replyTo);

          const replyIdsToDelete = await listConversationReplyIds(env, parsed.userId, [replyTo]);
          if (replyIdsToDelete.length) {
            await deleteConversationLogsByIds(env, parsed.userId, replyIdsToDelete);
          }

          if (typeof anchorTimestamp === 'number') {
            const staleResult = await env.ATRI_DB.prepare(
              `SELECT id
                 FROM conversation_logs
                WHERE user_id = ?
                  AND timestamp > ?`
            )
              .bind(parsed.userId, anchorTimestamp)
              .all<{ id: string }>();
            const staleIds = (staleResult.results || [])
              .map((row) => String(row?.id || '').trim())
              .filter(Boolean);
            if (staleIds.length) {
              await deleteConversationLogsByIds(env, parsed.userId, staleIds);
            }
          }
        } catch (err) {
          console.warn('[ATRI] prune logs before chat failed', { userId: parsed.userId, logId: replyTo, err });
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

      const replyLogId = crypto.randomUUID();
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
          console.warn('[ATRI] reply log failed', { userId: parsed.userId, err });
        }
      }

      return jsonResponse({
        ...result,
        replyLogId,
        replyTimestamp,
        replyTo
      });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      console.error('[ATRI] Bio chat error', { message: errMsg, stack: errStack, error });
      return jsonResponse({ error: 'bio_chat_failed', details: errMsg }, 500);
    }
  });
}
