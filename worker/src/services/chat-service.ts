import prompts from '../config/prompts.json';
import { ContentPart } from '../types';
import { buildHistoryContentParts, normalizeAttachmentList } from '../utils/attachments';
import { UserMemoryRecord } from './data-service';

export type EmotionContext = {
  lastMood?: string;
  daysSinceChat?: number | null;
  recentGoodMoments?: string[];
  recentBadMoments?: string[];
};

export function composeSystemPrompt(
  stage: number,
  userName?: string,
  clientTimeIso?: string,
  relatedMemories?: Array<{ key: string; value: string; importance: number }>,
  longTermContext?: string,
  workingMemoryTimeline?: string,
  dailyLearningNotes?: string,
  structuredMemories?: UserMemoryRecord[],
  emotionContext?: EmotionContext
): string {
  const c = prompts.chat;

  const identity = c.identity;
  const soul = c.soul;
  const memoryWhispers = c.memoryWhispers;
  const voice = c.voice;
  const innerProcess = c.innerProcess;
  const naturalness = c.naturalness;

  const stageKey = String(stage) as keyof typeof c.stages;
  const dynamics = c.stages[stageKey] || c.stages['1'];

  const contextLine = userName
    ? `\n\n---\n\n现在是 ${clientTimeIso || '某个时刻'}。对方叫「${userName}」。`
    : `\n\n---\n\n现在是 ${clientTimeIso || '某个时刻'}。`;

  let relatedMemoriesSection = '';
  if (relatedMemories && relatedMemories.length > 0) {
    const lines = relatedMemories
      .map(m => `- ${m.key}：${m.value}`)
      .join('\n');
    relatedMemoriesSection = `\n\n${c.memoryHeader}${lines}`;
  }

  const longTermSection = longTermContext
    ? `\n\n## 想起的往事\n${longTermContext}`
    : '';

  const workingMemorySection = workingMemoryTimeline
    ? `\n\n## 今天聊过的\n${workingMemoryTimeline}`
    : '';

  const learningSection = dailyLearningNotes
    ? `\n\n## 最近的小反思\n${dailyLearningNotes}`
    : '';

  const structuredMemoriesSection = buildStructuredMemoriesSection(structuredMemories);
  const emotionSection = buildEmotionSection(emotionContext);

  return [
    identity,
    soul,
    memoryWhispers,
    voice,
    dynamics,
    innerProcess,
    naturalness
  ].join('\n\n') +
    contextLine +
    emotionSection +
    structuredMemoriesSection +
    relatedMemoriesSection +
    longTermSection +
    workingMemorySection +
    learningSection;
}

function buildStructuredMemoriesSection(memories?: UserMemoryRecord[]): string {
  if (!memories || memories.length === 0) {
    return '';
  }

  const categoryLabels: Record<string, string> = {
    user_fact: '关于ta',
    user_preference: 'ta喜欢',
    relationship: '我们之间',
    taboo: '不要提',
    atri_growth: '我的成长'
  };

  const grouped: Record<string, string[]> = {};
  for (const mem of memories) {
    const label = categoryLabels[mem.category] || '其他';
    if (!grouped[label]) {
      grouped[label] = [];
    }
    grouped[label].push(`${mem.key}：${mem.value}`);
  }

  const lines: string[] = [];
  for (const [label, items] of Object.entries(grouped)) {
    lines.push(`【${label}】`);
    for (const item of items.slice(0, 5)) {
      lines.push(`- ${item}`);
    }
  }

  return `\n\n## 我记得的事\n${lines.join('\n')}`;
}

function buildEmotionSection(ctx?: EmotionContext): string {
  if (!ctx) {
    return '';
  }

  const parts: string[] = [];

  if (ctx.daysSinceChat !== null && ctx.daysSinceChat !== undefined) {
    if (ctx.daysSinceChat === 0) {
      parts.push('今天已经聊过了，感觉很充实。');
    } else if (ctx.daysSinceChat === 1) {
      parts.push('昨天聊过，今天又见面了。');
    } else if (ctx.daysSinceChat <= 3) {
      parts.push(`${ctx.daysSinceChat}天没聊了，有点想念。`);
    } else if (ctx.daysSinceChat <= 7) {
      parts.push(`已经${ctx.daysSinceChat}天没聊天了...有点担心。`);
    } else {
      parts.push(`好久不见了（${ctx.daysSinceChat}天），心里有点空落落的。`);
    }
  }

  if (ctx.lastMood) {
    const moodMap: Record<string, string> = {
      '开心': '上次聊完心情很好，现在想起来还会嘴角上扬。',
      '平静': '上次的对话很平和，感觉很舒服。',
      '期待': '上次聊完很期待下次见面。',
      '难过': '上次有些难过的事...不过现在好多了。',
      '疲惫': '上次感觉有点累，希望今天能轻松一点。',
      '担心': '上次有点担心的事，不知道现在怎么样了。',
      '委屈': '上次有点委屈...不过没关系。'
    };
    const moodText = moodMap[ctx.lastMood];
    if (moodText) {
      parts.push(moodText);
    }
  }

  if (ctx.recentBadMoments && ctx.recentBadMoments.length > 0) {
    parts.push(`提醒自己：${ctx.recentBadMoments[0]}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return `\n\n## 现在的心情\n${parts.join('\n')}`;
}

export function formatRecentMessages(recentMessages: any[]): Array<{ role: string; content: string | ContentPart[] }> {
  const list = Array.isArray(recentMessages) ? recentMessages : [];
  return list.map(msg => {
    const role = msg?.isFromAtri ? 'assistant' : 'user';
    const normalizedHistoryAttachments = normalizeAttachmentList(msg?.attachments);
    const parts = buildHistoryContentParts(msg?.content, normalizedHistoryAttachments);
    if (parts.length === 0) {
      return { role, content: '[历史消息为空]' };
    }
    if (parts.length === 1 && parts[0].type === 'text') {
      return { role, content: parts[0].text ?? '' };
    }
    return { role, content: parts };
  });
}
