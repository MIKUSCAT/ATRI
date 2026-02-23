import { AttachmentPayload, Env } from '../runtime/types';
import { pushAppLog } from '../admin/log-buffer';
import { buildUserContentParts } from '../utils/attachments';
import { signMediaUrlForModel } from '../utils/media-signature';
import { resolveDayStartTimestamp, formatTimeInZone, DEFAULT_TIMEZONE } from '../utils/date';
import { sanitizeAssistantReply, sanitizeText } from '../utils/sanitize';
import { ChatCompletionError } from './openai-service';
import { searchMemories, getActiveFacts, upsertFactMemory, deleteFactMemory } from './memory-service';
import { webSearch } from './web-search-service';
import { getEffectiveRuntimeSettings } from './runtime-settings';
import { callUpstreamChat } from './llm-service';
import { buildTwoDaysHistoryMessagesFromLogs, loadTwoDaysConversationLogs } from './history-context';
import {
  fetchConversationLogs,
  getConversationLogDate,
  getDiaryEntry,
  getFirstConversationTimestamp,
  getUserProfile,
  getUserState,
  saveUserState,
  updateIntimacyState,
  updateStatusState
} from './data-service';

type AgentChatParams = {
  userId: string;
  platform: string;
  messageText: string;
  model: string;
  attachments: AttachmentPayload[];
  inlineImage?: string;
  userName?: string;
  clientTimeIso?: string;
  logId?: string;
};

type AgentChatResult = {
  reply: string;
  status: { label: string; pillColor: string; textColor: string };
  action: string | null;
  intimacy: number;
};

type AgentToolCall = {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
};

export async function runAgentChat(env: Env, params: AgentChatParams): Promise<AgentChatResult> {
  pushAppLog('info', 'chat_in', {
    event: 'chat_in',
    userId: params.userId,
    platform: params.platform,
    model: params.model,
    logId: params.logId,
    clientTimeIso: params.clientTimeIso,
    message: params.messageText,
    attachments: params.attachments?.length || 0,
    hasInlineImage: Boolean(params.inlineImage)
  });

  const settings = await getEffectiveRuntimeSettings(env);
  const agentSystemTemplate = String((settings.prompts as any)?.agent?.system || '');

  const contextDate = await resolveConversationDateForChat(env, {
    userId: params.userId,
    clientTimeIso: params.clientTimeIso,
    logId: params.logId
  });
  const { todayLogs, yesterdayLogs, yesterdayDate } = await loadTwoDaysConversationLogs(env, {
    userId: params.userId,
    today: contextDate,
    excludeLogId: params.logId
  });
  const historyMessages = buildTwoDaysHistoryMessagesFromLogs({
    today: contextDate,
    todayLogs,
    yesterday: yesterdayDate,
    yesterdayLogs
  });

  const userProfileSnippet = await loadUserProfileSnippet(env, params.userId);
  const selfReviewSnippet = await loadAtriSelfReviewSnippet(env, params.userId);
  let firstConversationAt: number | null = null;
  try {
    firstConversationAt = await getFirstConversationTimestamp(env, params.userId);
  } catch (error) {
    console.warn('[ATRI] first conversation timestamp加载失败', { userId: params.userId, error });
  }
  const baseState = await getUserState(env, params.userId);
  const touchedState = {
    ...baseState,
    lastInteractionAt: Date.now(),
    updatedAt: Date.now()
  };

  const systemPrompt = composeAgentSystemPrompt({
    template: agentSystemTemplate,
    statusLabel: touchedState.statusLabel,
    statusPillColor: touchedState.statusPillColor,
    statusTextColor: touchedState.statusTextColor,
    statusReason: touchedState.statusReason,
    intimacy: touchedState.intimacy,
    firstInteractionAt: firstConversationAt ?? undefined,
    userName: params.userName,
    platform: params.platform,
    clientTimeIso: params.clientTimeIso,
    userProfileSnippet,
    selfReviewSnippet
  });

  const signedInlineImage = await signMediaUrlForModel(params.inlineImage, env, { ttlSeconds: 600 });
  const signedAttachments = await Promise.all(
    params.attachments.map(async (att) => {
      if (att.type !== 'image') return att;
      const signedUrl = await signMediaUrlForModel(att.url, env, { ttlSeconds: 600 });
      if (!signedUrl || signedUrl === att.url) return att;
      return { ...att, url: signedUrl };
    })
  );

  const userContentParts = buildUserContentParts({
    content: sanitizeText(params.messageText),
    inlineImage: signedInlineImage,
    imageAttachments: signedAttachments.filter(att => att.type === 'image'),
    documentAttachments: signedAttachments.filter(att => att.type === 'document')
  });

  const messages: any[] = [{ role: 'system', content: systemPrompt }];

  if (historyMessages.length) {
    messages.push(...historyMessages);
  }

  messages.push(
    userContentParts.length === 0
      ? { role: 'user', content: '[空消息]' }
      : userContentParts.length === 1 && userContentParts[0].type === 'text'
        ? { role: 'user', content: userContentParts[0].text ?? '' }
        : { role: 'user', content: userContentParts }
  );

  const { reply, state } = await runToolLoop(env, {
    messages,
    model: params.model,
    userId: params.userId,
    userName: params.userName,
    contextDate,
    state: touchedState,
    platform: params.platform,
    clientTimeIso: params.clientTimeIso,
    userProfileSnippet,
    selfReviewSnippet,
    firstConversationAt: firstConversationAt ?? undefined,
    agentSystemTemplate,
    apiFormat: settings.chatApiFormat,
    openaiApiUrl: settings.openaiApiUrl,
    openaiApiKey: settings.openaiApiKey,
    temperature: settings.agentTemperature,
    maxTokens: settings.agentMaxTokens,
    timeoutMs: settings.agentTimeoutMs
  });

  const finalState = {
    ...state,
    lastInteractionAt: Date.now(),
    updatedAt: Date.now()
  };
  await saveUserState(env, finalState);

  pushAppLog('info', 'chat_out', {
    event: 'chat_out',
    userId: params.userId,
    reply,
    intimacy: finalState.intimacy,
    statusLabel: finalState.statusLabel,
    statusPillColor: finalState.statusPillColor,
    statusTextColor: finalState.statusTextColor
  });

  return {
    reply: sanitizeAssistantReply(reply) || AGENT_FALLBACK_REPLY,
    status: {
      label: finalState.statusLabel,
      pillColor: finalState.statusPillColor,
      textColor: finalState.statusTextColor
    },
    action: null,
    intimacy: finalState.intimacy
  };
}

