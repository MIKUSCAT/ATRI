import prompts from '../config/prompts.json';
import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { callChatCompletions, ChatCompletionError } from './openai-service';

const diaryPrompts = prompts.diary;

export type DiaryGenerationResult = {
  content: string;
  timestamp: number;
  mood: string;
  highlights: string[];
};

export async function generateDiaryFromConversation(env: Env, params: {
  conversation: string;
  userName?: string;
  timestamp?: number;
  daysSinceLastChat?: number | null;
}) {
  const cleanedConversation = sanitizeText(params.conversation).trim();
  if (!cleanedConversation) {
    throw new Error('empty_conversation');
  }

  const limitedConversation =
    cleanedConversation.length > 4000
      ? cleanedConversation.slice(cleanedConversation.length - 4000)
      : cleanedConversation;

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
    const response = await callChatCompletions(env, {
      messages: [
        { role: 'system', content: diaryPrompts.system },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const data = await response.json();
    const diaryContent = data.choices?.[0]?.message?.content || '';
    const parsed = parseDiaryResponse(diaryContent);
    const finalContent = parsed.diary?.trim() || diaryContent.trim();
    const highlightList = Array.isArray(parsed.highlights)
      ? parsed.highlights
        .map(item => typeof item === 'string' ? item.trim() : '')
        .filter(item => item.length > 0)
      : [];
    return {
      content: finalContent,
      timestamp,
      mood: detectMoodFromDiary(finalContent),
      highlights: highlightList
    } as DiaryGenerationResult;
  } catch (error) {
    if (error instanceof ChatCompletionError) {
      throw error;
    }
    throw new Error('diary_generation_failed');
  }
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

function detectMoodFromDiary(content: string): string {
  const text = content || '';
  const normalized = text.replace(/\s+/g, '');
  const moodRules: Array<{ keyword: RegExp; label: string }> = [
    { keyword: /开心|高兴|愉快|雀跃/, label: '开心' },
    { keyword: /安心|踏实|宁静|平静/, label: '平静' },
    { keyword: /累|疲惫|疲倦|困/, label: '疲惫' },
    { keyword: /担心|焦虑|不安/, label: '担心' },
    { keyword: /难过|失落|想哭|委屈|心疼/, label: '难过' },
    { keyword: /兴奋|期待|激动/, label: '期待' }
  ];
  for (const rule of moodRules) {
    if (rule.keyword.test(normalized)) {
      return rule.label;
    }
  }
  return '平静';
}

function parseDiaryResponse(raw: string): { diary?: string; highlights?: string[] } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    const jsonText = start !== -1 && end !== -1 ? trimmed.slice(start, end + 1) : trimmed;
    const parsed = JSON.parse(jsonText);
    return {
      diary: typeof parsed.diary === 'string' ? parsed.diary : undefined,
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : undefined
    };
  } catch {
    return {};
  }
}
