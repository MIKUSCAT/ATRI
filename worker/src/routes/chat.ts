import type { Router } from 'itty-router';
import { Env, CHAT_MODEL } from '../types';
import { jsonResponse } from '../utils/json-response';
import {
  buildUserContentParts,
  normalizeAttachmentList
} from '../utils/attachments';
import { sanitizeText } from '../utils/sanitize';
import { searchMemories } from '../services/memory-service';
import { composeSystemPrompt, formatRecentMessages } from '../services/chat-service';
import { callChatCompletions, ChatCompletionError } from '../services/openai-service';
import { pipeChatStream } from '../utils/stream';
import {
  buildConversationTranscript,
  ConversationLogRecord,
  fetchConversationLogs,
  fetchConversationLogsSince,
  getDiaryEntryById
} from '../services/data-service';
import { DEFAULT_TIMEZONE, formatTimeInZone, resolveDayStartTimestamp } from '../utils/date';

export function registerChatRoutes(router: Router) {
  router.post('/chat', async (request, env: Env) => {
    try {
      const body = await request.json();
      const {
        userId,
        content,
        imageUrl,
        recentMessages,
        currentStage,
        userName,
        clientTimeIso,
        modelKey
      } = body;

      console.log('[ATRI] Received chat request:', { userId, contentLength: content?.length, currentStage });

      let relatedMemories: Array<{ key: string; value: string; importance: number }> = [];
      let longTermContext = '';

      const dayInfo = resolveDayStartTimestamp(clientTimeIso);
      let workingMemoryTimeline = '';
      try {
        if (userId) {
          const todaysLogs = await fetchConversationLogsSince(env, userId, dayInfo.dayStart);
          workingMemoryTimeline = buildWorkingMemoryTimeline(todaysLogs, userName);
        }
      } catch (error) {
        console.warn('[ATRI] working memory加载失败', { userId, error });
      }

      try {
        if (userId && content) {
          const mems = await searchMemories(env, userId, content, 3);

          const diaryMems = mems.filter((m: any) => m.category === 'diary' && m.date);
          const otherMems = mems.filter((m: any) => m.category !== 'diary' || !m.date);

          const recallBlocks = await buildLongTermRecalls(
            env,
            userId,
            diaryMems,
            userName
          );
          if (recallBlocks.length > 0) {
            longTermContext = recallBlocks.join('\n\n');
          }

          const mappedOtherMems = otherMems.map((m: any) => ({
            key: m.key,
            value: m.value,
            importance: m.importance
          }));

          relatedMemories = mappedOtherMems;
        }
      } catch (err) {
        console.warn('[ATRI] memory search skipped:', err);
      }
      const systemPrompt = composeSystemPrompt(
        currentStage,
        userName,
        clientTimeIso,
        relatedMemories,
        longTermContext,
        workingMemoryTimeline
      );

      const sanitizedUserContent = sanitizeText(String(content || ''));
      const normalizedAttachments = normalizeAttachmentList(body.attachments);
      const imageAttachments = normalizedAttachments.filter(att => att.type === 'image');
      const documentAttachments = normalizedAttachments.filter(att => att.type === 'document');
      const formattedRecentMessages = formatRecentMessages(recentMessages);

      const userContentParts = buildUserContentParts({
        content: sanitizedUserContent,
        inlineImage: imageUrl,
        imageAttachments,
        documentAttachments
      });

      if (imageAttachments.length || imageUrl) {
        const totalImages = imageAttachments.length + (imageUrl ? 1 : 0);
        console.log('[ATRI] 对话包含图片', {
          totalImages,
          inlineImage: Boolean(imageUrl),
          attachmentImages: imageAttachments.length,
          names: imageAttachments.map(att => att.name || '未命名')
        });
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        ...formattedRecentMessages,
        userContentParts.length === 0
          ? { role: 'user', content: '[空消息]' }
          : userContentParts.length === 1 && userContentParts[0].type === 'text' && imageAttachments.length === 0 && !imageUrl
            ? { role: 'user', content: userContentParts[0].text ?? '' }
            : { role: 'user', content: userContentParts }
      ];

      console.log('[ATRI] Calling API:', env.OPENAI_API_URL);

      const response = await callChatCompletions(
        env,
        {
          messages,
          stream: true,
          temperature: 0.7,
          max_tokens: 4096
        },
        {
          timeoutMs: 120000,
          model: resolveModelKey(modelKey)
        }
      );

      console.log('[ATRI] API response status:', response.status);
      return pipeChatStream(response);
    } catch (error: any) {
      if (error instanceof ChatCompletionError) {
        console.error('[ATRI] API error response:', error.details);
        return jsonResponse({ error: `API Error: ${error.status}`, details: error.details }, error.status);
      }
      console.error('[ATRI] Internal error:', error);
      return jsonResponse({ error: 'Internal error', details: error.message }, 500);
    }
  });
}

