import type { Router } from 'itty-router';
import { Env, CHAT_MODEL, AttachmentPayload } from '../types';
import { jsonResponse } from '../utils/json-response';
import { normalizeAttachmentList } from '../utils/attachments';
import { sanitizeText } from '../utils/sanitize';
import { runAgentChat } from '../services/agent-service';
import { saveConversationLog, saveUserModelPreference, isConversationLogDeleted } from '../services/data-service';
import { requireAppToken } from '../utils/auth';
import { notifyChatWaiters } from '../services/chat-socket';

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
  router.get('/api/v1/chat/ws', async (request: Request, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return jsonResponse({ error: 'websocket_required' }, 426);
    }

    const { searchParams } = new URL(request.url);
    const userId = (searchParams.get('userId') || '').trim();
    if (!userId) {
      return jsonResponse({ error: 'missing_user' }, 400);
    }
    if (!env.CHAT_SOCKET) {
      return jsonResponse({ error: 'socket_unavailable' }, 503);
    }

    const stub = env.CHAT_SOCKET.get(env.CHAT_SOCKET.idFromName(userId));
    return stub.fetch(request);
  });

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

      // 记录用户当前使用的对话模型，供 Cron 的日记/档案/自查任务复用
      if (parsed.modelKey) {
        try {
          await saveUserModelPreference(env, parsed.userId, parsed.modelKey);
        } catch (err) {
          console.warn('[ATRI] save user model preference failed', { userId: parsed.userId, err });
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
        model: resolveModelKey(parsed.modelKey),
        logId: parsed.logId
      });
      const replyTo = typeof parsed.logId === 'string' ? parsed.logId : undefined;
      const replyLogId = crypto.randomUUID();
      const replyTimestamp = Date.now();
      const moodPayload = result.mood ? JSON.stringify(result.mood) : undefined;

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
            mood: moodPayload,
            replyTo,
            timestamp: replyTimestamp,
            userName: parsed.userName,
            timeZone: parsed.timeZone
          });
          await notifyChatWaiters(env, {
            userId: parsed.userId,
            reply: result.reply,
            mood: result.mood,
            action: result.action,
            intimacy: result.intimacy,
            replyLogId,
            replyTimestamp,
            replyTo
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

function resolveModelKey(modelKey?: string | null): string {
  if (typeof modelKey === 'string' && modelKey.trim().length > 0) {
    return modelKey.trim();
  }
  return CHAT_MODEL;
}
