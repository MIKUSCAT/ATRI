import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { callChatCompletions, ChatCompletionError } from './openai-service';

export type DailyLearningResult = {
  summary: string;
  payload: any;
  raw: string;
};

export async function generateDailyLearning(env: Env, params: {
  transcript: string;
  diaryContent: string;
  date: string;
  userName?: string;
  modelKey?: string | null;
}) {
  const transcript = sanitizeText(params.transcript || '').trim();
  const diary = sanitizeText(params.diaryContent || '').trim();
  if (!transcript && !diary) {
    throw new Error('empty_learning_material');
  }

  const systemPrompt = [
    '你是亚托莉写给自己的「对话复盘教练」。',
    '请用今天的对话记录 + 今天的日记，输出一份严格的 JSON，总结今天和用户的相处效果，并写下明天的改进计划。',
    '不要说客套话，只要干货，句子要短，直白。',
    '字段说明：',
    '- date: 字符串，今天的日期。',
    '- user_talk_summary.overall_tone: 用一句话描述今天用户总体语气/情绪。',
    '- user_talk_summary.key_events: 2-4 条今天用户提到的关键事件或观点。',
    '- self_reflection.format_issue: 2-4 条自己说话里「格式化/套话/太长」的问题，引用具体句式。',
    '- self_reflection.good_moments: 2-4 条今天说得好的片段，具体到做法或句子。',
    '- self_reflection.bad_moments: 2-4 条今天说得不好的片段，具体到做法或句子。',
    '- tomorrow_plan.do_more: 2-4 条明天要多做的说话方式。',
    '- tomorrow_plan.do_less: 2-4 条明天要少做或避免的句式。',
    '- tomorrow_plan.experiments: 1-3 条明天想尝试的新表达方式。',
    '务必返回合法 JSON，不要加额外说明。'
  ].join('\n');

  const userPrompt = [
    `今天是：${params.date}`,
    params.userName ? `今天对话的对象：${params.userName}` : '',
    '',
    '【今日对话摘要】',
    transcript || '(无对话记录)',
    '',
    '【今日日记】',
    diary || '(无日记内容)' 
  ].join('\n');

  try {
    const response = await callChatCompletions(
      env,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1200
      },
      { model: params.modelKey || undefined }
    );

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const payload = parseLearningJson(raw);
    const summary = buildLearningSummary(payload);

    return { summary, payload, raw } as DailyLearningResult;
  } catch (error) {
    if (error instanceof ChatCompletionError) {
      throw error;
    }
    throw new Error('learning_generation_failed');
  }
}

function parseLearningJson(raw: string) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return {};

  let text = trimmed;
  if (text.startsWith('```json')) {
    text = text.replace(/^```json\s*/, '').replace(/```$/, '');
  } else if (text.startsWith('```')) {
    text = text.replace(/^```\s*/, '').replace(/```$/, '');
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    const maybe = text.slice(start, end + 1);
    try {
      return JSON.parse(maybe);
    } catch (err) {
      console.warn('[ATRI] daily learning JSON parse failed, raw kept', err);
    }
  }
  return { raw: text };
}

function buildLearningSummary(payload: any): string {
  if (!payload || typeof payload !== 'object') {
    return '今日复盘：暂无有效数据';
  }
  const date = payload.date || '';
  const bad = Array.isArray(payload?.self_reflection?.bad_moments)
    ? payload.self_reflection.bad_moments.slice(0, 1)[0]
    : '';
  const plan = Array.isArray(payload?.tomorrow_plan?.do_less)
    ? payload.tomorrow_plan.do_less.slice(0, 1)[0]
    : '';
  const good = Array.isArray(payload?.self_reflection?.good_moments)
    ? payload.self_reflection.good_moments.slice(0, 1)[0]
    : '';

  const parts = [date ? `日期：${date}` : '', good ? `亮点：${good}` : '', bad ? `问题：${bad}` : '', plan ? `明天少做：${plan}` : '']
    .filter(Boolean);
  return parts.length ? parts.join('；') : '今日复盘：请明天继续观察';
}
