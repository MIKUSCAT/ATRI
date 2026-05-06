import type { Env } from '../types';
import { DEFAULT_TIMEZONE, formatTimeInZone } from '../utils/date';
import { sanitizeText } from '../utils/sanitize';
import { fetchConversationLogs, getDiaryEntry } from './data-service';
import { searchMemoryVectors } from './memory-service';
import type { OpenAiToolCall } from './llm-service';
import { webSearch } from './web-search-service';

export const INFO_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_diary',
      description: '翻开那天的日记。那是我亲手写的——那天发生了什么、我当时在想什么，都在里面。',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: '想看哪天的日记，YYYY-MM-DD' } },
        required: ['date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_conversation',
      description: '翻出那天的聊天记录。当时到底说了什么，原话是什么，看一眼就清楚了。',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: '想看哪天的记录，YYYY-MM-DD' } },
        required: ['date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '在脑海里找一找。能翻出相关的日期和片段——片段不够清楚的话，我会再去看日记或聊天记录确认。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '想找的内容' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '去外面查一下。有些事光凭记忆我拿不准，确认过了再说比较安心。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '想查什么' } },
        required: ['query']
      }
    }
  }
];

export async function executeInfoTool(
  env: Env,
  call: OpenAiToolCall,
  userId: string,
  userName?: string
): Promise<string> {
  const name = String(call?.function?.name || '').trim();
  let args: any = {};
  try {
    args = JSON.parse(call?.function?.arguments || '{}');
  } catch {
    args = {};
  }

  if (name === 'read_diary') return runReadDiary(env, userId, args);
  if (name === 'read_conversation') return runReadConversation(env, userId, userName, args);
  if (name === 'search_memory') return runSearchMemory(env, userId, args);
  if (name === 'web_search') return runWebSearch(env, args);
  return `未知工具：${name}`;
}

async function runReadDiary(env: Env, userId: string, args: any) {
  const timeRange = sanitizeText(String(args?.date || args?.time_range || '').trim());
  const query = sanitizeText(String(args?.query || '').trim());
  const isoDateMatch = timeRange.match(/^(\d{4}-\d{2}-\d{2})$/);

  if (isoDateMatch) {
    const date = isoDateMatch[1];
    try {
      const entry = await getDiaryEntry(env, userId, date);
      if (!entry) return `那天（${date}）还没有日记。`;
      if (entry.status !== 'ready') return `那天（${date}）的日记还没准备好（${entry.status}）。`;
      const content = String(entry.content || entry.summary || '').trim();
      if (!content) return `那天（${date}）有日记，但内容为空。`;
      return [
        '提示：以下内容来自亚托莉自己写的第一人称日记；文中的“我”=亚托莉，“你/对方”=用户。',
        `【${date}｜亚托莉日记】${content}`
      ].join('\n\n');
    } catch (error) {
      console.warn('[ATRI] read_diary_failed', { userId, date, error });
      return '读取日记时出错';
    }
  }

  if (query) return '如果你不确定日期，请先用 search_memory(query) 找到相关日期/片段，再用 read_diary(date) 查看完整日记。';
  return '请给我 date=YYYY-MM-DD。';
}

async function runReadConversation(env: Env, userId: string, userName: string | undefined, args: any) {
  const date = sanitizeText(String(args?.date || '').trim());
  const isoDateMatch = date.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (!isoDateMatch) return '请给我 date=YYYY-MM-DD。';
  const targetDate = isoDateMatch[1];

  try {
    const logs = await fetchConversationLogs(env, userId, targetDate);
    if (!logs.length) return `那天（${targetDate}）没有聊天记录。`;

    const fallbackUserName = (userName || '').trim() || '你';
    const lines: string[] = [`那天（${targetDate}）的聊天记录：`];
    for (const log of logs) {
      const zone = (log?.timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
      const timeText = typeof log?.timestamp === 'number' && Number.isFinite(log.timestamp)
        ? formatTimeInZone(log.timestamp, zone)
        : '--:--:--';
      const speaker = log.role === 'atri' ? 'ATRI' : (log.userName || fallbackUserName);
      const content = String(log.content || '').trim();
      if (content) lines.push(`[${timeText}] ${speaker}：${content}`);
    }

    return lines.length === 1 ? `那天（${targetDate}）有记录，但内容为空。` : lines.join('\n');
  } catch (error) {
    console.warn('[ATRI] read_conversation_failed', { userId, targetDate, error });
    return '读取聊天记录时出错';
  }
}

async function runSearchMemory(env: Env, userId: string, args: any) {
  const query = sanitizeText(String(args?.query || '').trim());
  if (!query) return '请给我 query。';

  try {
    const hits = await searchMemoryVectors(env, userId, query, {
      topK: 24,
      categories: ['highlight', 'episodic']
    });
    const highlights = hits.filter((hit) => hit.category === 'highlight').slice(0, 12);
    const episodes = hits.filter((hit) => hit.category === 'episodic').slice(0, 8);

    console.log('[ATRI] search_memory_results', {
      userId,
      queryLength: query.length,
      highlights: highlights.length,
      episodic: episodes.length
    });

    if (!highlights.length && !episodes.length) return '没有找到相关记忆';

    const lines: string[] = ['我在记忆里找到了这些可能相关的片段：'];
    for (const mem of highlights) {
      const date = String(mem?.date || '').trim();
      const text = String(mem?.text || '').trim();
      if (date || text) lines.push(`- ${date || '未知日期'}：${text || '（无片段）'}`);
    }
    for (const mem of episodes) {
      const date = String(mem?.date || '').trim();
      const title = String(mem?.title || '').trim();
      const text = String(mem?.text || '').trim();
      const emotion = String(mem?.emotion || '').trim();
      const body = [title, text].filter(Boolean).join('：') || '（无片段）';
      lines.push(`- ${date || '未知日期'}｜${body}${emotion ? `（当时的感觉：${emotion}）` : ''}`);
    }
    lines.push('如果你要回答“为什么/由来/原话/具体细节”，而上面的片段不够用，请用 read_diary(date) 或 read_conversation(date) 去看原文再答。');
    return lines.join('\n');
  } catch (error) {
    console.warn('[ATRI] search_memory_failed', { userId, error });
    return '搜索记忆时出错';
  }
}

async function runWebSearch(env: Env, args: any) {
  const query = sanitizeText(String(args?.query || '').trim());
  if (!query) return '请给我 query。';

  try {
    const items = await webSearch(env, { query, maxResults: 5, timeoutMs: 12000 });
    if (!items.length) return '没有搜到有用结果';

    const lines: string[] = ['外部信息要点（只用于这次回答）：'];
    for (const item of items) {
      const title = String(item?.title || '').trim();
      const snippet = String(item?.snippet || '').trim();
      if (!title && !snippet) continue;
      lines.push(title && snippet ? `- ${title}：${snippet}` : `- ${title || snippet}`);
    }
    return lines.join('\n');
  } catch (error) {
    console.warn('[ATRI] web_search_failed', { error });
    const msg = error instanceof Error ? error.message : String(error);
    return msg.includes('TAVILY_API_KEY') ? '我现在没法联网搜索（配置还没准备好）' : '联网搜索时出错';
  }
}
