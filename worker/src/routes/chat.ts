import type { Router } from 'itty-router';
import { Env, CHAT_MODEL, AttachmentPayload } from '../types';
import { jsonResponse } from '../utils/json-response';
import { normalizeAttachmentList } from '../utils/attachments';
import { sanitizeText } from '../utils/sanitize';
import { runAgentChat } from '../services/agent-service';
import { saveUserModelPreference } from '../services/data-service';
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
  stream?: boolean;
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
    stream: body.stream === true
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
        logId: parsed.logId,
        stream: parsed.stream
      });

      // 如果是流式响应，直接返回 Response
      if (result instanceof Response) {
        return result;
      }
      return jsonResponse(result);
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
