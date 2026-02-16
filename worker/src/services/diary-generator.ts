import { CHAT_MODEL, Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { ChatCompletionError } from './openai-service';
import { callUpstreamChat } from './llm-service';
import { getEffectiveRuntimeSettings } from './runtime-settings';

export type DiaryGenerationResult = {
  content: string;
  timestamp: number;
  mood: string;
  highlights: string[];
};

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 2,
  delayMs: number = 1000
): Promise<T> {
  let lastError: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < retries) {
        await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
      }
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
  if (!cleanedConversation) {
    throw new Error('empty_conversation');
  }

  const limitedConversation = cleanedConversation;

  const timestamp = typeof params.timestamp === 'number' ? params.timestamp : Date.now();
  const dateKey = typeof params.date === 'string' ? params.date.trim() : '';
  const formattedDate = dateKey ? formatDiaryDateFromIsoDate(dateKey) : formatDiaryDate(timestamp);

  let daysSinceInfo = '';
  if (params.daysSinceLastChat === null || params.daysSinceLastChat === undefined) {
    daysSinceInfo = '\n\n这是我们第一次对话。';
  } else if (params.daysSinceLastChat >= 30) {
    const months = Math.floor(params.daysSinceLastChat / 30);
    daysSinceInfo = `\n\n距离上次对话已经过了 ${months} 个月。`;
  } else if (params.daysSinceLastChat >= 7) {
    const weeks = Math.floor(params.daysSinceLastChat / 7);
    daysSinceInfo = `\n\n距离上次对话已经过了 ${weeks} 周。`;
  } else if (params.daysSinceLastChat >= 2) {
    daysSinceInfo = `\n\n距离上次对话已经过了 ${params.daysSinceLastChat} 天。`;
  }

  const userPrompt = String(diaryPrompts.userTemplate || '')
    .replace(/\{timestamp\}/g, formattedDate)
    .replace(/\{userName\}/g, params.userName || '这个人')
    .replace(/\{conversation\}/g, limitedConversation)
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
        { role: 'system', content: String(diaryPrompts.system || '') },
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
      const looksLikeStructured =
        /"diary"\s*:/.test(trimmedRaw) ||
        trimmedRaw.startsWith('{') ||
        trimmedRaw.startsWith('```');

      if (!looksLikeStructured && trimmedRaw) {
        finalContent = trimmedRaw;
      } else {
        finalContent = '日记生成数据异常。';
      }
    }

    const finalMood = parsed.mood || '';

    return {
      content: finalContent,
      timestamp,
      mood: finalMood,
      highlights: parsed.highlights || []
    } as DiaryGenerationResult;
  } catch (error) {
    if (error instanceof ChatCompletionError) {
      throw error;
    }
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
  if (!match) {
    return dateStr || '';
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[date.getUTCDay()];
  return `${year}年${month}月${day}日 ${weekday}`;
}

function parseDiaryResponse(raw: string): { diary?: string; highlights?: string[]; mood?: string } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return {};
  }

  try {
    let jsonText = trimmed;
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');

    if (start !== -1 && end !== -1) {
      const extracted = jsonText.slice(start, end + 1);
      const parsed = JSON.parse(extracted);

      return {
        diary: typeof parsed.diary === 'string' ? parsed.diary : undefined,
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights : undefined,
        mood: typeof parsed.mood === 'string' ? parsed.mood : undefined
      };
    }
  } catch (err) {
    console.warn('[ATRI] JSON parse failed, attempting partial extraction:', err);
  }

  const result: { diary?: string; highlights?: string[]; mood?: string } = {};

  const diaryMatch = trimmed.match(/"diary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (diaryMatch) {
    try {
      result.diary = JSON.parse(`"${diaryMatch[1]}"`);
    } catch {
      result.diary = diaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }

  const highlightsMatch = trimmed.match(/"highlights"\s*:\s*\[(.*?)\]/s);
  if (highlightsMatch) {
    try {
      const highlightsJson = `[${highlightsMatch[1]}]`;
      result.highlights = JSON.parse(highlightsJson);
    } catch {
      const items = highlightsMatch[1].match(/"([^"]*)"/g);
      if (items) {
        result.highlights = items.map(item => item.slice(1, -1));
      }
    }
  }

  const moodMatch = trimmed.match(/"mood"\s*:\s*"([^"]*)"/);
  if (moodMatch) {
    result.mood = moodMatch[1];
  }

  return result;
}