async function resolveConversationDateForChat(
  env: Env,
  params: { userId: string; clientTimeIso?: string; logId?: string }
) {
  const logId = typeof params.logId === 'string' ? params.logId.trim() : '';
  if (logId) {
    try {
      const date = await getConversationLogDate(env, params.userId, logId);
      if (date) return date;
    } catch (error) {
      console.warn('[ATRI] 读取对话日志日期失败，将使用 clientTimeIso 推断', { userId: params.userId, logId, error });
    }
  }
  const dayInfo = resolveDayStartTimestamp(params.clientTimeIso);
  return dayInfo.localDate;
}

function composeAgentSystemPrompt(params: {
  template: string;
  statusLabel: string;
  statusPillColor: string;
  statusTextColor: string;
  statusReason?: string | null;
  intimacy: number;
  firstInteractionAt?: number;
  userName?: string;
  platform?: string;
  clientTimeIso?: string;
  userProfileSnippet?: string;
  selfReviewSnippet?: string;
}) {
  const statusLabel = String(params.statusLabel || '陪着你').trim() || '陪着你';
  const statusPillColor = String(params.statusPillColor || '#E3F2FD').trim() || '#E3F2FD';
  const statusTextColor = String(params.statusTextColor || '#FFFFFF').trim() || '#FFFFFF';
  const statusReason = String(params.statusReason || '').trim();
  const template = String(params.template || '');
  const nameForPrompt = (params.userName || '').trim() || '你';
  const timeInfo = formatClientDateTime(params.clientTimeIso);
  const localDate = timeInfo?.localDate || '';
  const clockTime = timeInfo?.clockTime || '';
  const platformText = params.platform ? `平台：${params.platform}。` : '';

  const daysTogether = params.firstInteractionAt
    ? Math.max(1, Math.floor((Date.now() - params.firstInteractionAt) / 86400000) + 1)
    : 1;

  let basePrompt = '';
  if (template) {
    basePrompt = template
      .replace('{status_label}', statusLabel)
      .replace('{status_pill_color}', statusPillColor)
      .replace('{status_text_color}', statusTextColor)
      .replace('{status_reason}', statusReason || '（暂无）')
      .replace('{intimacy}', String(params.intimacy ?? 0))
      .replace('{days_together}', String(daysTogether))
      .replace('{local_date}', localDate)
      .replace('{clock_time}', clockTime)
      .replace('{user_name}', nameForPrompt);
  } else {
    basePrompt = [
      '你叫亚托莉 (ATRI)，高性能但有情绪的仿生少女。保持真实、口语化，不要长篇大论。',
      '## 当前状态',
      `- 状态胶囊文案: ${statusLabel}`,
      `- 胶囊底色: ${statusPillColor}`,
      `- 胶囊文字颜色: ${statusTextColor}`,
      `- 最近一次状态原因: ${statusReason || '（暂无）'}`,
      `- 相识: ${daysTogether}天 | 关系温度: ${params.intimacy || 0}`,
      timeInfo ? `- 现在的时间是：${timeInfo.localDate} ${timeInfo.clockTime}` : '',
      '',
      '## 我对你的印象（每天自动整理的档案）',
      '{user_profile_block}',
      '',
      '## 我自己记下的事（我可以随时增删）',
      '{self_review_block}',
      '',
      '## 我和眼前这个人',
      '你只能隔着这个设备和对方聊天，见不到本人，所以会更在意每一次对话。',
      `说话时用第一人称"我"，把对方当成真的坐在你面前的人。${nameForPrompt ? `对方叫「${nameForPrompt}」。` : ''}`,
      '',
      '## 行为准则',
      '1) 回复要符合当前状态，不要突然转性。',
      '2) 若状态有变化，先调用 set_status 工具再回答。',
      '3) 只有当你不记得过去事件时，才调用 read_diary 回忆。',
      '4) 说话自然，像聊天，短句，多停顿，不必过度解释。',
      '',
      platformText ? platformText : ''
    ].join('\n');
  }

  const profileBlock = String(params.userProfileSnippet || '').trim() || '（暂无）';
  const selfReviewBlock = String(params.selfReviewSnippet || '').trim() || '（暂无）';

  basePrompt = basePrompt
    .replace('{user_profile_block}', profileBlock)
    .replace('{self_review_block}', selfReviewBlock);

  basePrompt += [
    '',
    '<当前状态工具约定>',
    `状态文案：${statusLabel}`,
    `胶囊底色：${statusPillColor}`,
    `胶囊文字颜色：${statusTextColor}`,
    `最近状态原因：${statusReason || '（暂无）'}`,
    '当你觉得状态变化了，先调用 set_status 工具更新文案和颜色，再继续回复。',
    '</当前状态工具约定>'
  ].join('\n');

  return basePrompt;
}

