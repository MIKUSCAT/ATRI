import prompts from '../config/prompts.json';
import { Env, CHAT_MODEL } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { ChatCompletionError } from './openai-service';
import { callChatCompletionsUnified } from './gemini-service';

const profilePrompts: any = (prompts as any).profile || {};

export type UserProfilePayload = {
  "事实": string[];
  "喜好": string[];
  "雷区": string[];
  "说话风格": string[];
  "关系进展": string[];
};

export type UserProfileGenerationResult = {
  raw: string;
  payload: UserProfilePayload;
};

export async function generateUserProfile(env: Env, params: {
  transcript: string;
  diaryContent: string;
  date: string;
  userName?: string;
  previousProfile?: string;
  modelKey?: string | null;
}): Promise<UserProfileGenerationResult> {
  const transcript = sanitizeText(params.transcript || '').trim();
  const diary = sanitizeText(params.diaryContent || '').trim();
  const previous = sanitizeText(params.previousProfile || '').trim() || '(无旧档案)';

  if (!transcript && !diary) {
    throw new Error('empty_profile_material');
  }

  const systemPrompt = String(profilePrompts.system || '').trim();
  const userTemplate = String(profilePrompts.userTemplate || '').trim();
  const userPrompt = userTemplate
    .replace(/\{date\}/g, params.date)
    .replace(/\{userName\}/g, params.userName || '这个人')
    .replace(/\{previousProfile\}/g, previous)
    .replace(/\{transcript\}/g, transcript || '(无对话记录)')
    .replace(/\{diary\}/g, diary || '(无日记内容)');

  const diaryApiUrl = typeof env.DIARY_API_URL === 'string' ? env.DIARY_API_URL.trim() : '';
  const diaryApiKey = typeof env.DIARY_API_KEY === 'string' ? env.DIARY_API_KEY.trim() : '';
  const model = resolveProfileModel(env, params.modelKey);

  try {
    const response = await callChatCompletionsUnified(
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

    if (!trimmed) {
      const payload = emptyPayload();
      return { raw: JSON.stringify(payload), payload };
    }

    const parsed = parseProfileJson(trimmed);
    const payload = normalizeProfilePayload(parsed);
    return { raw: JSON.stringify(payload), payload };
  } catch (error) {
    if (error instanceof ChatCompletionError) {
      throw error;
    }
    throw new Error('profile_generation_failed');
  }
}

function resolveProfileModel(env: Env, modelKey?: string | null) {
  const trimmed = typeof modelKey === 'string' ? modelKey.trim() : '';
  const envModel = typeof env.DIARY_MODEL === 'string' ? env.DIARY_MODEL.trim() : '';
  return trimmed || envModel || CHAT_MODEL;
}

function parseProfileJson(raw: string): any {
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
      console.warn('[ATRI] profile JSON parse failed', err);
    }
  }
  return {};
}

function normalizeProfilePayload(input: any): UserProfilePayload {
  const base = emptyPayload();
  for (const key of Object.keys(base) as Array<keyof UserProfilePayload>) {
    const arr = Array.isArray(input?.[key]) ? input[key] : [];
    base[key] = arr
      .map((item: any) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 6);
  }
  return base;
}

function emptyPayload(): UserProfilePayload {
  return {
    "事实": [],
    "喜好": [],
    "雷区": [],
    "说话风格": [],
    "关系进展": []
  };
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
