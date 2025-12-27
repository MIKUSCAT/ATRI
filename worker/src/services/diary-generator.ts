import prompts from '../config/prompts.json';
import { Env, CHAT_MODEL } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { ChatCompletionError } from './openai-service';
import { callChatCompletionsUnified } from './gemini-service';

const diaryPrompts = prompts.diary;

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
  userName?: string;
  timestamp?: number;
  daysSinceLastChat?: number | null;
  modelKey?: string | null;
}) {
  const cleanedConversation = sanitizeText(params.conversation).trim();
  if (!cleanedConversation) {
    throw new Error('empty_conversation');
  }

  // 移除 4000 字符限制，允许读取完整对话
  const limitedConversation = cleanedConversation;

  const timestamp = typeof params.timestamp === 'number' ? params.timestamp : Date.now();
  const formattedDate = formatDiaryDate(timestamp);

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

  const userPrompt = diaryPrompts.userTemplate
    .replace(/\{timestamp\}/g, formattedDate)
    .replace(/\{userName\}/g, params.userName || '这个人')
    .replace(/\{conversation\}/g, limitedConversation)
    .replace(/\{daysSinceInfo\}/g, daysSinceInfo);
  try {
    const diaryApiUrl = typeof env.DIARY_API_URL === 'string' ? env.DIARY_API_URL.trim() : '';
    const diaryApiKey = typeof env.DIARY_API_KEY === 'string' ? env.DIARY_API_KEY.trim() : '';
    const response = await withRetry(() => callChatCompletionsUnified(
      env,
      {
        messages: [
          { role: 'system', content: diaryPrompts.system },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      },
      {
        model: resolveDiaryModel(env, params.modelKey),
        apiUrl: diaryApiUrl || undefined,
        apiKey: diaryApiKey || undefined,
        timeoutMs: 120000
      }
    ));

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    const parsed = parseDiaryResponse(rawContent);

    // 兜底逻辑：如果解析不到日记内容，说明 JSON 格式有问题或被截断
    let finalContent = parsed.diary?.trim();
    if (!finalContent) {
      const trimmedRaw = rawContent.trim();
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

    // 兜底逻辑：如果解析不到心情，留空（不再做正则匹配）
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

function resolveDiaryModel(env: Env, modelKey?: string | null) {
  const trimmed = typeof modelKey === 'string' ? modelKey.trim() : '';
  const envModel = typeof env.DIARY_MODEL === 'string' ? env.DIARY_MODEL.trim() : '';
  return trimmed || envModel || CHAT_MODEL;
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

function parseDiaryResponse(raw: string): { diary?: string; highlights?: string[]; mood?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  // 首先尝试标准 JSON 解析
  try {
    // 移除可能存在的 Markdown 代码块标记
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
    // JSON 解析失败，尝试部分提取
    console.warn('[ATRI] JSON parse failed, attempting partial extraction:', err);
  }

  // 如果标准解析失败，尝试用正则提取 diary 字段（应对 JSON 截断）
  const result: { diary?: string; highlights?: string[]; mood?: string } = {};

  // 提取 diary 字段
  const diaryMatch = trimmed.match(/"diary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (diaryMatch) {
    try {
      // 尝试还原转义字符
      result.diary = JSON.parse(`"${diaryMatch[1]}"`);
    } catch {
      result.diary = diaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }

  // 提取 highlights 数组
  const highlightsMatch = trimmed.match(/"highlights"\s*:\s*\[(.*?)\]/s);
  if (highlightsMatch) {
    try {
      const highlightsJson = `[${highlightsMatch[1]}]`;
      result.highlights = JSON.parse(highlightsJson);
    } catch {
      // 手动提取字符串
      const items = highlightsMatch[1].match(/"([^"]*)"/g);
      if (items) {
        result.highlights = items.map(item => item.slice(1, -1));
      }
    }
  }

  // 提取 mood 字段
  const moodMatch = trimmed.match(/"mood"\s*:\s*"([^"]*)"/);
  if (moodMatch) {
    result.mood = moodMatch[1];
  }

  return result;
}
