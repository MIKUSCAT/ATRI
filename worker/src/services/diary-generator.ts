import { CHAT_MODEL, Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { callUpstreamChat, ChatCompletionError } from './llm-service';
import { getEffectiveRuntimeSettings } from './runtime-settings';
import { buildSystemPromptFor } from '../utils/prompt-builder';

export type DiaryFactCandidate = {
  content: string;
  type?: 'profile' | 'preference' | 'taboo' | 'promise' | 'relationship' | 'habit' | 'important' | 'other';
  importance?: number;
  confidence?: number;
};

export type DiaryEpisodicMemory = {
  title: string;
  content: string;
  emotion?: string;
  tags?: string[];
  importance?: number;
  confidence?: number;
  emotionalWeight?: number;
};

export type DiaryInnerThought = {
  content: string;
  triggerHint?: string;
  urgency?: number;
  emotionalWeight?: number;
  expiresInDays?: number;
};

export type DiaryGenerationResult = {
  content: string;
  timestamp: number;
  mood: string;
  highlights: string[];
  episodicMemories: DiaryEpisodicMemory[];
  factCandidates: DiaryFactCandidate[];
  innerThoughts: DiaryInnerThought[];
};

async function withRetry<T>(fn: () => Promise<T>, retries: number = 2, delayMs: number = 1000): Promise<T> {
  let lastError: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < retries) await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw lastError;
}

export async function generateDiaryFromConversation(env: Env, params: {
  conversation: string;
  userId?: string;
  userName?: string;
  date?: string;
  timestamp?: number;
  daysSinceLastChat?: number | null;
  modelKey?: string | null;
}) {
  const settings = await getEffectiveRuntimeSettings(env);
  const diaryPrompts: any = (settings.prompts as any).diary || {};

  const cleanedConversation = sanitizeText(params.conversation).trim();
  if (!cleanedConversation) throw new Error('empty_conversation');

  const timestamp = typeof params.timestamp === 'number' ? params.timestamp : Date.now();
  const dateKey = typeof params.date === 'string' ? params.date.trim() : '';
  const formattedDate = dateKey ? formatDiaryDateFromIsoDate(dateKey) : formatDiaryDate(timestamp);

  let daysSinceInfo = '';
  if (params.daysSinceLastChat === null || params.daysSinceLastChat === undefined) {
    daysSinceInfo = '\n\n这是我们第一次对话。';
  } else if (params.daysSinceLastChat >= 30) {
    daysSinceInfo = `\n\n距离上次对话已经过了 ${Math.floor(params.daysSinceLastChat / 30)} 个月。`;
  } else if (params.daysSinceLastChat >= 7) {
    daysSinceInfo = `\n\n距离上次对话已经过了 ${Math.floor(params.daysSinceLastChat / 7)} 周。`;
  } else if (params.daysSinceLastChat >= 2) {
    daysSinceInfo = `\n\n距离上次对话已经过了 ${params.daysSinceLastChat} 天。`;
  }

  const userPrompt = String(diaryPrompts.userTemplate || '')
    .replace(/\{timestamp\}/g, formattedDate)
    .replace(/\{userName\}/g, params.userName || '这个人')
    .replace(/\{conversation\}/g, cleanedConversation)
    .replace(/\{daysSinceInfo\}/g, daysSinceInfo);

  try {
    const apiUrl = String(settings.diaryApiUrl || settings.openaiApiUrl || '').trim();
    const apiKey = String(settings.diaryApiKey || settings.openaiApiKey || '').trim();
    const model = resolveDiaryModel(settings, params.modelKey);
    const result = await withRetry(() => callUpstreamChat(env, {
      format: settings.diaryApiFormat,
      apiUrl,
      apiKey,
      model,
      messages: [
        { role: 'system', content: buildSystemPromptFor('diary', settings) },
        { role: 'user', content: userPrompt }
      ],
      temperature: settings.diaryTemperature,
      maxTokens: settings.diaryMaxTokens,
      timeoutMs: 120000,
      trace: { scope: 'diary', userId: params.userId }
    }));

    const content = result.message?.content;
    const rawContent = typeof content === 'string' ? content : String(content || '');
    const parsed = parseDiaryResponse(rawContent);

    let finalContent = parsed.diary?.trim();
    if (!finalContent) {
      const trimmedRaw = String(rawContent || '').trim();
      const looksLikeStructured = /"diary"\s*:/.test(trimmedRaw) || trimmedRaw.startsWith('{') || trimmedRaw.startsWith('```');
      finalContent = !looksLikeStructured && trimmedRaw ? trimmedRaw : '日记生成数据异常。';
    }

    return {
      content: finalContent,
      timestamp,
      mood: parsed.mood || '',
      highlights: parsed.highlights || [],
      episodicMemories: parsed.episodicMemories || [],
      factCandidates: parsed.factCandidates || [],
      innerThoughts: parsed.innerThoughts || []
    } as DiaryGenerationResult;
  } catch (error) {
    if (error instanceof ChatCompletionError) throw error;
    throw new Error('diary_generation_failed');
  }
}