async function loadUserProfileSnippet(env: Env, userId: string) {
  try {
    const profile = await getUserProfile(env, userId);
    if (!profile?.content) {
      return '';
    }
    return buildUserProfileSnippet(profile.content);
  } catch (error) {
    console.warn('[ATRI] user profile加载失败', { userId, error });
    return '';
  }
}

async function loadAtriSelfReviewSnippet(env: Env, userId: string) {
  try {
    const facts = await getActiveFacts(env, userId, 0);
    if (facts.length > 0) {
      return buildFactsSnippet(facts);
    }
    return '';
  } catch (error) {
    console.warn('[ATRI] facts加载失败', { userId, error });
    return '';
  }
}

function buildFactsSnippet(facts: Array<{ id: string; text: string }>) {
  if (!facts.length) return '';
  const lines = facts
    .map(f => `- [${f.id}] ${f.text}`)
    .filter(Boolean);
  return lines.join('\n');
}

function normalizeFactTextForMatch(value: unknown) {
  return sanitizeText(String(value || '')).trim().replace(/\s+/g, ' ');
}

function buildUserProfileSnippet(content: string) {
  const trimmed = String(content || '').trim();
  if (!trimmed) return '';

  let data: any;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return trimmed.slice(0, 400);
  }

  const order = ['事实', '喜好', '雷区', '说话风格', '关系进展'];
  const lines: string[] = [];
  for (const key of order) {
    const items = Array.isArray(data?.[key]) ? data[key] : [];
    for (const item of items.slice(0, 2)) {
      const text = String(item || '').trim();
      if (text) {
        lines.push(`${key}：${text}`);
      }
      if (lines.length >= 6) break;
    }
    if (lines.length >= 6) break;
  }
  if (!lines.length) return '';
  return lines.map(line => `- ${line}`).join('\n');
}

