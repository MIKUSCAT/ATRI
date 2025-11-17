import prompts from '../config/prompts.json';
import { ContentPart } from '../types';
import { buildHistoryContentParts, normalizeAttachmentList } from '../utils/attachments';

export function composeSystemPrompt(
  stage: number,
  userName?: string,
  clientTimeIso?: string,
  relatedMemories?: Array<{ key: string; value: string; importance: number }>,
  longTermContext?: string,
  workingMemoryTimeline?: string
): string {
  const chatPrompts = prompts.chat;
  const base = chatPrompts.base;

  // 内心独白，替换客户端时间
  const innerThoughts = chatPrompts.innerThoughts
    .replace(/\{clientTimeIso\}/g, clientTimeIso || '时间未知');

  // 核心记忆碎片（作为背景信息注入）
  const coreMemoriesSection = '\n\n## 我的核心记忆\n\n' +
    chatPrompts.coreMemories.join('\n\n');

  // 当前对话对象
  const contextInfo = `\n\n---\n\n现在聊天的对象是：${userName || '这个人'}`;

  // 关系阶段
  const stageTxt: Record<number, string> = Object.fromEntries(
    Object.entries(chatPrompts.stages).map(([key, value]) => [Number(key), `\n\n${value}`])
  );

  // 相关记忆（Vector检索出的）
  let relatedMemoriesSection = '';
  if (relatedMemories && relatedMemories.length > 0) {
    const lines = relatedMemories
      .map(m => `- ${m.key}：${m.value}`)
      .join('\n');
    relatedMemoriesSection = `\n\n${chatPrompts.memoryHeader}${lines}`;
  }

  const longTermSection = longTermContext
    ? `\n\n## 想起的往事\n${longTermContext}`
    : '';

  const workingMemorySection = workingMemoryTimeline
    ? `\n\n## 今日对话流\n${workingMemoryTimeline}`
    : '';

  return base +
    coreMemoriesSection +
    '\n\n' + innerThoughts +
    contextInfo +
    (stageTxt[stage] || stageTxt[1]) +
    relatedMemoriesSection +
    longTermSection +
    workingMemorySection;
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
