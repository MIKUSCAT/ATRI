import { ContentPart, Env } from '../runtime/types';
import { buildHistoryContentParts, normalizeAttachmentList } from '../utils/attachments';
import { formatTimeInZone, DEFAULT_TIMEZONE } from '../utils/date';
import { ConversationLogRecord, fetchConversationLogs } from './data-service';

export type HistoryMessage = {
  role: 'system' | 'assistant' | 'user';
  content: string | ContentPart[];
};

function resolveYesterdayIsoDate(todayIsoDate: string) {
  const match = String(todayIsoDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;

  const yesterdayAt = Date.UTC(year, month - 1, day) - 86400000;
  const date = new Date(yesterdayAt);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function loadConversationLogsForDate(
  env: Env,
  params: { userId: string; date: string; excludeLogId?: string }
): Promise<ConversationLogRecord[]> {
  const date = String(params.date || '').trim();
  if (!date) return [];
  const logs = await fetchConversationLogs(env, params.userId, date);
  const exclude = typeof params.excludeLogId === 'string' ? params.excludeLogId.trim() : '';
  if (!exclude) return logs;
  return logs.filter((log) => log.id !== exclude);
}

export async function loadTwoDaysConversationLogs(
  env: Env,
  params: { userId: string; today: string; excludeLogId?: string }
): Promise<{ todayLogs: ConversationLogRecord[]; yesterdayLogs: ConversationLogRecord[]; yesterdayDate: string | null }> {
  const today = String(params.today || '').trim();
  if (!today) {
    return { todayLogs: [], yesterdayLogs: [], yesterdayDate: null };
  }

  const yesterday = resolveYesterdayIsoDate(today);
  const [todayLogs, yesterdayLogs] = await Promise.all([
    loadConversationLogsForDate(env, { userId: params.userId, date: today, excludeLogId: params.excludeLogId }),
    yesterday ? loadConversationLogsForDate(env, { userId: params.userId, date: yesterday }) : Promise.resolve([])
  ]);

  return { todayLogs, yesterdayLogs, yesterdayDate: yesterday };
}

function buildHistoryMessagesFromLogs(logs: ConversationLogRecord[]) {
  if (!Array.isArray(logs) || logs.length === 0) return [];

  return logs
    .map((log) => {
      const zone = (log?.timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
      const timeText =
        typeof log?.timestamp === 'number' && Number.isFinite(log.timestamp)
          ? formatTimeInZone(log.timestamp, zone)
          : '--:--';
      const dateText = typeof log?.date === 'string' ? log.date.trim() : '';
      const timePrefix = dateText ? `[${dateText} ${timeText}] ` : `[${timeText}] `;
      const attachments = normalizeAttachmentList(log.attachments).filter((att) => att.type !== 'image');
      const parts = buildHistoryContentParts(log?.content, attachments);
      if (!parts.length) return null;
      const role = log?.role === 'atri' ? 'assistant' : 'user';
      if (parts.length === 1 && parts[0].type === 'text') {
        return { role, content: `${timePrefix}${parts[0].text ?? ''}` };
      }

      const patched = parts.slice();
      if (patched[0]?.type === 'text') {
        patched[0] = { ...patched[0], text: `${timePrefix}${patched[0].text ?? ''}` };
      } else {
        patched.unshift({ type: 'text', text: timePrefix.trim() });
      }
      return { role, content: patched };
    })
    .filter(Boolean) as Array<{ role: 'assistant' | 'user'; content: string | ContentPart[] }>;
}

export function buildTwoDaysHistoryMessagesFromLogs(params: {
  today: string;
  todayLogs: ConversationLogRecord[];
  yesterday: string | null;
  yesterdayLogs: ConversationLogRecord[];
}): HistoryMessage[] {
  const messages: HistoryMessage[] = [];

  if (params.yesterday && Array.isArray(params.yesterdayLogs) && params.yesterdayLogs.length > 0) {
    messages.push({ role: 'system', content: `--- 昨天（${params.yesterday}）的对话 ---` });
    messages.push(...buildHistoryMessagesFromLogs(params.yesterdayLogs));
  }

  if (Array.isArray(params.todayLogs) && params.todayLogs.length > 0) {
    messages.push({ role: 'system', content: `--- 今天（${params.today}）的对话 ---` });
    messages.push(...buildHistoryMessagesFromLogs(params.todayLogs));
  }

  return messages;
}