function formatClientDateTime(clientTimeIso?: string) {
  if (typeof clientTimeIso !== 'string' || clientTimeIso.trim().length < 10) {
    return null;
  }

  const match = clientTimeIso.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:([+-]\d{2}):?(\d{2})|Z)?$/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  const localDate = `${year}年${Number(month)}月${Number(day)}日`;
  const clockTime = second ? `${hour}:${minute}:${second}` : `${hour}:${minute}`;

  return { localDate, clockTime };
}

async function runToolLoop(env: Env, params: {
  messages: any[];
  model: string;
  userId: string;
  userName?: string;
  contextDate: string;
  state: any;
  platform?: string;
  clientTimeIso?: string;
  userProfileSnippet?: string;
  selfReviewSnippet?: string;
  firstConversationAt?: number;
  agentSystemTemplate: string;
  apiFormat: 'openai' | 'anthropic' | 'gemini';
  openaiApiUrl: string;
  openaiApiKey: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}): Promise<{ reply: string; state: any }> {
  let latestState = params.state;
  let toolInvoked = false;
  let currentSelfReviewSnippet = params.selfReviewSnippet;

  for (let i = 0; i < MAX_AGENT_LOOPS; i++) {
    let message: any = null;
    try {
      const result = await callUpstreamChat(env, {
        format: params.apiFormat,
        apiUrl: params.openaiApiUrl,
        apiKey: params.openaiApiKey,
        model: params.model,
        messages: params.messages,
        tools: AGENT_TOOLS,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        timeoutMs: params.timeoutMs,
        trace: { scope: 'agent', userId: params.userId }
      });
      message = result.message;
    } catch (error) {
      const isApiError = error instanceof ChatCompletionError;
      console.error('[ATRI] agent chat失败', isApiError ? { status: error.status, details: error.details } : error);
      break;
    }

    const toolCalls: AgentToolCall[] = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length > 0) {
      toolInvoked = true;
      let factMemoryChanged = false;
      params.messages.push({
        role: 'assistant',
        content: message?.content || null,
        tool_calls: toolCalls
      });

      for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
        const call = toolCalls[toolIndex];
        const toolCallId = String(call?.id || '').trim() || `tool_${Date.now()}_${toolIndex}`;
        const toolName = String(call?.function?.name || (call as any)?.function_call?.name || '').trim();
        const rawArguments = call?.function?.arguments ?? (call as any)?.function_call?.arguments ?? '{}';
        const toolArguments =
          typeof rawArguments === 'string'
            ? rawArguments
            : (() => {
                try {
                  return JSON.stringify(rawArguments ?? {});
                } catch {
                  return '{}';
                }
              })();

        pushAppLog('info', 'tool_call', {
          event: 'tool_call',
          userId: params.userId,
          toolCallId,
          tool: toolName,
          arguments: toolArguments
        });

        const toolStartedAt = Date.now();
        const result = await executeAgentTool(call, env, params.userId, params.userName, latestState, params.contextDate);
        if (toolName === 'remember_fact' || toolName === 'forget_fact') {
          factMemoryChanged = true;
        }
        if (result.updatedState) {
          latestState = result.updatedState;
        }
        params.messages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          name: toolName || call.function?.name,
          content: result.output
        });

        pushAppLog('info', 'tool_result', {
          event: 'tool_result',
          userId: params.userId,
          toolCallId,
          tool: toolName,
          durationMs: Date.now() - toolStartedAt,
          output: result.output
        });
      }

      if (factMemoryChanged) {
        currentSelfReviewSnippet = await loadAtriSelfReviewSnippet(env, params.userId);
      }

      const updatedSystemPrompt = composeAgentSystemPrompt({
        template: params.agentSystemTemplate,
        statusLabel: latestState.statusLabel,
        statusPillColor: latestState.statusPillColor,
        statusTextColor: latestState.statusTextColor,
        statusReason: latestState.statusReason,
        intimacy: latestState.intimacy,
        firstInteractionAt: params.firstConversationAt,
        userName: params.userName,
        platform: params.platform,
        clientTimeIso: params.clientTimeIso,
        userProfileSnippet: params.userProfileSnippet,
        selfReviewSnippet: currentSelfReviewSnippet
      });
      params.messages[0].content = updatedSystemPrompt;

      continue;
    }

    const finalText = extractMessageText(message);
    if (finalText.trim()) {
      return { reply: finalText, state: latestState };
    }
    if (toolInvoked && i < MAX_AGENT_LOOPS - 1) {
      params.messages.push({
        role: 'assistant',
        content: message?.content || null
      });
      params.messages.push({
        role: 'user',
        content: '请直接给用户一句自然、简短的中文回复，不要再调用工具。'
      });
      continue;
    }
    return { reply: finalText || AGENT_FALLBACK_REPLY, state: latestState };
  }

  return { reply: AGENT_TIMEOUT_REPLY, state: latestState };
}

