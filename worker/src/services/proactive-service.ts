import prompts from '../config/prompts.json';
import { Env } from '../types';
import { formatDateInZone } from '../utils/date';
import {
  getTodayPendingSchedule,
  markScheduleSent,
  saveProactiveMessage,
  getProactiveSettings
} from './proactive-scheduler';
import {
  getLastConversationDate,
  fetchConversationLogs,
  getUserProfile,
  listDiaryEntries,
  DiaryEntryRecord
} from './data-service';
import { callChatCompletionsUnified } from './gemini-service';

interface ProactiveContext {
  hoursSinceLastChat: number | null;
  hasTalkedToday: boolean;
  userProfile: string | null;
  recentTopics: string[];
  currentHour: number;
  dayOfWeek: number;
}

function selectMessageType(context: ProactiveContext): string {
  if (context.hoursSinceLastChat && context.hoursSinceLastChat > 24) {
    return 'missing';
  }
  if (context.currentHour >= 6 && context.currentHour < 10 && !context.hasTalkedToday) {
    return 'greeting';
  }
  if (context.currentHour >= 21) {
    return 'reminder';
  }
  return Math.random() > 0.5 ? 'caring' : 'sharing';
}

async function buildProactiveContext(env: Env, userId: string, date: string): Promise<ProactiveContext> {
  const [lastConvDate, todayLogs, userProfile, recentDiaries] = await Promise.all([
    getLastConversationDate(env, userId, date),
    fetchConversationLogs(env, userId, date),
    getUserProfile(env, userId),
    listDiaryEntries(env, userId, 3)
  ]);

  const now = Date.now();
  const hoursSinceLastChat = lastConvDate 
    ? (now - new Date(lastConvDate).getTime()) / 3600000 
    : null;

  const recentTopics = recentDiaries
    .map((d: DiaryEntryRecord) => d.summary || '')
    .filter((s: string) => s.length > 0)
    .slice(0, 3);

  return {
    hoursSinceLastChat,
    hasTalkedToday: todayLogs.length > 0,
    userProfile: userProfile?.content || null,
    recentTopics,
    currentHour: new Date().getHours(),
    dayOfWeek: new Date().getDay()
  };
}

async function generateProactiveContent(
  env: Env, 
  context: ProactiveContext, 
  messageType: string,
  userName: string,
  modelKey: string | null
): Promise<string> {
  const proactivePrompts = (prompts as any).proactive || {};
  
  const systemPrompt = (proactivePrompts.system || '')
    .replace('{userName}', userName);
  
  const typePrompt = proactivePrompts.types?.[messageType] || '生成一条简短的主动消息';
  
  let userPrompt = typePrompt;
  if (messageType === 'sharing' && context.recentTopics.length > 0) {
    userPrompt = userPrompt.replace('{recentTopics}', context.recentTopics.join('、'));
  }
  if (messageType === 'missing' && context.hoursSinceLastChat) {
    userPrompt = userPrompt.replace('{hours}', Math.floor(context.hoursSinceLastChat).toString());
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const response = await callChatCompletionsUnified(env, {
    messages,
    temperature: 0.9,
    max_tokens: 100
  }, {
    model: modelKey || undefined
  });

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content?.trim() || '嗨～';
}

export async function checkAndGenerateProactiveMessage(
  env: Env, 
  userId: string, 
  timeZone: string
) {
  const settings = await getProactiveSettings(env, userId);
  if (!settings.enabled) {
    return { hasMessage: false };
  }

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  if (currentHour >= settings.quiet_start || currentHour < settings.quiet_end) {
    return { hasMessage: false };
  }

  const date = formatDateInZone(Date.now(), timeZone);
  const schedule = await getTodayPendingSchedule(env, userId, date, currentHour, currentMinute);
  
  if (!schedule) {
    return { hasMessage: false };
  }

  const context = await buildProactiveContext(env, userId, date);
  const messageType = selectMessageType(context);
  
  const logs = await fetchConversationLogs(env, userId, date);
  const userName = logs.find(l => l.userName)?.userName || '你';
  
  const modelKey = null; // 可以从用户设置获取
  const content = await generateProactiveContent(env, context, messageType, userName, modelKey);
  
  const message = await saveProactiveMessage(env, userId, schedule.id as string, content, messageType);
  await markScheduleSent(env, schedule.id as string);

  return {
    hasMessage: true,
    message: {
      id: message.id,
      content: message.content,
      contextType: message.contextType,
      timestamp: message.timestamp
    }
  };
}