type DiaryMemoryHit = {
  id?: string | null;
  date?: string | null;
  mood?: string | null;
  importance: number;
};

async function buildLongTermRecalls(
  env: Env,
  userId: string,
  diaryMems: any[],
  userName?: string
): Promise<string[]> {
  const sections: string[] = [];
  const processedDates = new Set<string>();

  for (const mem of diaryMems as DiaryMemoryHit[]) {
    const dateKey = mem.date || '';
    if (!dateKey || processedDates.has(dateKey)) {
      continue;
    }
    processedDates.add(dateKey);

    try {
      const logs = await fetchConversationLogs(env, userId, dateKey);
      if (logs.length > 0) {
        const transcript = buildConversationTranscript(logs, userName || '你');
        sections.push(formatRecallBlock(dateKey, mem.mood, transcript));
        continue;
      }

      if (mem.id) {
        const entry = await getDiaryEntryById(env, mem.id);
        const text = entry?.content || entry?.summary || '';
        if (text) {
          sections.push(formatRecallBlock(dateKey, entry?.mood || mem.mood, text));
        }
      }
    } catch (error) {
      console.warn('[ATRI] long-term recall 加载失败', { userId, date: dateKey, error });
    }
  }

  return sections;
}

function formatRecallBlock(date: string, mood?: string | null, content?: string) {
  const moodText = mood ? ` · 心情：${mood}` : '';
  return `【${date}${moodText}】\n${content || ''}`;
}

function buildWorkingMemoryTimeline(logs: ConversationLogRecord[], userName?: string) {
  if (!logs.length) {
    return '';
  }

  if (logs.length <= WORKING_MEMORY_LIMIT) {
    return logs.map(log => formatWorkingLine(log, userName)).join('\n');
  }

  const headLines = logs.slice(0, WORKING_MEMORY_HEAD).map(log => formatWorkingLine(log, userName));
  const tailLines = logs.slice(-WORKING_MEMORY_TAIL).map(log => formatWorkingLine(log, userName));
  const omittedCount = logs.length - (WORKING_MEMORY_HEAD + WORKING_MEMORY_TAIL);
  const placeholder = `……（中间省略 ${omittedCount} 条对话，重点保留开场与最新话题）`;
  return [...headLines, placeholder, ...tailLines].join('\n');
}

function formatWorkingLine(log: ConversationLogRecord, userName?: string) {
  const zone = log.timeZone || DEFAULT_TIMEZONE;
  const timeTxt = formatTimeInZone(log.timestamp, zone);
  const speaker = log.role === 'atri' ? 'ATRI' : (log.userName || userName || '你');
  return `[${timeTxt}] ${speaker}：${log.content}`;
}

const WORKING_MEMORY_LIMIT = 100;
const WORKING_MEMORY_HEAD = 20;
const WORKING_MEMORY_TAIL = 50;

function resolveModelKey(modelKey?: string | null) {
  if (typeof modelKey === 'string' && modelKey.trim().length > 0) {
    return modelKey.trim();
  }
  return CHAT_MODEL;
}