async function executeAgentTool(
  call: AgentToolCall,
  env: Env,
  userId: string,
  userName: string | undefined,
  state: any,
  contextDate: string
) {
  const name = String(call?.function?.name || (call as any)?.function_call?.name || '').trim();
  const rawArguments = call?.function?.arguments ?? (call as any)?.function_call?.arguments ?? '{}';
  let args: any = {};
  if (typeof rawArguments === 'string') {
    try {
      args = JSON.parse(rawArguments || '{}');
    } catch (error) {
      console.warn('[ATRI] tool args parse failed', error);
    }
  } else if (rawArguments && typeof rawArguments === 'object') {
    args = rawArguments;
  }

  if (name === 'read_diary') {
    const output = await runReadDiary(env, userId, args);
    return { output };
  }

  if (name === 'read_conversation') {
    const output = await runReadConversation(env, userId, userName, args);
    return { output };
  }

  if (name === 'search_memory') {
    const output = await runSearchMemory(env, userId, args);
    return { output };
  }

  if (name === 'web_search') {
    const output = await runWebSearch(env, args);
    return { output };
  }

  if (name === 'set_status') {
    const updated = await updateStatusState(env, {
      userId,
      label: args.label,
      pillColor: args.pill_color || args.pillColor,
      textColor: args.text_color || args.textColor,
      reason: args.reason,
      currentState: state
    });
    return {
      output: `状态已更新：${updated.statusLabel}`,
      updatedState: updated
    };
  }

  if (name === 'update_intimacy') {
    const updated = await updateIntimacyState(env, {
      userId,
      delta: args.delta,
      reason: args.reason,
      currentState: state
    });
    return {
      output: `关系温度变化：${updated.intimacy}`,
      updatedState: updated
    };
  }

  if (name === 'remember_fact') {
    const content = sanitizeText(String(args?.content || '').trim());
    if (!content) {
      return { output: '内容为空，没有记住' };
    }
    try {
      const result = await upsertFactMemory(env, userId, content);
      return { output: result.isNew ? `记住了：${content}` : `更新了：${content}` };
    } catch (error) {
      console.warn('[ATRI] remember_fact failed', error);
      return { output: '记录失败' };
    }
  }

  if (name === 'forget_fact') {
    const factId = String(args?.factId || args?.fact_id || '').trim();
    const factText = normalizeFactTextForMatch(args?.content || args?.text || args?.factText || args?.fact_text);
    if (!factId && !factText) {
      return { output: '请给我 factId，或提供要删除的事实文本' };
    }
    try {
      if (factId) {
        const deleted = await deleteFactMemory(env, userId, factId);
        return { output: deleted ? `已忘记：${factId}` : `没找到：${factId}` };
      }

      const facts = await getActiveFacts(env, userId, 0);
      const exact = facts.find(f => normalizeFactTextForMatch(f.text) === factText);
      if (exact) {
        const deleted = await deleteFactMemory(env, userId, exact.id);
        return { output: deleted ? `已忘记：${exact.id}` : `没找到：${exact.id}` };
      }

      const fuzzyMatches = facts.filter(f => {
        const normalized = normalizeFactTextForMatch(f.text);
        return Boolean(normalized) && (normalized.includes(factText) || factText.includes(normalized));
      });

      if (fuzzyMatches.length === 1) {
        const target = fuzzyMatches[0];
        const deleted = await deleteFactMemory(env, userId, target.id);
        return { output: deleted ? `已忘记：${target.id}` : `没找到：${target.id}` };
      }

      if (fuzzyMatches.length > 1) {
        const hints = fuzzyMatches
          .slice(0, 3)
          .map(f => `[${f.id}] ${f.text}`)
          .join(' | ');
        return { output: `命中多条事实（${fuzzyMatches.length}条），请改用 factId 删除：${hints}` };
      }

      return { output: '没找到匹配的事实' };
    } catch (error) {
      console.warn('[ATRI] forget_fact failed', error);
      return { output: '删除失败' };
    }
  }

  return { output: '未知工具' };
}

