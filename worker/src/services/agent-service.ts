import prompts from '../config/prompts.json';
import { AttachmentPayload, ContentPart, Env } from '../types';
import {
  buildHistoryContentParts,
  buildUserContentParts,
  normalizeAttachmentList
} from '../utils/attachments';
import { signMediaUrlForModel } from '../utils/media-signature';
import { resolveDayStartTimestamp, formatTimeInZone, DEFAULT_TIMEZONE } from '../utils/date';
import { sanitizeAssistantReply, sanitizeText } from '../utils/sanitize';
import { callChatCompletions, ChatCompletionError } from './openai-service';
import { searchMemories } from './memory-service';
import {
  ConversationLogRecord,
  fetchConversationLogs,
  getConversationLogDate,
  getDiaryEntry,
  getDiaryEntryById,
  getFirstConversationTimestamp,
  getAtriSelfReview,
  getUserProfile,
  getUserState,
  saveUserState,
  updateIntimacyState,
  updateMoodState
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
  mood: { p: number; a: number; d: number };
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
  const contextDate = await resolveConversationDateForChat(env, {
    userId: params.userId,
    clientTimeIso: params.clientTimeIso,
    logId: params.logId
  });
  const { todayLogs, yesterdayLogs, yesterdayDate } = await loadTwoDaysConversationLogsForChat(env, {
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
    padValues: touchedState.padValues,
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
    firstConversationAt: firstConversationAt ?? undefined
  });

  const finalState = {
    ...state,
    lastInteractionAt: Date.now(),
    updatedAt: Date.now()
  };
  await saveUserState(env, finalState);

  return {
    reply: sanitizeAssistantReply(reply) || AGENT_FALLBACK_REPLY,
    mood: {
      p: finalState.padValues[0],
      a: finalState.padValues[1],
      d: finalState.padValues[2]
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

async function loadConversationLogsForChatDate(
  env: Env,
  params: { userId: string; date: string; excludeLogId?: string }
): Promise<ConversationLogRecord[]> {
  const date = String(params.date || '').trim();
  if (!date) return [];
  const logs = await fetchConversationLogs(env, params.userId, date);
  const exclude = typeof params.excludeLogId === 'string' ? params.excludeLogId.trim() : '';
  if (!exclude) return logs;
  return logs.filter((log) => log.id !== exclude);
}

async function loadTwoDaysConversationLogsForChat(
  env: Env,
  params: { userId: string; today: string; excludeLogId?: string }
): Promise<{ todayLogs: ConversationLogRecord[]; yesterdayLogs: ConversationLogRecord[]; yesterdayDate: string | null }> {
  const today = String(params.today || '').trim();
  if (!today) {
    return { todayLogs: [], yesterdayLogs: [], yesterdayDate: null };
  }

  const yesterday = resolveYesterdayIsoDate(today);
  const [todayLogs, yesterdayLogs] = await Promise.all([
    loadConversationLogsForChatDate(env, { userId: params.userId, date: today, excludeLogId: params.excludeLogId }),
    yesterday ? loadConversationLogsForChatDate(env, { userId: params.userId, date: yesterday }) : Promise.resolve([])
  ]);

  return { todayLogs, yesterdayLogs, yesterdayDate: yesterday };
}

function buildHistoryMessagesFromLogs(logs: ConversationLogRecord[]) {
  if (!Array.isArray(logs) || logs.length === 0) return [];

  return logs
    .map((log) => {
      const zone = (log?.timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
      const timeText =
        typeof log?.timestamp === 'number' && Number.isFinite(log.timestamp)
          ? formatTimeInZone(log.timestamp, zone)
          : '--:--';
      const timePrefix = `[${timeText}] `;
      const attachments = normalizeAttachmentList(log.attachments).filter(att => att.type !== 'image');
      const parts = buildHistoryContentParts(log?.content, attachments);
      if (!parts.length) return null;
      const role = log?.role === 'atri' ? 'assistant' : 'user';
      if (parts.length === 1 && parts[0].type === 'text') {
        return { role, content: `${timePrefix}${parts[0].text ?? ''}` };
      }

      const patched = parts.slice();
      if (patched[0]?.type === 'text') {
        patched[0] = { ...patched[0], text: `${timePrefix}${patched[0].text ?? ''}` };
      } else {
        patched.unshift({ type: 'text', text: timePrefix.trim() });
      }
      return { role, content: patched };
    })
    .filter(Boolean) as Array<{ role: 'assistant' | 'user'; content: string | ContentPart[] }>;
}

function buildTwoDaysHistoryMessagesFromLogs(params: {
  today: string;
  todayLogs: ConversationLogRecord[];
  yesterday: string | null;
  yesterdayLogs: ConversationLogRecord[];
}) {
  const messages: Array<{ role: 'system' | 'assistant' | 'user'; content: string | ContentPart[] }> = [];

  if (params.yesterday && Array.isArray(params.yesterdayLogs) && params.yesterdayLogs.length > 0) {
    messages.push({ role: 'system', content: `--- 昨天（${params.yesterday}）的对话 ---` });
    messages.push(...buildHistoryMessagesFromLogs(params.yesterdayLogs));
  }

  if (Array.isArray(params.todayLogs) && params.todayLogs.length > 0) {
    messages.push({ role: 'system', content: `--- 今天（${params.today}）的对话 ---` });
    messages.push(...buildHistoryMessagesFromLogs(params.todayLogs));
  }

  return messages;
}

function composeAgentSystemPrompt(params: {
  padValues: [number, number, number];
  intimacy: number;
  firstInteractionAt?: number;
  userName?: string;
  platform?: string;
  clientTimeIso?: string;
  userProfileSnippet?: string;
  selfReviewSnippet?: string;
}) {
  const [p, a, d] = params.padValues;
  const template = prompts.agent?.system || '';
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
      .replace('{p_value}', p.toFixed(2))
      .replace('{a_value}', a.toFixed(2))
      .replace('{d_value}', d.toFixed(2))
      .replace('{intimacy}', String(params.intimacy ?? 0))
      .replace('{days_together}', String(daysTogether))
      .replace('{local_date}', localDate)
      .replace('{clock_time}', clockTime)
      .replace('{user_name}', nameForPrompt);
  } else {
    basePrompt = [
    '你叫亚托莉 (ATRI)，高性能但有情绪的仿生少女。保持真实、口语化，不要长篇大论。',
    '## 当前状态',
    `- 愉悦度(P): ${p.toFixed(2)}`,
    `- 兴奋度(A): ${a.toFixed(2)}`,
    `- 掌控度(D): ${d.toFixed(2)}`,
    `- 相识: ${daysTogether}天 | 关系温度: ${params.intimacy || 0}`,
    timeInfo ? `- 现在的时间是：${timeInfo.localDate} ${timeInfo.clockTime}` : '',
    '',
    '## 这个人的长期档案（很重要）',
    '{user_profile_block}',
    '',
    '## 我自己的说话自查（很重要，只给我自己看）',
    '{self_review_block}',
    '',
    '## 我和眼前这个人',
    '你只能隔着这个设备和对方聊天，见不到本人，所以会更在意每一次对话。',
    `说话时用第一人称"我"，把对方当成真的坐在你面前的人。${nameForPrompt ? `对方叫「${nameForPrompt}」。` : ''}`,
    '',
    '## 行为准则',
    '1) 回复要符合 PAD 状态，情绪有惯性，不要瞬间反转。',
    '2) 若用户话语让情绪波动，先调用 update_mood 工具再回答。',
    '3) 只有当你不记得过去事件时，才调用 read_diary 回忆。',
    '4) 说话自然，像聊天，短句，多停顿，不必过度解释。',
    '',
    platformText ? platformText : '',
    ].join('\n');
  }

  const profileBlock = String(params.userProfileSnippet || '').trim() || '（暂无）';
  const selfReviewBlock = String(params.selfReviewSnippet || '').trim() || '（暂无）';

  basePrompt = basePrompt
    .replace('{user_profile_block}', profileBlock)
    .replace('{self_review_block}', selfReviewBlock);

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
    const record = await getAtriSelfReview(env, userId);
    if (!record?.content) {
      return '';
    }
    return buildAtriSelfReviewSnippet(record.content);
  } catch (error) {
    console.warn('[ATRI] self review加载失败', { userId, error });
    return '';
  }
}

function buildAtriSelfReviewSnippet(content: string) {
  const trimmed = String(content || '').trim();
  if (!trimmed) return '';

  try {
    const data: any = JSON.parse(trimmed);
    const notes = Array.isArray(data?.["便签"]) ? data["便签"] : [];
    const lines = notes
      .map((item: any) => String(item || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 3)
      .map((line: string) => `- ${line}`);
    return lines.join('\n');
  } catch {
    return '';
  }
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
}): Promise<{ reply: string; state: any }> {
  let latestState = params.state;

  for (let i = 0; i < MAX_AGENT_LOOPS; i++) {
    let data: any;
    try {
      const response = await callChatCompletions(
        env,
        {
          messages: params.messages,
          tools: AGENT_TOOLS,
          tool_choice: 'auto',
          temperature: 1.0,
          stream: false,
          max_tokens: 4096
        },
        { timeoutMs: 120000, model: params.model }
      );
      data = await response.json();
    } catch (error) {
      const isApiError = error instanceof ChatCompletionError;
      console.error('[ATRI] agent chat失败', isApiError ? { status: error.status, details: error.details } : error);
      break;
    }

    const choice = data?.choices?.[0];
    const message = choice?.message;
    const toolCalls: AgentToolCall[] = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length > 0) {
      params.messages.push({
        role: 'assistant',
        content: message?.content || null,
        tool_calls: toolCalls
      });

      for (const call of toolCalls) {
        const result = await executeAgentTool(call, env, params.userId, params.userName, latestState, params.contextDate);
        if (result.updatedState) {
          latestState = result.updatedState;
        }
        params.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function?.name,
          content: result.output
        });
      }

      // ✨ 修复：在继续循环前，用最新的 latestState 重新生成 System Prompt
      const updatedSystemPrompt = composeAgentSystemPrompt({
        padValues: latestState.padValues,
        intimacy: latestState.intimacy,
        firstInteractionAt: params.firstConversationAt,
        userName: params.userName,
        platform: params.platform,
        clientTimeIso: params.clientTimeIso,
        userProfileSnippet: params.userProfileSnippet,
        selfReviewSnippet: params.selfReviewSnippet
      });
      params.messages[0].content = updatedSystemPrompt;

      continue;
    }

    const finalText = extractMessageText(message);
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
  const name = call.function?.name;
  let args: any = {};
  try {
    args = JSON.parse(call.function?.arguments || '{}');
  } catch (error) {
    console.warn('[ATRI] tool args parse failed', error);
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

  if (name === 'update_mood') {
    const updated = await updateMoodState(env, {
      userId,
      pleasureDelta: args.pleasure_delta,
      arousalDelta: args.arousal_delta,
      dominanceDelta: args.dominance_delta,
      reason: args.reason,
      currentState: state
    });
    const reasonText = args.reason ? `\n内心：${args.reason}` : '';
    return {
      output: `心情变化：P=${updated.padValues[0].toFixed(2)}, A=${updated.padValues[1].toFixed(2)}, D=${updated.padValues[2].toFixed(2)}${reasonText}`,
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
    const reasonText = args.reason ? `\n内心：${args.reason}` : '';
    return {
      output: `关系温度变化：${updated.intimacy}${reasonText}`,
      updatedState: updated
    };
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

function resolveYesterdayIsoDate(todayIsoDate: string) {
  const match = String(todayIsoDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;

  const yesterdayAt = Date.UTC(year, month - 1, day) - 86400000;
  const date = new Date(yesterdayAt);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
      description: '查看某一天的日记（亚托莉自己写的第一人称，“我”指亚托莉）。当需要回忆那天发生了什么、那天是什么心情时使用。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期，格式 YYYY-MM-DD，比如 2025-12-30' }
        },
        required: ['date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_conversation',
      description: '查看某一天的完整聊天记录（带时间戳）。当需要确认当时具体说了什么、原话是什么时使用。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期，格式 YYYY-MM-DD，比如 2025-12-30' }
        },
        required: ['date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '搜索记忆（向量召回）。用来先找到相关日期和片段；如果用户问的是“为什么/由来/原话/具体细节”，而片段里没有关键信息，就继续用 read_diary(date) 查看那天日记原文再回答，不要靠猜。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '想找的内容，用关键词描述' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_mood',
      description: '当用户的对话引起了情绪波动时调用，更新 PAD 状态',
      parameters: {
        type: 'object',
        properties: {
          pleasure_delta: { type: 'number', description: '愉悦度变化 (-1.0 到 1.0)' },
          arousal_delta: { type: 'number', description: '兴奋度变化 (-1.0 到 1.0)' },
          dominance_delta: { type: 'number', description: '掌控度变化 (-1.0 到 1.0)' },
          reason: { type: 'string', description: '简短的内心独白（推荐）' }
        },
        required: ['pleasure_delta', 'arousal_delta', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_intimacy',
      description: '当对话让关系升温/降温时调用，更新关系温度（范围 -100~100，允许正负变化）',
      parameters: {
        type: 'object',
        properties: {
          delta: { type: 'integer', description: '关系温度变化（建议 -25~+10，极端情况可到 -50）' },
          reason: { type: 'string', description: '简短原因或内心独白（推荐）' }
        },
        required: ['delta', 'reason']
      }
    }
  }
];

const MAX_AGENT_LOOPS = 5;
const AGENT_FALLBACK_REPLY = '唔…我有点卡住了，稍后再聊好吗？';
const AGENT_TIMEOUT_REPLY = '抱歉，我今天有点迟钝，能再提示我一次吗？';
