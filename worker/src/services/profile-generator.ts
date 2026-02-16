import { CHAT_MODEL, Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { ChatCompletionError } from './openai-service';
import { callUpstreamChat } from './llm-service';
import { getEffectiveRuntimeSettings } from './runtime-settings';

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
  userId?: string;
  transcript: string;
  diaryContent: string;
  date: string;
  userName?: string;
  previousProfile?: string;
  modelKey?: string | null;
}): Promise<UserProfileGenerationResult> {
  const settings = await getEffectiveRuntimeSettings(env);
  const profilePrompts: any = (settings.prompts as any).profile || {};

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

  const apiUrl = String(settings.diaryApiUrl || settings.openaiApiUrl || '').trim();
  const apiKey = String(settings.diaryApiKey || settings.openaiApiKey || '').trim();
  const model = resolveProfileModel(settings, params.modelKey);

  try {
    const result = await callUpstreamChat(env, {
      format: settings.diaryApiFormat,
      apiUrl,
      apiKey,
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: settings.profileTemperature,
      maxTokens: 1024,
      timeoutMs: 90000,
      trace: { scope: 'profile', userId: params.userId }
    });

    const content = result.message?.content;
    const rawText = typeof content === 'string' ? content : String(content || '');
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

function resolveProfileModel(settings: { diaryModel?: string; defaultChatModel?: string }, modelKey?: string | null) {
  const trimmed = typeof modelKey === 'string' ? modelKey.trim() : '';
  const configured = typeof settings.diaryModel === 'string' ? settings.diaryModel.trim() : '';
  const fallback = typeof settings.defaultChatModel === 'string' ? settings.defaultChatModel.trim() : '';
  return configured || trimmed || fallback || CHAT_MODEL;
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