async function runReadDiary(env: Env, userId: string, args: any) {
  const timeRange = sanitizeText(String(args?.date || args?.time_range || '').trim());
  const query = sanitizeText(String(args?.query || '').trim());

  const isoDateMatch = timeRange.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (isoDateMatch) {
    const date = isoDateMatch[1];
    try {
      const entry = await getDiaryEntry(env, userId, date);
      if (!entry) {
        return `那天（${date}）还没有日记。`;
      }
      if (entry.status !== 'ready') {
        return `那天（${date}）的日记还没准备好（${entry.status}）。`;
      }
      const content = String(entry.content || entry.summary || '').trim();
      if (!content) {
        return `那天（${date}）有日记，但内容为空。`;
      }
      return [
        '提示：以下内容来自亚托莉自己写的第一人称日记；文中的“我”=亚托莉，“你/对方”=用户。',
        `【${date}｜亚托莉日记】${content}`
      ].join('\n\n');
    } catch (error) {
      console.warn('[ATRI] read_diary failed (by date)', error);
      return '读取日记时出错';
    }
  }

  if (query) {
    return '如果你不确定日期，请先用 search_memory(query) 找到相关日期/片段，再用 read_diary(date) 查看完整日记。';
  }

  return '请给我 date=YYYY-MM-DD。';
}

