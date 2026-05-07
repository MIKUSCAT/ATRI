import type { AttachmentPayload, Env } from '../types';
import { buildUserContentParts } from '../utils/attachments';
import { resolveDayStartTimestamp } from '../utils/date';
import { signMediaUrlForModel } from '../utils/media-signature';
import { sanitizeAssistantReply, sanitizeText } from '../utils/sanitize';
import { autoRecallMemories } from './auto-recall-service';
import { composeAgentSystemPrompt } from './agent-prompt-builder';
import { parseStructuredReply, ParsedReply } from './agent-reply-parser';
import { executeInfoTool, INFO_TOOLS } from './agent-tools';
import {
  fetchLatestPendingProactive,
  getConversationLogDate,
  getFirstConversationTimestamp,
  getUserState,
  saveUserState,
  updateIntimacyState,
  updateStatusState
} from './data-service';
import { buildTwoDaysHistoryMessagesFromLogs, loadTwoDaysConversationLogs } from './history-context';
import {
  archiveFactMemory,
  getActiveFacts,
  getRelevantFacts,
  upsertFactMemory
} from './memory-service';
import { listPendingIntentions, markIntentionUsed } from './memory-intention-service';
import {
  buildAssistantToolMessageForContinuation,
  callUpstreamChat,
  OpenAiToolCall,
  UpstreamMessage
} from './llm-service';
import { getEffectiveRuntimeSettings } from './runtime-settings';

