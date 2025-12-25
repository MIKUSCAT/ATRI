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
import { ChatCompletionError } from './openai-service';
import { callChatCompletionsUnified } from './gemini-service';
import { searchMemories } from './memory-service';
import {
  ConversationLogRecord,
  fetchConversationLogs,
  getConversationLogDate,
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
  stream?: boolean;
};

type AgentChatResult = {
  reply: string;
  mood: { p: number; a: number; d: number };
  action: string | null;
  intimacy: number;
} | Response;

type AgentToolCall = {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
};

export async function runAgentChat(env: Env, params: AgentChatParams): Promise<AgentChatResult | Response> {
  const contextDate = await resolveConversationDateForChat(env, {
    userId: params.userId,
    clientTimeIso: params.clientTimeIso,
    logId: params.logId
  });
  const conversationLogs = await loadConversationLogsForChatDate(env, {
    userId: params.userId,
    date: contextDate,
    excludeLogId: params.logId
  });
  const historyMessages = buildHistoryMessagesFromLogs(conversationLogs);
  const workingMemoryPlaceholder = historyMessages.length
    ? '（今天的聊天记录已在上文消息历史中提供）'
    : '（今天还没有聊天记录）';

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
    workingMemory: workingMemoryPlaceholder,
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

  const { reply, state, streamResponse } = await runToolLoop(env, {
    messages,
    model: params.model,
    userId: params.userId,
    userName: params.userName,
    state: touchedState,
    platform: params.platform,
    clientTimeIso: params.clientTimeIso,
    userProfileSnippet,
    selfReviewSnippet,
    firstConversationAt: firstConversationAt ?? undefined,
    stream: params.stream
  });

  const finalState = {
    ...state,
    lastInteractionAt: Date.now(),
    updatedAt: Date.now()
  };
  await saveUserState(env, finalState);

  // 如果是流式响应，包装并返回
  if (streamResponse) {
    return wrapStreamWithMetadata(streamResponse, {
      mood: { p: finalState.padValues[0], a: finalState.padValues[1], d: finalState.padValues[2] },
      intimacy: finalState.intimacy
    });
  }

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

/**
 * 包装流式响应，在流结束后添加元数据
 */
function wrapStreamWithMetadata(
  response: Response,
  metadata: { mood: { p: number; a: number; d: number }; intimacy: number }
): Response {
  const reader = response.body?.getReader();
  if (!reader) return response;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        // 在流结束前发送元数据
        const metaEvent = `data: ${JSON.stringify({ type: 'metadata', ...metadata })}\n\n`;
        controller.enqueue(encoder.encode(metaEvent));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
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

function composeAgentSystemPrompt(params: {
  padValues: [number, number, number];
  intimacy: number;
  firstInteractionAt?: number;
  userName?: string;
  platform?: string;
  clientTimeIso?: string;
  workingMemory?: string;
  userProfileSnippet?: string;
  selfReviewSnippet?: string;
}) {
  const [p, a, d] = params.padValues;
  const template = prompts.agent?.system || '';
  const working = params.workingMemory?.trim() || '（今天的聊天记录已在上文消息历史中提供）';
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

    // 兼容旧模板：如果还包含 {working_memory}，用短提示占位，避免重复注入对话文本
    if (basePrompt.includes('{working_memory}')) {
      basePrompt = basePrompt.replace('{working_memory}', working);
    }
  } else {
    basePrompt = [
    '你叫亚托莉 (ATRI)，高性能但有情绪的仿生少女。保持真实、口语化，不要长篇大论。',
    '## 当前状态',
    `- 愉悦度(P): ${p.toFixed(2)}`,
    `- 兴奋度(A): ${a.toFixed(2)}`,
    `- 掌控度(D): ${d.toFixed(2)}`,
    `- 相识: ${daysTogether}天 | 累计互动: ${params.intimacy || 0}次`,
    timeInfo ? `- 现在的时间是：${timeInfo.localDate} ${timeInfo.clockTime}` : '',
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

  const profileText = params.userProfileSnippet?.trim();
  if (profileText) {
    basePrompt = `${basePrompt}\n\n## 我对这个人的长期理解\n${profileText}`;
  }

  const selfReviewText = params.selfReviewSnippet?.trim();
  if (selfReviewText) {
    basePrompt = `${basePrompt}\n\n## 我自己的说话提醒（只给我自己看，不要直接复述给对方）\n${selfReviewText}`;
  }

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

  let data: any;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return '';
  }

  const rows = Array.isArray(data?.["表格"]) ? data["表格"] : [];
  const map = new Map<string, any>();
  for (const row of rows) {
    const dim = String(row?.["维度"] || '').trim();
    if (dim) {
      map.set(dim, row);
    }
  }

  const order = ['语气', '长度', '提问方式', '共情回应', '主动程度', '口癖重复'];
  const lines: string[] = [];
  for (const dim of order) {
    const row = map.get(dim);
    const improvement = String(row?.["改进"] || '').trim();
    if (improvement) {
      lines.push(`${dim}：${improvement}`);
    }
    if (lines.length >= 6) break;
  }

  if (!lines.length) return '';
  return lines.map(line => `- ${line}`).join('\n');
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
  state: any;
  platform?: string;
  clientTimeIso?: string;
  userProfileSnippet?: string;
  selfReviewSnippet?: string;
  firstConversationAt?: number;
  stream?: boolean;
}): Promise<{ reply: string; state: any; streamResponse?: Response }> {
  let latestState = params.state;

  for (let i = 0; i < MAX_AGENT_LOOPS; i++) {
    let data: any;
    try {
      const response = await callChatCompletionsUnified(
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
        const result = await executeAgentTool(call, env, params.userId, params.userName, latestState);
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
        workingMemory: '（今天的聊天记录已在上文消息历史中提供）',
        userProfileSnippet: params.userProfileSnippet,
        selfReviewSnippet: params.selfReviewSnippet
      });
      params.messages[0].content = updatedSystemPrompt;

      continue;
    }

    // 没有工具调用，这是最终回复
    // 如果启用流式，重新发起流式请求
    if (params.stream) {
      const streamResponse = await callChatCompletionsUnified(
        env,
        {
          messages: params.messages,
          temperature: 1.0,
          stream: true,
          max_tokens: 4096
        },
        { timeoutMs: 120000, model: params.model }
      );
      return { reply: '', state: latestState, streamResponse };
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
  state: any
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

  if (name === 'update_mood') {
    const updated = await updateMoodState(env, {
      userId,
      pleasureDelta: args.pleasure_delta,
      arousalDelta: args.arousal_delta,
      dominanceDelta: args.dominance_delta,
      reason: args.reason,
      currentState: state
    });
    return {
      output: `已更新心情：P=${updated.padValues[0].toFixed(2)}, A=${updated.padValues[1].toFixed(2)}, D=${updated.padValues[2].toFixed(2)}`,
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
      output: `已更新亲密度：${updated.intimacy}`,
      updatedState: updated
    };
  }

  return { output: '未知工具' };
}

async function runReadDiary(env: Env, userId: string, args: any) {
  const query = sanitizeText(String(args?.query || '').trim());
  if (!query) {
    return '查询关键词为空';
  }
  try {
    const mems = await searchMemories(env, userId, query, 5);
    const diaryMems = mems.filter((m: any) => m.category === 'diary' && m.date);
    if (!diaryMems.length) {
      return '没有找到相关日记';
    }

    const lines: string[] = [];
    for (const mem of diaryMems) {
      let snippet = '';
      if (mem.id) {
        const entry = await getDiaryEntryById(env, mem.id);
        snippet = entry?.content || entry?.summary || '';
      }
      lines.push(`【${mem.date}】${snippet || '无详情'}`);
    }
    return lines.join('\n\n');
  } catch (error) {
    console.warn('[ATRI] read_diary failed', error);
    return '读取日记时出错';
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
      description: '查阅过去的日记，确认具体事件或细节时调用',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词' },
          time_range: { type: 'string', description: '可选时间范围，如 last_month/2024-01' }
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
          reason: { type: 'string', description: '简短的内心独白' }
        },
        required: ['pleasure_delta', 'arousal_delta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_intimacy',
      description: '当对话让关系更近/互动增加时调用，更新亲密度（互动次数）',
      parameters: {
        type: 'object',
        properties: {
          delta: { type: 'integer', description: '亲密度变化（建议 1-5）' },
          reason: { type: 'string', description: '简短原因或内心独白' }
        },
        required: ['delta']
      }
    }
  }
];

const MAX_AGENT_LOOPS = 3;
const AGENT_FALLBACK_REPLY = '唔…我有点卡住了，稍后再聊好吗？';
const AGENT_TIMEOUT_REPLY = '抱歉，我今天有点迟钝，能再提示我一次吗？';
