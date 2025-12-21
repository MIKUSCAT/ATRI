import prompts from '../config/prompts.json';
import { Env, CHAT_MODEL } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { callChatCompletions, ChatCompletionError } from './openai-service';

const selfReviewPrompts: any = (prompts as any).selfReview || {};

const DIMENSIONS = ['语气', '长度', '提问方式', '共情回应', '主动程度', '口癖重复'] as const;
type Dimension = (typeof DIMENSIONS)[number];

export type AtriSelfReviewRow = {
  "维度": Dimension;
  "今天": string;
  "问题": string;
  "改进": string;
};

export type AtriSelfReviewPayload = {
  "日期": string;
  "认识天数": number;
  "表格": AtriSelfReviewRow[];
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
  const previous = sanitizeText(params.previousSelfReview || '').trim() || '(无旧自查表)';

  if (!transcript && !diary) {
    throw new Error('empty_self_review_material');
  }

  const systemPrompt = String(selfReviewPrompts.system || '').trim();
  const userTemplate = String(selfReviewPrompts.userTemplate || '').trim();
  const userPrompt = userTemplate
    .replace(/\{date\}/g, params.date)
    .replace(/\{daysTogether\}/g, String(Math.max(1, Math.trunc(params.daysTogether || 1))))
    .replace(/\{userName\}/g, params.userName || '这个人')
    .replace(/\{previousSelfReview\}/g, previous)
    .replace(/\{transcript\}/g, transcript || '(无对话记录)')
    .replace(/\{diary\}/g, diary || '(无日记内容)');

  const diaryApiUrl = typeof env.DIARY_API_URL === 'string' ? env.DIARY_API_URL.trim() : '';
  const diaryApiKey = typeof env.DIARY_API_KEY === 'string' ? env.DIARY_API_KEY.trim() : '';
  const model = resolveSelfReviewModel(env, params.modelKey);

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
    "表格": DIMENSIONS.map((dim) => ({
      "维度": dim,
      "今天": "",
      "问题": "",
      "改进": ""
    }))
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
  const rows = Array.isArray(input?.["表格"]) ? input["表格"] : [];
  const map = new Map<Dimension, AtriSelfReviewRow>();
  for (const row of base["表格"]) {
    map.set(row["维度"], { ...row });
  }

  for (const rawRow of rows) {
    const dim = String(rawRow?.["维度"] || '').trim() as Dimension;
    if (!map.has(dim)) continue;
    const target = map.get(dim)!;
    target["今天"] = cleanCell(rawRow?.["今天"], 80);
    target["问题"] = cleanCell(rawRow?.["问题"], 80);
    target["改进"] = cleanCell(rawRow?.["改进"], 120);
  }

  return {
    ...base,
    "表格": DIMENSIONS.map((dim) => map.get(dim)!).filter(Boolean)
  };
}

function cleanCell(value: any, limit: number) {
  return String(value || '').trim().slice(0, limit);
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