export type AgentChatParams = {
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

export type SideEffectPlan = {
  userId: string;
  statusUpdate: ParsedReply['status'];
  intimacyDelta: number;
  rememberFacts: ParsedReply['rememberFacts'];
  forgetFacts: ParsedReply['forgetFacts'];
  finalReply: string;
  matchedIntentionIds: string[];
};

export type AgentChatResult = {
  reply: string;
  status: { label: string; pillColor: string; textColor: string; reason?: string };
  action: string | null;
  intimacy: number;
  sideEffects: SideEffectPlan;
  usedPendingProactive?: { id: string; content: string } | null;
};

const MAX_AGENT_LOOPS = 8;

export async function runAgentChat(env: Env, params: AgentChatParams): Promise<AgentChatResult> {
  const settings = await getEffectiveRuntimeSettings(env);
  const contextDate = await resolveConversationDateForChat(env, {
    userId: params.userId,
    clientTimeIso: params.clientTimeIso,
    logId: params.logId
  });

  const [historyPack, recalls, facts, state, firstAt, pendingProactive, intentions] = await Promise.all([
    loadTwoDaysConversationLogs(env, {
      userId: params.userId,
      today: contextDate,
      excludeLogId: params.logId
    }),
    autoRecallMemories(env, params.userId, params.messageText),
    getRelevantFacts(env, params.userId, params.messageText, 8),
    getUserState(env, params.userId),
    safeFirstInteraction(env, params.userId),
    fetchLatestPendingProactive(env, params.userId),
    safeListPendingIntentions(env, params.userId, 5)
  ]);

  const touchedState = { ...state, lastInteractionAt: Date.now(), updatedAt: Date.now() };
  const coreSelf = String(settings.prompts.core_self?.system || '').trim();
  const agent = String(settings.prompts.agent?.system || '').trim();
  if (!coreSelf) throw new Error('prompt_missing:core_self.system');
  if (!agent) throw new Error('prompt_missing:agent.system');

  const promptResult = composeAgentSystemPrompt({
    coreSelf,
    agent,
    state: touchedState,
    firstInteractionAt: firstAt ?? undefined,
    lastInteractionAt: state.lastInteractionAt,
    userName: params.userName,
    clientTimeIso: params.clientTimeIso,
    recalls,
    facts,
    pendingProactive: pendingProactive
      ? { content: pendingProactive.content, createdAt: pendingProactive.createdAt }
      : null,
    intentions
  });
  const systemPrompt = promptResult.prompt;
  const intentionList = promptResult.intentions;

  const signedInlineImage = await signMediaUrlForModel(params.inlineImage, env, { ttlSeconds: 600 });
  const signedAttachments = await Promise.all(
    params.attachments.map(async (att) => {
      if (att.type !== 'image') return att;
      const signed = await signMediaUrlForModel(att.url, env, { ttlSeconds: 600 });
      return signed && signed !== att.url ? { ...att, url: signed } : att;
    })
  );

  const userContentParts = buildUserContentParts({
    content: sanitizeText(params.messageText),
    inlineImage: signedInlineImage,
    imageAttachments: signedAttachments.filter(a => a.type === 'image'),
    documentAttachments: signedAttachments.filter(a => a.type === 'document')
  });

  const messages: UpstreamMessage[] = [{ role: 'system', content: systemPrompt }];
  messages.push(...buildTwoDaysHistoryMessagesFromLogs({
    today: contextDate,
    todayLogs: historyPack.todayLogs,
    yesterday: historyPack.yesterdayDate,
    yesterdayLogs: historyPack.yesterdayLogs
  }) as UpstreamMessage[]);

  messages.push(
    userContentParts.length === 0
      ? { role: 'user', content: '[空消息]' }
      : userContentParts.length === 1 && userContentParts[0].type === 'text'
        ? { role: 'user', content: userContentParts[0].text ?? '' }
        : { role: 'user', content: userContentParts }
  );

  const finalText = await runInformationToolLoop(env, {
    messages,
    model: params.model,
    userId: params.userId,
    userName: params.userName,
    apiFormat: settings.chatApiFormat,
    apiUrl: settings.openaiApiUrl,
    apiKey: settings.openaiApiKey,
    temperature: settings.agentTemperature,
    maxTokens: settings.agentMaxTokens,
    timeoutMs: settings.agentTimeoutMs
  });

  const parsed = parseStructuredReply(finalText);
  if (!parsed.reply.trim()) throw new Error('empty_agent_reply');
  const replyText = sanitizeAssistantReply(parsed.reply).trim();
  if (!replyText) throw new Error('empty_agent_reply');

  const nextIntimacy = Math.max(-100, Math.min(100, touchedState.intimacy + (parsed.intimacyDelta || 0)));
  const matchedIntentionIds = matchSpokenIntentions(replyText, intentionList);
  return {
    reply: replyText,
    status: parsed.status
      ? {
          label: parsed.status.label,
          pillColor: parsed.status.pillColor,
          textColor: parsed.status.textColor,
          reason: parsed.status.reason ?? undefined
        }
      : { label: touchedState.statusLabel, pillColor: touchedState.statusPillColor, textColor: touchedState.statusTextColor },
    action: null,
    intimacy: nextIntimacy,
    usedPendingProactive: pendingProactive ? { id: pendingProactive.id, content: pendingProactive.content } : null,
    sideEffects: {
      userId: params.userId,
      statusUpdate: parsed.status,
      intimacyDelta: parsed.intimacyDelta || 0,
      rememberFacts: parsed.rememberFacts,
      forgetFacts: parsed.forgetFacts,
      finalReply: replyText,
      matchedIntentionIds
    }
  };
}

async function runInformationToolLoop(env: Env, params: {
  messages: UpstreamMessage[];
  model: string;
  userId: string;
  userName?: string;
  apiFormat: 'openai' | 'anthropic' | 'gemini';
  apiUrl: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}): Promise<string> {
  for (let i = 0; i < MAX_AGENT_LOOPS; i++) {
    const { message } = await callUpstreamChat(env, {
      format: params.apiFormat,
      apiUrl: params.apiUrl,
      apiKey: params.apiKey,
      model: params.model,
      messages: params.messages,
      tools: INFO_TOOLS,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      timeoutMs: params.timeoutMs,
      trace: { scope: 'agent', userId: params.userId, loop: i + 1 }
    });

    const toolCalls: OpenAiToolCall[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length) {
      console.log('[ATRI] agent_tool_calls', {
        userId: params.userId,
        loop: i + 1,
        tools: toolCalls.map(c => c.function?.name).filter(Boolean)
      });
      params.messages.push(buildAssistantToolMessageForContinuation(message));
      for (let j = 0; j < toolCalls.length; j++) {
        const call = toolCalls[j];
        const output = await executeInfoTool(env, call, params.userId, params.userName);
        params.messages.push({
          role: 'tool',
          tool_call_id: call.id || `tool_${Date.now()}_${j}`,
          name: call.function?.name,
          content: output
        });
      }
      continue;
    }

    const text = String(message.content || '').trim();
    if (text) return text;
    console.error('[ATRI] empty_llm_content', { userId: params.userId, loop: i + 1 });
    throw new Error('empty_agent_reply');
  }

  throw new Error('agent_loop_exhausted');
}

export async function applySideEffects(env: Env, plan: SideEffectPlan): Promise<void> {
  const now = Date.now();
  const state = await getUserState(env, plan.userId);
  let nextState = { ...state, lastInteractionAt: now, updatedAt: now };

  if (plan.statusUpdate) {
    nextState = await updateStatusState(env, {
      userId: plan.userId,
      label: plan.statusUpdate.label,
      pillColor: plan.statusUpdate.pillColor,
      textColor: plan.statusUpdate.textColor,
      reason: plan.statusUpdate.reason ?? undefined,
      currentState: nextState
    });
  } else {
    await saveUserState(env, nextState);
  }

  if (plan.intimacyDelta && plan.intimacyDelta !== 0) {
    try {
      await updateIntimacyState(env, {
        userId: plan.userId,
        delta: plan.intimacyDelta,
        reason: 'chat_delta',
        currentState: nextState
      });
    } catch (e) {
      console.warn('[ATRI] intimacy_update_failed', { userId: plan.userId, e });
    }
  }

  for (const f of plan.rememberFacts) {
    try {
      await upsertFactMemory(env, plan.userId, f.content, {
        type: f.type as any,
        importance: f.importance,
        confidence: f.confidence,
        source: 'chat'
      });
    } catch (e) {
      console.warn('[ATRI] fact_remember_failed', { userId: plan.userId, e });
    }
  }

  for (const f of plan.forgetFacts) {
    try {
      if (f.factId) {
        await archiveFactMemory(env, plan.userId, f.factId);
      } else if (f.content) {
        const norm = normalizeFactTextForMatch(f.content);
        const active = await getActiveFacts(env, plan.userId, 60);
        const hit = active.find(a => normalizeFactTextForMatch(a.text) === norm);
        if (hit) await archiveFactMemory(env, plan.userId, hit.id);
      }
    } catch (e) {
      console.warn('[ATRI] fact_forget_failed', { userId: plan.userId, e });
    }
  }

  for (const intentionId of plan.matchedIntentionIds || []) {
    try {
      await markIntentionUsed(env, plan.userId, intentionId);
    } catch (e) {
      console.warn('[ATRI] intention_mark_used_failed', { userId: plan.userId, intentionId, e });
    }
  }
}

async function safeFirstInteraction(env: Env, userId: string): Promise<number | null> {
  try { return await getFirstConversationTimestamp(env, userId); }
  catch (e) { console.warn('[ATRI] first_ts_failed', { userId, e }); return null; }
}

async function resolveConversationDateForChat(env: Env, params: {
  userId: string;
  clientTimeIso?: string;
  logId?: string;
}): Promise<string> {
  const logId = String(params.logId || '').trim();
  if (logId) {
    try {
      const d = await getConversationLogDate(env, params.userId, logId);
      if (d) return d;
    } catch (e) {
      console.warn('[ATRI] conversation_date_failed', { userId: params.userId, logId, e });
    }
  }
  return resolveDayStartTimestamp(params.clientTimeIso).localDate;
}

function normalizeFactTextForMatch(s: string): string {
  return sanitizeText(String(s || '')).trim().replace(/\s+/g, ' ');
}

async function safeListPendingIntentions(env: Env, userId: string, limit: number) {
  try {
    return await listPendingIntentions(env, userId, limit);
  } catch (e) {
    console.warn('[ATRI] list_pending_intentions_failed', { userId, e });
    return [];
  }
}

// 把字符串标准化为只含字母数字与中日韩文字的紧凑序列，方便做 n-gram 重叠
function normalizeForIntentionMatch(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function buildNGrams(text: string, n: number): string[] {
  if (text.length < n) return text ? [text] : [];
  const grams: string[] = [];
  for (let i = 0; i <= text.length - n; i++) {
    grams.push(text.slice(i, i + n));
  }
  return grams;
}

// 判断 reply 中是否说出了某条 intention：
// - intention 紧凑后 < 6 字时，整串包含即命中
// - 否则用 4-gram 重叠率 ≥ 0.5 判定（兼顾"自然说出"而非逐字复述）
function matchSpokenIntentions(
  reply: string,
  intentions: Array<{ id: string; content: string }>
): string[] {
  if (!Array.isArray(intentions) || !intentions.length) return [];
  const replyNorm = normalizeForIntentionMatch(reply);
  if (!replyNorm) return [];

  const matched: string[] = [];
  for (const it of intentions) {
    const contentNorm = normalizeForIntentionMatch(it.content);
    if (!contentNorm) continue;

    if (contentNorm.length < 6) {
      if (replyNorm.includes(contentNorm)) matched.push(it.id);
      continue;
    }

    const grams = buildNGrams(contentNorm, 4);
    if (!grams.length) continue;
    let hit = 0;
    for (const g of grams) {
      if (replyNorm.includes(g)) hit++;
    }
    const ratio = hit / grams.length;
    if (ratio >= 0.5) matched.push(it.id);
  }
  return matched;
}