function resolveDiaryModel(settings: { diaryModel?: string; defaultChatModel?: string }, modelKey?: string | null) {
  const trimmed = typeof modelKey === 'string' ? modelKey.trim() : '';
  const configured = typeof settings.diaryModel === 'string' ? settings.diaryModel.trim() : '';
  const fallback = typeof settings.defaultChatModel === 'string' ? settings.defaultChatModel.trim() : '';
  return configured || trimmed || fallback || CHAT_MODEL;
}

function formatDiaryDate(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[date.getDay()];
  return `${year}年${month}月${day}日 ${weekday}`;
}

function formatDiaryDateFromIsoDate(dateStr: string) {
  const match = String(dateStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateStr || '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${year}年${month}月${day}日 ${weekdays[date.getUTCDay()]}`;
}

function parseDiaryResponse(raw: string): {
  diary?: string;
  highlights?: string[];
  mood?: string;
  episodicMemories?: DiaryEpisodicMemory[];
  factCandidates?: DiaryFactCandidate[];
  innerThoughts?: DiaryInnerThought[];
} {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return {};

  try {
    let jsonText = trimmed;
    if (jsonText.startsWith('```json')) jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    else if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');

    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(jsonText.slice(start, end + 1));
      return {
        diary: typeof parsed.diary === 'string' ? parsed.diary : undefined,
        highlights: normalizeStringArray(parsed.highlights, 10),
        mood: typeof parsed.mood === 'string' ? parsed.mood : undefined,
        episodicMemories: normalizeEpisodicMemories(parsed.episodicMemories),
        factCandidates: normalizeFactCandidates(parsed.factCandidates),
        innerThoughts: normalizeInnerThoughts(parsed.innerThoughts)
      };
    }
  } catch (err) {
    console.warn('[ATRI] Diary JSON parse failed, attempting partial extraction:', err);
  }

  const result: { diary?: string; highlights?: string[]; mood?: string } = {};
  const diaryMatch = trimmed.match(/"diary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (diaryMatch) {
    try { result.diary = JSON.parse(`"${diaryMatch[1]}"`); }
    catch { result.diary = diaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
  }
  const highlightsMatch = trimmed.match(/"highlights"\s*:\s*\[(.*?)\]/s);
  if (highlightsMatch) {
    try { result.highlights = JSON.parse(`[${highlightsMatch[1]}]`); }
    catch {
      const items = highlightsMatch[1].match(/"([^"]*)"/g);
      if (items) result.highlights = items.map(item => item.slice(1, -1));
    }
  }
  const moodMatch = trimmed.match(/"mood"\s*:\s*"([^"]*)"/);
  if (moodMatch) result.mood = moodMatch[1];
  return result;
}

function normalizeStringArray(value: unknown, max: number) {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(v => sanitizeText(String(v || '')).trim()).filter(Boolean).slice(0, max);
  return items.length ? items : undefined;
}

function normalizeEpisodicMemories(value: unknown): DiaryEpisodicMemory[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((raw: any) => ({
    title: sanitizeText(String(raw?.title || '')).trim(),
    content: sanitizeText(String(raw?.content || '')).trim(),
    emotion: sanitizeText(String(raw?.emotion || '')).trim() || undefined,
    tags: Array.isArray(raw?.tags) ? raw.tags.map((t: unknown) => sanitizeText(String(t || '')).trim()).filter(Boolean).slice(0, 8) : undefined,
    importance: clampNumber(raw?.importance, 1, 10, 5),
    confidence: clampNumber(raw?.confidence, 0.1, 1, 0.8),
    emotionalWeight: clampNumber(raw?.emotionalWeight ?? raw?.emotional_weight, 1, 10, 5)
  })).filter(item => item.title && item.content).slice(0, 8);
  return items.length ? items : undefined;
}

function normalizeFactCandidates(value: unknown): DiaryFactCandidate[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set(['profile', 'preference', 'taboo', 'promise', 'relationship', 'habit', 'important', 'other']);
  const items = value.map((raw: any) => {
    const type = String(raw?.type || 'other').trim();
    return {
      content: sanitizeText(String(raw?.content || '')).trim(),
      type: allowed.has(type) ? type as any : 'other',
      importance: clampNumber(raw?.importance, 1, 10, 6),
      confidence: clampNumber(raw?.confidence, 0.1, 1, 0.75)
    };
  }).filter(item => item.content).slice(0, 8);
  return items.length ? items : undefined;
}

function normalizeInnerThoughts(value: unknown): DiaryInnerThought[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((raw: any) => ({
    content: sanitizeText(String(raw?.content || '')).trim(),
    triggerHint: sanitizeText(String(raw?.triggerHint || raw?.trigger_hint || '')).trim() || undefined,
    urgency: clampNumber(raw?.urgency, 1, 10, 5),
    emotionalWeight: clampNumber(raw?.emotionalWeight ?? raw?.emotional_weight, 1, 10, 5),
    expiresInDays: clampNumber(raw?.expiresInDays ?? raw?.expires_in_days, 1, 30, 7)
  })).filter(item => item.content).slice(0, 5);
  return items.length ? items : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
