import { Env } from '../types';
import { formatDateInZone, formatTimeInZone } from '../utils/date';
import { sanitizeAssistantReply, stripVisibleThinking } from '../utils/sanitize';
import { buildTwoDaysHistoryMessagesFromLogs, loadTwoDaysConversationLogs } from './history-context';
import {
  getProactiveUserState,
  getUserState,
  saveConversationLog,
  saveProactiveMessage,
  saveProactiveUserState
} from './data-service';
import { callUpstreamChatWith504Retry, UpstreamMessage } from './llm-service';
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

type EpisodeSignals = {
  pendingIntention: { content: string; triggerHint?: string; urgency: number } | null;
  promises: Array<{ content: string; sourceDate: string | null }>;
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

async function loadEpisodeSignals(env: Env, userId: string, now: number): Promise<EpisodeSignals> {
  const intentionRow = await env.ATRI_DB.prepare(
    `SELECT content, trigger_hint as triggerHint, urgency
       FROM memory_intentions
      WHERE user_id = ? AND status = 'pending' AND archived_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY urgency DESC, emotional_weight DESC, created_at DESC
      LIMIT 1`
  ).bind(userId, now).first<{ content?: string; triggerHint?: string; urgency?: number }>().catch(() => null);

  const promiseResult = await env.ATRI_DB.prepare(
    `SELECT content, source_date as sourceDate
       FROM fact_memories
      WHERE user_id = ? AND type = 'promise' AND archived_at IS NULL
      ORDER BY source_date DESC, updated_at DESC
      LIMIT 3`
  ).bind(userId).all<{ content?: string; sourceDate?: string | null }>().catch(() => ({ results: [] } as any));

  const pendingIntention = intentionRow && intentionRow.content
    ? {
        content: String(intentionRow.content || '').trim(),
        triggerHint: String(intentionRow.triggerHint || '').trim() || undefined,
        urgency: Number(intentionRow.urgency || 5)
      }
    : null;

  const promises = (promiseResult?.results || [])
    .map((row: any) => ({
      content: String(row?.content || '').trim(),
      sourceDate: String(row?.sourceDate || '').trim() || null
    }))
    .filter((p: { content: string }) => p.content);

  return { pendingIntention, promises };
}

function formatEpisodeSignals(signals: EpisodeSignals): string {
  const lines: string[] = [];
  if (signals.pendingIntention) {
    lines.push('<想找机会自然说出口的话>');
    lines.push(`- ${signals.pendingIntention.content}`);
    if (signals.pendingIntention.triggerHint) {
      lines.push(`  （想在这种时候说：${signals.pendingIntention.triggerHint}）`);
    }
    lines.push('</想找机会自然说出口的话>');
  }
  if (signals.promises.length) {
    lines.push('<之前答应过的事>');
    for (const p of signals.promises) {
      lines.push(`- ${p.content}${p.sourceDate ? `（${p.sourceDate}）` : ''}`);
    }
    lines.push('</之前答应过的事>');
  }
  return lines.join('\n');
}

export async function generateProactiveMessage(env: Env, params: {
  userId: string;
  hoursSince: number;
  clockTime: string;
  episodeSignals: EpisodeSignals;
  historyMessages: UpstreamMessage[];
  settings: EffectiveRuntimeSettings;
}): Promise<string | null> {
  const coreSelf = String(params.settings.prompts.core_self?.system || '').trim();
  const proactiveTmpl = String(params.settings.prompts.proactive?.system || '')
    .replace(/\{clock_time\}/g, params.clockTime)
    .replace(/\{hours_since\}/g, String(params.hoursSince));
  const systemPrompt = [coreSelf, proactiveTmpl].filter(Boolean).join('\n\n');

  const episodeBlock = formatEpisodeSignals(params.episodeSignals);
  const userPrompt = [
    '（无新消息——是否想主动开口？）',
    episodeBlock
  ].filter(Boolean).join('\n\n');

  const { message } = await callUpstreamChatWith504Retry(env, {
    format: params.settings.chatApiFormat,
    apiUrl: params.settings.openaiApiUrl,
    apiKey: params.settings.openaiApiKey,
    model: params.settings.defaultChatModel,
    messages: [
      { role: 'system', content: systemPrompt },
      ...(params.historyMessages || []),
      { role: 'user', content: userPrompt }
    ],
    temperature: params.settings.agentTemperature,
    maxTokens: params.settings.agentMaxTokens,
    timeoutMs: params.settings.agentTimeoutMs,
    trace: { scope: 'proactive', userId: params.userId }
  });

  const text = stripVisibleThinking(String(message.content || '')).trim();
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

  const recentActiveMs = settings.proactiveRecentActiveMinutes * 60000;
  if (userState.lastInteractionAt > 0 && now - userState.lastInteractionAt < recentActiveMs) {
    return { triggered: false, reason: 'recent_active' };
  }

  const hoursSince = userState.lastInteractionAt > 0
    ? Math.max(1, Math.floor((now - userState.lastInteractionAt) / 3600000))
    : 24;
  const clockTime = `${formatDateInZone(now, timeZone)} ${formatTimeInZone(now, timeZone)}`;
  const [episodeSignals, historyPack] = await Promise.all([
    loadEpisodeSignals(env, userId, now),
    loadTwoDaysConversationLogs(env, { userId, today })
  ]);
  const recentHistoryCount = historyPack.todayLogs.length + historyPack.yesterdayLogs.length;
  if (!episodeSignals.pendingIntention && !episodeSignals.promises.length && recentHistoryCount === 0) {
    return { triggered: false, reason: 'no_episode_signal' };
  }
  const historyMessages = buildTwoDaysHistoryMessagesFromLogs({
    today,
    todayLogs: historyPack.todayLogs,
    yesterday: historyPack.yesterdayDate,
    yesterdayLogs: historyPack.yesterdayLogs
  }) as UpstreamMessage[];

  let proactiveReply = '';
  try {
    proactiveReply = String(await generateProactiveMessage(env, {
      userId,
      hoursSince,
      clockTime,
      episodeSignals,
      historyMessages,
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
    triggerContext: JSON.stringify({
      hoursSince,
      localHour,
      timeZone,
      reason: 'scheduler',
      hasPendingIntention: Boolean(episodeSignals.pendingIntention),
      promiseCount: episodeSignals.promises.length,
      recentHistoryCount
    }),
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
