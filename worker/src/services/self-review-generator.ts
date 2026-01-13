import prompts from '../config/prompts.json';
import { Env, CHAT_MODEL } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { callChatCompletions, ChatCompletionError } from './openai-service';

const stickyNotePrompts: any = (prompts as any).stickyNote || {};

export type AtriSelfReviewPayload = {
  "日期": string;
  "认识天数": number;
  "便签": string[];
};

export type AtriSelfReviewGenerationResult = {
  raw: string;
  payload: AtriSelfReviewPayload;
};

export async function generateAtriSelfReview(env: Env, params: {
  transcript: string;
  diaryContent: string;
  date: string;
  daysTogether: number;
  userName?: string;
  previousSelfReview?: string;
  modelKey?: string | null;
}): Promise<AtriSelfReviewGenerationResult> {
  const transcript = sanitizeText(params.transcript || '').trim();
  const diary = sanitizeText(params.diaryContent || '').trim();
  const previous = sanitizeText(params.previousSelfReview || '').trim() || '(无旧便签)';

  if (!transcript && !diary) {
    throw new Error('empty_self_review_material');
  }

  const systemPrompt = String(stickyNotePrompts.system || '').trim();
  const userTemplate = String(stickyNotePrompts.userTemplate || '').trim();
  const userPrompt = userTemplate
    .replace(/\{date\}/g, params.date)
    .replace(/\{daysTogether\}/g, String(Math.max(1, Math.trunc(params.daysTogether || 1))))
    .replace(/\{userName\}/g, params.userName || '这个人')
    .replace(/\{previousSelfReview\}/g, previous)
    .replace(/\{transcript\}/g, transcript || '(无对话记录)')
    .replace(/\{diary\}/g, diary || '(无日记内容)');

  const diaryApiUrl = typeof env.DIARY_API_URL === 'string' ? env.DIARY_API_URL.trim() : '';
  const diaryApiKey = typeof env.DIARY_API_KEY === 'string' ? env.DIARY_API_KEY.trim() : '';
  // 如果配置了专用的日记 API，则不使用用户偏好模型，避免模型与 API 不匹配
  const useCustomDiaryApi = !!(diaryApiUrl && diaryApiKey);
  const model = useCustomDiaryApi
    ? resolveSelfReviewModel(env, null)
    : resolveSelfReviewModel(env, params.modelKey);

  try {
    const response = await callChatCompletions(
      env,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2
      },
      {
        model,
        apiUrl: diaryApiUrl || undefined,
        apiKey: diaryApiKey || undefined,
        timeoutMs: 90000
      }
    );

    const data = await response.json();
    const rawText = extractMessageContent(data?.choices?.[0]);
    const trimmed = rawText.trim();
    const base = emptyPayload(params.date, params.daysTogether);

    if (!trimmed) {
      return { raw: JSON.stringify(base), payload: base };
    }

    const parsed = parseSelfReviewJson(trimmed);
    const payload = normalizeSelfReviewPayload(parsed, base);
    return { raw: JSON.stringify(payload), payload };
  } catch (error) {
    if (error instanceof ChatCompletionError) {
      throw error;
    }
    throw new Error('self_review_generation_failed');
  }
}

function resolveSelfReviewModel(env: Env, modelKey?: string | null) {
  const trimmed = typeof modelKey === 'string' ? modelKey.trim() : '';
  const envModel = typeof env.DIARY_MODEL === 'string' ? env.DIARY_MODEL.trim() : '';
  return trimmed || envModel || CHAT_MODEL;
}

function emptyPayload(date: string, daysTogether: number): AtriSelfReviewPayload {
  return {
    "日期": date,
    "认识天数": Math.max(1, Math.trunc(daysTogether || 1)),
    "便签": []
  };
}

function parseSelfReviewJson(raw: string): any {
  let text = (raw || '').trim();
  if (!text) return {};

  if (text.startsWith('```json')) {
    text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (text.startsWith('```')) {
    text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    const maybe = text.slice(start, end + 1);
    try {
      return JSON.parse(maybe);
    } catch (err) {
      console.warn('[ATRI] selfReview JSON parse failed', err);
    }
  }
  return {};
}

function normalizeSelfReviewPayload(input: any, base: AtriSelfReviewPayload): AtriSelfReviewPayload {
  const list = Array.isArray(input?.["便签"]) ? input["便签"] : [];
  const notes: string[] = [];
  for (const item of list) {
    const text = cleanCell(item, 40);
    if (!text) continue;
    notes.push(text);
    if (notes.length >= 3) break;
  }

  return {
    ...base,
    "便签": notes
  };
}

function cleanCell(value: any, limit: number) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function extractMessageContent(choice: any): string {
  if (!choice || !choice.message) {
    return '';
  }
  const content = choice.message.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
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
