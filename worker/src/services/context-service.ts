import { ConversationLogRecord } from './data-service';
import { DEFAULT_TIMEZONE, formatTimeInZone } from '../utils/date';

export function buildWorkingMemoryTimeline(logs: ConversationLogRecord[], userName?: string) {
  if (!logs.length) {
    return '';
  }

  return logs.map(log => formatWorkingLine(log, userName)).join('\n');
}

function formatWorkingLine(log: ConversationLogRecord, userName?: string) {
  const zone = log.timeZone || DEFAULT_TIMEZONE;
  const timeTxt = formatTimeInZone(log.timestamp, zone);
  const speaker = log.role === 'atri' ? 'ATRI' : (log.userName || userName || '你');

  // 如果有 mood 信息（仅 ATRI 消息），在名字后添加 PAD 数值
  let moodLabel = '';
  if (log.role === 'atri' && log.mood) {
    try {
      const mood = typeof log.mood === 'string' ? JSON.parse(log.mood) : log.mood;
      if (mood && typeof mood.p === 'number') {
        const p = mood.p ?? 0;
        const a = mood.a ?? 0;
        const d = mood.d ?? 0;
        // 只标记情绪比较明显的时候（P值偏离中性较大）
        if (Math.abs(p) > 0.2) {
          moodLabel = ` (P:${p.toFixed(1)} A:${a.toFixed(1)} D:${d.toFixed(1)})`;
        }
      }
    } catch (e) {
      // mood 解析失败，忽略
    }
  }

  return `[${timeTxt}] ${speaker}${moodLabel}：${log.content}`;
}
