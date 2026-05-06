import type { RouterType } from 'itty-router';
import { AttachmentPayload, CHAT_MODEL, Env } from '../types';
import { requireAppToken } from '../utils/auth';
import { normalizeAttachmentList } from '../utils/attachments';
import { jsonResponse } from '../utils/json-response';
import { sanitizeText } from '../utils/sanitize';
import {
  deleteConversationLogsByIds,
  fetchLatestAtriReplyToLog,
  getConversationLogTimestamp,
  getUserState,
  isConversationLogDeleted,
  listConversationReplyIds,
  markProactiveMessagesDelivered,
  saveConversationLog
} from '../services/data-service';
import { applySideEffects, runAgentChat } from '../services/agent-service';
import { getEffectiveRuntimeSettings } from '../services/runtime-settings';

interface ChatRequestBody {
  userId: string;
  content: string;
  logId?: string;
  platform?: string;
  userName?: string;
  clientTimeIso?: string;
  forceRegenerate?: boolean;
  imageUrl?: string;
  attachments?: AttachmentPayload[];
  timeZone?: string;
}

function parseChatRequest(body: Record<string, unknown>): ChatRequestBody | null {
  const userId = getString(body, ['userId', 'user_id']);
  const content = getAnyString(body, ['content', 'message']);
  if (!userId) return null;

  const imageUrl = getString(body, ['imageUrl']);
  const attachments = Array.isArray(body.attachments) ? normalizeAttachmentList(body.attachments) : undefined;
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
    forceRegenerate: getBoolean(body, ['forceRegenerate', 'force_regenerate']),
    imageUrl,
    attachments,
    timeZone: getString(body, ['timeZone', 'time_zone'])
  };
}

function getString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return undefined;
}

function getAnyString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string') return val;
  }
  return undefined;
}

function getBoolean(obj: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const text = val.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
      if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
    }
  }
  return false;
}

export function registerChatRoutes(router: RouterType) {
  router.post('/api/v1/chat', async (request, env: Env, ctx: ExecutionContext) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const body = await request.json() as Record<string, unknown>;
      const parsed = parseChatRequest(body);
      if (!parsed) return jsonResponse({ error: 'invalid_request' }, 400);

      const messageText = sanitizeText(parsed.content || '');
      const hasImage = Boolean(parsed.imageUrl) || (parsed.attachments || []).some(att => att.type === 'image');
      if (!messageText && !hasImage) return jsonResponse({ error: 'invalid_request' }, 400);

      const settings = await getEffectiveRuntimeSettings(env);
      const modelToUse = settings.defaultChatModel || CHAT_MODEL;
      const replyTo = typeof parsed.logId === 'string' && parsed.logId.trim() ? parsed.logId.trim() : undefined;
      let anchorTimestamp: number | null = null;

      if (replyTo) {
        try {
          if (!parsed.forceRegenerate) {
            const existing = await fetchLatestAtriReplyToLog(env, parsed.userId, replyTo);
            const existingText = sanitizeText(String(existing?.content || '')).trim();
            if (existing && existingText) {
              const state = await getUserState(env, parsed.userId);
              return jsonResponse({
                reply: existingText,
                status: {
                  label: state.statusLabel,
                  pillColor: state.statusPillColor,
                  textColor: state.statusTextColor
                },
                action: null,
                intimacy: state.intimacy,
                replyLogId: existing.id,
                replyTimestamp: existing.timestamp,
                replyTo
              });
            }
          }

          anchorTimestamp = await getConversationLogTimestamp(env, parsed.userId, replyTo);
          if (parsed.forceRegenerate) {
            await isConversationLogDeleted(env, parsed.userId, replyTo);
            const ids = await listConversationReplyIds(env, parsed.userId, [replyTo]);
            if (ids.length) await deleteConversationLogsByIds(env, parsed.userId, ids);
            if (typeof anchorTimestamp === 'number') {
              const staleResult = await env.ATRI_DB.prepare(
                `SELECT id FROM conversation_logs WHERE user_id = ? AND timestamp > ?`
              ).bind(parsed.userId, anchorTimestamp).all<{ id: string }>();
              const staleIds = (staleResult.results || []).map(r => String(r?.id || '').trim()).filter(Boolean);
              if (staleIds.length) await deleteConversationLogsByIds(env, parsed.userId, staleIds);
            }
          }
        } catch (err) {
          console.warn('[ATRI] prune_logs_failed', { userId: parsed.userId, err });
        }
      }

      console.log('[ATRI] chat_start', {
        userId: parsed.userId,
        logId: replyTo,
        model: modelToUse,
        forceRegenerate: parsed.forceRegenerate,
        hasImage
      });

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
      const replyTimestamp = typeof anchorTimestamp === 'number'
        ? Math.max(Date.now(), anchorTimestamp + 1)
        : Date.now();

      ctx.waitUntil((async () => {
        try {
          await applySideEffects(env, result.sideEffects);
        } catch (e) {
          console.warn('[ATRI] side_effects_failed', { userId: parsed.userId, e });
        }
        if (result.usedPendingProactive?.id) {
          try {
            await markProactiveMessagesDelivered(env, {
              userId: parsed.userId,
              ids: [result.usedPendingProactive.id],
              deliveredAt: Date.now()
            });
          } catch (e) {
            console.warn('[ATRI] pending_proactive_mark_failed', { userId: parsed.userId, e });
          }
        }
        const skip = replyTo ? await isConversationLogDeleted(env, parsed.userId, replyTo) : false;
        if (!skip) {
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
          } catch (e) {
            console.warn('[ATRI] save_atri_log_failed', { userId: parsed.userId, e });
          }
        }
      })());

      return jsonResponse({
        reply: result.reply,
        status: result.status,
        action: null,
        intimacy: result.intimacy,
        replyLogId,
        replyTimestamp,
        replyTo
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ATRI] chat_failed', { message: msg });
      return jsonResponse({ error: 'bio_chat_failed', details: msg }, 500);
    }
  });
}
