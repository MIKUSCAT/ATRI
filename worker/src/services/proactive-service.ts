import { Env } from '../types';
import { formatDateInZone, formatTimeInZone } from '../utils/date';
import { sanitizeAssistantReply } from '../utils/sanitize';
import {
  getProactiveUserState,
  getUserState,
  saveConversationLog,
  saveProactiveMessage,
  saveProactiveUserState
} from './data-service';
import { callUpstreamChat } from './llm-service';
import { sendNotification } from './notification-service';
import type { EffectiveRuntimeSettings } from './runtime-settings';

export type ProactiveEvaluateParams = {
  userId: string;
  now?: number;
  userName?: string;
  timeZone?: string;
  settings: EffectiveRuntimeSettings;
};

export type ProactiveEvaluateResult = {
  triggered: boolean;
  reason: string;
  messageId?: string;
};

function getLocalHourInZone(ts: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(ts));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  return Number.isFinite(hour) ? hour : 0;
}

function inQuietHours(localHour: number, startHour: number, endHour: number) {
  const h = Math.max(0, Math.min(23, Math.trunc(localHour)));
  const start = Math.max(0, Math.min(23, Math.trunc(startHour)));
  const end = Math.max(0, Math.min(23, Math.trunc(endHour)));
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

export async function generateProactiveMessage(env: Env, params: {
  userId: string;
  hoursSince: number;
  intimacy: number;
  clockTime: string;
  settings: EffectiveRuntimeSettings;
}): Promise<string | null> {
  const coreSelf = String(params.settings.prompts.core_self?.system || '').trim();
  const proactiveTmpl = String(params.settings.prompts.proactive?.system || '')
    .replace(/\{clock_time\}/g, params.clockTime)
    .replace(/\{hours_since\}/g, String(params.hoursSince))
    .replace(/\{intimacy\}/g, String(params.intimacy));
  const systemPrompt = [coreSelf, proactiveTmpl].filter(Boolean).join('\n\n');

  const { message } = await callUpstreamChat(env, {
    format: params.settings.chatApiFormat,
    apiUrl: params.settings.openaiApiUrl,
    apiKey: params.settings.openaiApiKey,
    model: params.settings.defaultChatModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '（无新消息——是否想主动开口？）' }
    ],
    temperature: params.settings.agentTemperature,
    maxTokens: 512,
    timeoutMs: params.settings.agentTimeoutMs,
    trace: { scope: 'proactive', userId: params.userId }
  });

  const text = String(message.content || '').trim();
  if (!text || text.includes('[SKIP]')) return null;
  const reply = sanitizeAssistantReply(text).trim();
  return reply ? reply.slice(0, 600) : null;
}

export async function evaluateProactiveForUser(env: Env, params: ProactiveEvaluateParams): Promise<ProactiveEvaluateResult> {
  const userId = String(params.userId || '').trim();
  if (!userId) return { triggered: false, reason: 'empty_user' };

  const settings = params.settings;
  if (!settings.proactiveEnabled) return { triggered: false, reason: 'disabled' };

  const now = Number.isFinite(Number(params.now)) ? Number(params.now) : Date.now();
  const timeZone = String(params.timeZone || settings.proactiveTimeZone || 'Asia/Shanghai').trim() || 'Asia/Shanghai';
  const userState = await getUserState(env, userId);
  const proactiveState = await getProactiveUserState(env, userId);
  const localHour = getLocalHourInZone(now, timeZone);

  if (inQuietHours(localHour, settings.proactiveQuietStartHour, settings.proactiveQuietEndHour)) {
    return { triggered: false, reason: 'quiet_hours' };
  }

  const today = formatDateInZone(now, timeZone);
  const dailyCount = proactiveState.dailyCountDate === today ? proactiveState.dailyCount : 0;
  if (dailyCount >= settings.proactiveMaxDaily) return { triggered: false, reason: 'daily_limit' };

  if (settings.proactiveCooldownHours > 0 && proactiveState.lastProactiveAt > 0) {
    const cooldownMs = settings.proactiveCooldownHours * 3600000;
    if (now - proactiveState.lastProactiveAt < cooldownMs) return { triggered: false, reason: 'cooldown' };
  }

  if (userState.intimacy < settings.proactiveIntimacyThreshold) return { triggered: false, reason: 'intimacy_too_low' };

  const recentActiveMs = settings.proactiveRecentActiveMinutes * 60000;
  if (userState.lastInteractionAt > 0 && now - userState.lastInteractionAt < recentActiveMs) {
    return { triggered: false, reason: 'recent_active' };
  }

  const hoursSince = userState.lastInteractionAt > 0
    ? Math.max(1, Math.floor((now - userState.lastInteractionAt) / 3600000))
    : 24;
  const clockTime = `${formatDateInZone(now, timeZone)} ${formatTimeInZone(now, timeZone)}`;

  let proactiveReply = '';
  try {
    proactiveReply = String(await generateProactiveMessage(env, {
      userId,
      hoursSince,
      intimacy: userState.intimacy,
      clockTime,
      settings
    }) || '').trim();
  } catch (error: any) {
    console.warn('[ATRI] proactive_agent_failed', { userId, error: String(error?.message || error) });
    return { triggered: false, reason: 'agent_failed' };
  }

  if (!proactiveReply) return { triggered: false, reason: 'agent_skip' };

  let notificationSent = false;
  let notificationError: string | null = null;
  const notificationChannel = settings.proactiveNotificationChannel;
  if (notificationChannel !== 'none') {
    const pushed = await sendNotification(env, {
      channel: notificationChannel,
      target: settings.proactiveNotificationTarget,
      content: proactiveReply,
      userId
    });
    notificationSent = pushed.sent;
    notificationError = pushed.error || null;
  }

  const messageId = crypto.randomUUID();
  const savedLog = await saveConversationLog(env, {
    id: messageId,
    userId,
    role: 'atri',
    content: proactiveReply,
    timestamp: now,
    userName: params.userName,
    timeZone
  });

  await saveProactiveMessage(env, {
    id: `pm:${savedLog.id}`,
    userId,
    content: proactiveReply,
    triggerContext: JSON.stringify({ intimacy: userState.intimacy, hoursSince, localHour, timeZone, reason: 'scheduler' }),
    status: 'pending',
    notificationChannel,
    notificationSent,
    notificationError,
    createdAt: now,
    expiresAt: now + 72 * 3600000
  });

  await saveProactiveUserState(env, {
    userId,
    lastProactiveAt: now,
    dailyCount: dailyCount + 1,
    dailyCountDate: today,
    updatedAt: now
  });

  console.log('[ATRI] proactive_message_created', {
    userId,
    messageId: savedLog.id,
    notificationSent,
    notificationChannel,
    reason: notificationError || 'ok'
  });

  return { triggered: true, reason: 'sent', messageId: savedLog.id };
}
