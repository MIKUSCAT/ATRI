import type { Router } from 'itty-router';
import { Env, CHAT_MODEL } from '../types';
import { jsonResponse } from '../utils/json-response';
import {
  buildUserContentParts,
  normalizeAttachmentList
} from '../utils/attachments';
import { sanitizeText } from '../utils/sanitize';
import { searchMemories } from '../services/memory-service';
import { composeSystemPrompt, formatRecentMessages, EmotionContext } from '../services/chat-service';
import { callChatCompletions, ChatCompletionError } from '../services/openai-service';
import { pipeChatStream } from '../utils/stream';
import {
  buildConversationTranscript,
  ConversationLogRecord,
  fetchConversationLogs,
  fetchConversationLogsSince,
  getDiaryEntryById,
  DailyLearningRecord,
  getRecentDailyLearnings,
  getTopUserMemories,
  listDiaryEntries,
  getLastConversationDate,
  calculateDaysBetween
} from '../services/data-service';
import { DEFAULT_TIMEZONE, formatTimeInZone, resolveDayStartTimestamp, formatDateInZone } from '../utils/date';

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
      let learningNotes = '';

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

      try {
        if (userId) {
          const learnings = await getRecentDailyLearnings(env, userId, 3);
          learningNotes = formatDailyLearningNotes(learnings);
        }
      } catch (error) {
        console.warn('[ATRI] learning notes load failed', { userId, error });
      }

      let structuredMemories: Awaited<ReturnType<typeof getTopUserMemories>> = [];
      try {
        if (userId) {
          structuredMemories = await getTopUserMemories(env, userId, 15);
        }
      } catch (error) {
        console.warn('[ATRI] structured memories load failed', { userId, error });
      }

      let emotionContext: EmotionContext = {};
      try {
        if (userId) {
          emotionContext = await buildEmotionContext(env, userId, clientTimeIso);
        }
      } catch (error) {
        console.warn('[ATRI] emotion context build failed', { userId, error });
      }

      const systemPrompt = composeSystemPrompt(
        currentStage,
        userName,
        clientTimeIso,
        relatedMemories,
        longTermContext,
        workingMemoryTimeline,
        learningNotes,
        structuredMemories,
        emotionContext
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
          temperature: 1,
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

function formatDailyLearningNotes(list: DailyLearningRecord[]) {
  const notes = Array.isArray(list) ? list : [];
  if (!notes.length) return '';

  const lines: string[] = [];
  for (const item of notes) {
    const date = item.date || '未知日期';
    let payload: any = {};
    try {
      if (item.payload) {
        payload = JSON.parse(String(item.payload));
      }
    } catch (err) {
      console.warn('[ATRI] learning payload parse failed', err);
      payload = {};
    }

    const good = Array.isArray(payload?.self_reflection?.good_moments)
      ? payload.self_reflection.good_moments[0]
      : '';
    const bad = Array.isArray(payload?.self_reflection?.format_issue)
      ? payload.self_reflection.format_issue[0]
      : '';
    const plan = Array.isArray(payload?.tomorrow_plan?.do_less)
      ? payload.tomorrow_plan.do_less[0]
      : '';
    const more = Array.isArray(payload?.tomorrow_plan?.do_more)
      ? payload.tomorrow_plan.do_more[0]
      : '';

    const lineParts = [
      good ? `亮点：${good}` : '',
      bad ? `问题：${bad}` : '',
      more ? `明天多做：${more}` : '',
      plan ? `明天少做：${plan}` : ''
    ].filter(Boolean);

    const line = lineParts.length
      ? `【${date}】` + lineParts.join(' ｜ ')
      : `【${date}】暂无复盘详情`;
    lines.push(line);
  }

  return lines.join('\n');
}

async function buildEmotionContext(
  env: Env,
  userId: string,
  clientTimeIso?: string
): Promise<EmotionContext> {
  const ctx: EmotionContext = {};

  const today = formatDateInZone(Date.now(), DEFAULT_TIMEZONE);
  const lastDate = await getLastConversationDate(env, userId, today);
  if (lastDate) {
    ctx.daysSinceChat = calculateDaysBetween(lastDate, today);
  }

  const recentDiaries = await listDiaryEntries(env, userId, 1);
  if (recentDiaries.length > 0 && recentDiaries[0].mood) {
    ctx.lastMood = recentDiaries[0].mood;
  }

  const learnings = await getRecentDailyLearnings(env, userId, 1);
  if (learnings.length > 0 && learnings[0].payload) {
    try {
      const payload = JSON.parse(String(learnings[0].payload));
      if (Array.isArray(payload?.self_reflection?.bad_moments)) {
        ctx.recentBadMoments = payload.self_reflection.bad_moments.slice(0, 2);
      }
      if (Array.isArray(payload?.self_reflection?.good_moments)) {
        ctx.recentGoodMoments = payload.self_reflection.good_moments.slice(0, 2);
      }
    } catch (err) {
      // ignore parse error
    }
  }

  return ctx;
}
