import { Env } from '../types';
import { formatDateInZone, formatTimeInZone } from '../utils/date';
import { sanitizeAssistantReply } from '../utils/sanitize';
import { callUpstreamChat } from './llm-service';
import { sendNotification } from './notification-service';
import {
  getProactiveUserState,
  getUserState,
  saveConversationLog,
  saveProactiveMessage,
  saveProactiveUserState
} from './data-service';
import { buildTwoDaysHistoryMessagesFromLogs, loadTwoDaysConversationLogs } from './history-context';
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
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date(ts));
  const hourRaw = parts.find((p) => p.type === 'hour')?.value || '0';
  const hour = Number(hourRaw);
  return Number.isFinite(hour) ? hour : 0;
}

function inQuietHours(localHour: number, startHour: number, endHour: number) {
  const h = Math.max(0, Math.min(23, Math.trunc(localHour)));
  const start = Math.max(0, Math.min(23, Math.trunc(startHour)));
  const end = Math.max(0, Math.min(23, Math.trunc(endHour)));
  if (start === end) return false;
  if (start < end) {
    return h >= start && h < end;
  }
  return h >= start || h < end;
}

function extractMessageText(message: any): string {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text;
          if (part.text && typeof part.text.value === 'string') return part.text.value;
          if (typeof part.content === 'string') return part.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content ?? '');
}

const PROACTIVE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'send_notification',
      description: '向用户发送一条外部通知（渠道/目标由 /admin 配置决定）。只有你真的想联系、且不会打搅对方时才用。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '要通知的内容（建议与要发出的那句话一致）' }
        },
        required: ['content']
      }
    }
  }
];

async function runProactiveToolLoop(env: Env, params: {
  messages: any[];
  format: 'openai' | 'anthropic' | 'gemini';
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  trace?: { scope?: string; userId?: string };
  notification: { requested: boolean; content: string | null; attempted: boolean; sent: boolean; error: string | null };
}) {
  const notification = params.notification;

  for (let i = 0; i < 3; i++) {
    const result = await callUpstreamChat(env, {
      format: params.format,
      apiUrl: params.apiUrl,
      apiKey: params.apiKey,
      model: params.model,
      messages: params.messages,
      tools: PROACTIVE_TOOLS,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      timeoutMs: params.timeoutMs,
      trace: params.trace
    });

    const message = result.message;
    const toolCalls: any[] = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length === 0) {
      return message;
    }

    params.messages.push({
      role: 'assistant',
      content: message?.content || null,
      tool_calls: toolCalls
    });

    for (const call of toolCalls) {
      const name = String(call?.function?.name || '').trim();
      const toolCallId = String(call?.id || '').trim() || `tool_${Date.now()}`;

      let output = '';
      if (name !== 'send_notification') {
        output = `unknown_tool:${name || 'empty'}`;
      } else if (notification.requested) {
        output = 'ignored:already_requested';
      } else {
        let args: any = {};
        try {
          args = JSON.parse(String(call?.function?.arguments || '') || '{}');
        } catch {
          args = {};
        }
        const content = String(args?.content || '').trim();
        if (!content) {
          output = 'invalid_content';
        } else if (content.toUpperCase().includes('[SKIP]')) {
          output = 'invalid_content_skip';
        } else {
          notification.requested = true;
          notification.content = content.slice(0, 1000);
          output = 'queued';
        }
      }

      params.messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        name,
        content: output
      });
    }
  }

  return null;
}

function renderProactiveSystemPrompt(template: string, params: {
  now: number;
  timeZone: string;
  hoursSince: number;
  intimacy: number;
}) {
  const clockTime = `${formatDateInZone(params.now, params.timeZone)} ${formatTimeInZone(params.now, params.timeZone)}`;
  return String(template || '')
    .replace(/\{clock_time\}/g, clockTime)
    .replace(/\{hours_since\}/g, String(params.hoursSince))
    .replace(/\{intimacy\}/g, String(params.intimacy))
    .replace(/\{user_profile_snippet\}/g, '');
}