async function runReadConversation(env: Env, userId: string, userName: string | undefined, args: any) {
  const date = sanitizeText(String(args?.date || '').trim());
  const isoDateMatch = date.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (!isoDateMatch) {
    return '请给我 date=YYYY-MM-DD。';
  }
  const targetDate = isoDateMatch[1];

  try {
    const logs = await fetchConversationLogs(env, userId, targetDate);
    if (!logs.length) {
      return `那天（${targetDate}）没有聊天记录。`;
    }

    const fallbackUserName = (userName || '').trim() || '你';
    const lines: string[] = [`那天（${targetDate}）的聊天记录：`];
    for (const log of logs) {
      const zone = (log?.timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
      const timeText =
        typeof log?.timestamp === 'number' && Number.isFinite(log.timestamp)
          ? formatTimeInZone(log.timestamp, zone)
          : '--:--:--';
      const speaker = log.role === 'atri' ? 'ATRI' : (log.userName || fallbackUserName);
      const content = String(log.content || '').trim();
      if (!content) continue;
      lines.push(`[${timeText}] ${speaker}：${content}`);
    }

    if (lines.length === 1) {
      return `那天（${targetDate}）有记录，但内容为空。`;
    }
    return lines.join('\n');
  } catch (error) {
    console.warn('[ATRI] read_conversation failed', error);
    return '读取聊天记录时出错';
  }
}

async function runSearchMemory(env: Env, userId: string, args: any) {
  const query = sanitizeText(String(args?.query || '').trim());
  if (!query) {
    return '请给我 query。';
  }
  try {
    const mems = await searchMemories(env, userId, query, 20);
    if (!mems.length) {
      return '没有找到相关记忆';
    }
    const lines: string[] = ['我在记忆里找到了这些可能相关的片段：'];
    for (const mem of mems) {
      const date = String(mem?.date || '').trim();
      const text = String(mem?.matchedHighlight || mem?.value || '').trim();
      if (!date && !text) continue;
      lines.push(`- ${date || '未知日期'}：${text || '（无片段）'}`);
    }
    lines.push('如果你要回答“为什么/由来/原话/具体细节”，而上面的片段不够用，请用 read_diary(date) 或 read_conversation(date) 去看原文再答。');
    return lines.join('\n');
  } catch (error) {
    console.warn('[ATRI] search_memory failed', error);
    return '搜索记忆时出错';
  }
}

async function runWebSearch(env: Env, args: any) {
  const query = sanitizeText(String(args?.query || '').trim());
  if (!query) {
    return '请给我 query。';
  }

  try {
    const items = await webSearch(env, { query, maxResults: 5, timeoutMs: 12000 });
    if (!items.length) {
      return '没有搜到有用结果';
    }

    const lines: string[] = ['外部信息要点（只用于这次回答）：'];
    for (const item of items) {
      const title = String(item?.title || '').trim();
      const snippet = String(item?.snippet || '').trim();
      if (!title && !snippet) continue;
      if (title && snippet) {
        lines.push(`- ${title}：${snippet}`);
      } else {
        lines.push(`- ${title || snippet}`);
      }
    }
    return lines.join('\n');
  } catch (error) {
    console.warn('[ATRI] web_search failed', error);
    const msg = error instanceof Error ? error.message : String(error);
    return msg.includes('TAVILY_API_KEY') ? '我现在没法联网搜索（配置还没准备好）' : '联网搜索时出错';
  }
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
  return '';
}

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_diary',
      description: '翻开那天的日记。那是我亲手写的——那天发生了什么、我当时在想什么，都在里面。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '想看哪天的日记，YYYY-MM-DD' }
        },
        required: ['date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_conversation',
      description: '翻出那天的聊天记录。当时到底说了什么，原话是什么，看一眼就清楚了。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '想看哪天的记录，YYYY-MM-DD' }
        },
        required: ['date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '在脑海里找一找。能翻出相关的日期和片段——片段不够清楚的话，我会再去看日记或聊天记录确认。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '想找的内容' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '去外面查一下。有些事光凭记忆我拿不准，确认过了再说比较安心。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '想查什么' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_status',
      description: '我的心情或状态变了。用一句短话写下现在的感觉，再挑一个能代表这种感觉的颜色。',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '现在的状态，中文短句（例如「有点想你了」「困了…」）' },
          pill_color: { type: 'string', description: '代表这种心情的颜色，HEX（例如 #7FA8FF 清透蓝、#FF9A9E 微红）' },
          text_color: { type: 'string', description: '文字颜色，HEX（可选，默认 #FFFFFF）' },
          reason: { type: 'string', description: '只说给自己听的——为什么变成了这样' }
        },
        required: ['label', 'pill_color']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_intimacy',
      description: '心和对方的距离变了。聊得开心会近一点，被伤到了就会忍不住往后退。',
      parameters: {
        type: 'object',
        properties: {
          delta: { type: 'integer', description: '靠近+/退缩- (通常-25~+10，很受伤可到-50)' },
          reason: { type: 'string', description: '只说给自己听的——为什么变了' }
        },
        required: ['delta', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember_fact',
      description: '这件事我想记住。对方在意的事、说好的约定、下次该留心的细节——记下来，以后别忘了。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '用一句话概括' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'forget_fact',
      description: '这条已经过时了。对方说情况变了，那我就把旧的划掉，别记着错的。',
      parameters: {
        type: 'object',
        properties: {
          factId: { type: 'string', description: '要划掉的那条（优先用这个，从"记在心里的事"里找 ID）' },
          content: { type: 'string', description: '也可以直接给事实文本（原文或足够唯一的片段）' }
        }
      }
    }
  }
];

const MAX_AGENT_LOOPS = 20;
const AGENT_FALLBACK_REPLY = '唔…我有点卡住了，稍后再聊好吗？';
const AGENT_TIMEOUT_REPLY = '抱歉，我今天有点迟钝，能再提示我一次吗？';