async function runProactiveAgent(env: Env, params: {
  userId: string;
  now: number;
  timeZone: string;
  intimacy: number;
  hoursSince: number;
  settings: EffectiveRuntimeSettings;
}): Promise<{ reply: string | null; notification: { attempted: boolean; sent: boolean; error: string | null } }> {
  const model = params.settings.defaultChatModel;
  const today = formatDateInZone(params.now, params.timeZone);
  const { todayLogs, yesterdayLogs, yesterdayDate } = await loadTwoDaysConversationLogs(env, {
    userId: params.userId,
    today
  });
  const historyMessages = buildTwoDaysHistoryMessagesFromLogs({
    today,
    todayLogs,
    yesterday: yesterdayDate,
    yesterdayLogs
  });
  const proactivePrompt = String((params.settings.prompts as any)?.proactive?.system || '').trim();
  const fallbackPrompt = [
    '你是亚托莉。现在没有收到对方消息。',
    '如果你觉得该主动说话，就输出一句自然的话；',
    '如果不该打扰，就只输出 [SKIP]。',
    `当前时间：${formatDateInZone(params.now, params.timeZone)} ${formatTimeInZone(params.now, params.timeZone)}`,
    `距上次聊天：${params.hoursSince} 小时`,
    `亲密度：${params.intimacy}`
  ].join('\n');
  const systemPrompt = proactivePrompt
    ? renderProactiveSystemPrompt(proactivePrompt, {
      now: params.now,
      timeZone: params.timeZone,
      hoursSince: params.hoursSince,
      intimacy: params.intimacy
    })
    : fallbackPrompt;

  const messages: any[] = [{ role: 'system', content: systemPrompt }];
  if (historyMessages.length) {
    messages.push({ role: 'system', content: '--- 以下是主对话最近两天记录（和正常聊天上下文一致）---' });
    messages.push(...historyMessages);
  }
  messages.push({
    role: 'user',
    content: '请只输出你现在想发的一句话；如果不该打扰，请只输出 [SKIP]。'
  });

  const notification = {
    requested: false,
    content: null as string | null,
    attempted: false,
    sent: false,
    error: null as string | null
  };
  const finalMessage = await runProactiveToolLoop(env, {
    messages,
    format: params.settings.chatApiFormat,
    apiUrl: params.settings.openaiApiUrl,
    apiKey: params.settings.openaiApiKey,
    model,
    temperature: params.settings.agentTemperature,
    maxTokens: 256,
    timeoutMs: 90000,
    trace: { scope: 'proactive', userId: params.userId },
    notification
  });

  const raw = extractMessageText(finalMessage).trim();
  if (!raw) return { reply: null, notification };
  if (raw.toUpperCase().includes('[SKIP]')) return { reply: null, notification };
  const reply = sanitizeAssistantReply(raw).trim();
  if (!reply) return { reply: null, notification };

  const alwaysPushNotification = params.settings.proactiveNotificationChannel !== 'none';
  if (alwaysPushNotification && !notification.attempted) {
    notification.attempted = true;
    const content = (notification.content || reply).trim().slice(0, 1000);
    const r = await sendNotification(env, {
      channel: params.settings.proactiveNotificationChannel,
      target: params.settings.proactiveNotificationTarget,
      content,
      userId: params.userId
    });
    notification.sent = r.sent;
    notification.error = r.error || null;
  }

  return { reply: reply.slice(0, 600), notification };
}

export async function evaluateProactiveForUser(env: Env, params: ProactiveEvaluateParams): Promise<ProactiveEvaluateResult> {
  const userId = String(params.userId || '').trim();
  if (!userId) return { triggered: false, reason: 'empty_user' };

  const settings = params.settings;
  if (!settings.proactiveEnabled) {
    return { triggered: false, reason: 'disabled' };
  }

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
  if (dailyCount >= settings.proactiveMaxDaily) {
    return { triggered: false, reason: 'daily_limit' };
  }

  if (settings.proactiveCooldownHours > 0 && proactiveState.lastProactiveAt > 0) {
    const cooldownMs = settings.proactiveCooldownHours * 3600000;
    if (now - proactiveState.lastProactiveAt < cooldownMs) {
      return { triggered: false, reason: 'cooldown' };
    }
  }

  if (userState.intimacy < settings.proactiveIntimacyThreshold) {
    return { triggered: false, reason: 'intimacy_too_low' };
  }

  const recentActiveMs = settings.proactiveRecentActiveMinutes * 60000;
  if (userState.lastInteractionAt > 0 && now - userState.lastInteractionAt < recentActiveMs) {
    return { triggered: false, reason: 'recent_active' };
  }

  const hoursSince = userState.lastInteractionAt > 0
    ? Math.max(1, Math.floor((now - userState.lastInteractionAt) / 3600000))
    : 24;

  let proactiveReply = '';
  let notificationAttempted = false;
  let notificationSent = false;
  let notificationError: string | null = null;
  try {
    const generated = await runProactiveAgent(env, {
      userId,
      now,
      timeZone,
      intimacy: userState.intimacy,
      hoursSince,
      settings
    });
    proactiveReply = String(generated.reply || '').trim();
    notificationAttempted = Boolean(generated.notification?.attempted);
    notificationSent = Boolean(generated.notification?.sent);
    notificationError = generated.notification?.error || null;
  } catch (error: any) {
    console.warn('[ATRI] proactive_agent_failed', { userId, error: String(error?.message || error) });
    return { triggered: false, reason: 'agent_failed' };
  }

  if (!proactiveReply) {
    return { triggered: false, reason: 'agent_skip' };
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

  const notificationChannel = notificationAttempted ? settings.proactiveNotificationChannel : 'none';

  const triggerContext = JSON.stringify({
    intimacy: userState.intimacy,
    hoursSince,
    localHour,
    timeZone,
    reason: 'scheduler'
  });

  await saveProactiveMessage(env, {
    id: `pm:${savedLog.id}`,
    userId,
    content: proactiveReply,
    triggerContext,
    status: 'pending',
    notificationChannel,
    notificationSent: notificationSent,
    notificationError: notificationError,
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
