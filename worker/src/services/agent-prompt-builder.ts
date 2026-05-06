import { AutoRecallResult, formatRecallsAsNaturalThoughts } from './auto-recall-service';
import { UserStateRecord } from './data-service';
import { formatFactsAsInternalKnowledge } from './memory-service';

export function composeAgentSystemPrompt(params: {
  coreSelf: string;
  agent: string;
  state: UserStateRecord;
  firstInteractionAt?: number;
  lastInteractionAt?: number;
  userName?: string;
  clientTimeIso?: string;
  recalls: AutoRecallResult;
  facts: Array<{ id: string; text: string; importance?: number }>;
  pendingProactive?: { content: string; createdAt: number } | null;
}): string {
  const parts: string[] = [];
  parts.push(params.coreSelf.trim());
  parts.push(params.agent.trim());
  parts.push(buildContextBlock(params));

  if (params.pendingProactive) {
    parts.push([
      '<我之前想说的话>',
      `（刚才其实我在心里想：${params.pendingProactive.content}——但他还没来，我没说出口）`,
      '</我之前想说的话>'
    ].join('\n'));
  }

  const recallBlock = formatRecallsAsNaturalThoughts(params.recalls);
  if (recallBlock) parts.push(recallBlock);

  const factsBlock = formatFactsAsInternalKnowledge(params.facts);
  if (factsBlock) parts.push(factsBlock);

  return parts.filter(Boolean).join('\n\n');
}

function buildContextBlock(params: {
  state: UserStateRecord;
  firstInteractionAt?: number;
  lastInteractionAt?: number;
  userName?: string;
  clientTimeIso?: string;
}): string {
  const nameForPrompt = (params.userName || '').trim() || '你';
  const timeInfo = formatClientDateTime(params.clientTimeIso);
  const localDate = timeInfo?.localDate || '';
  const clockTime = timeInfo?.clockTime || '';
  const daysTogether = params.firstInteractionAt
    ? Math.max(1, Math.floor((Date.now() - params.firstInteractionAt) / 86400000) + 1)
    : 1;
  const lastInteraction = describeLastInteraction(params.lastInteractionAt);

  const lines: string[] = ['<现在>'];
  if (localDate) lines.push(`时间：${localDate} ${clockTime}`);
  lines.push(`和${nameForPrompt}认识：第 ${daysTogether} 天`);
  if (lastInteraction) lines.push(`上次说话：${lastInteraction}`);
  lines.push(`我现在的状态：${params.state.statusLabel}（${params.state.statusPillColor}）`);
  if (params.state.statusReason) lines.push(`上次心境：${params.state.statusReason}`);
  lines.push(`我们的距离：${params.state.intimacy}`);
  lines.push('</现在>');
  return lines.join('\n');
}

function describeLastInteraction(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 5 * 60 * 1000) return '就在刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.round(diff / (60 * 1000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.round(diff / (60 * 60 * 1000))} 小时前`;
  return `${Math.round(diff / (24 * 60 * 60 * 1000))} 天前`;
}

function formatClientDateTime(clientTimeIso?: string) {
  if (typeof clientTimeIso !== 'string' || clientTimeIso.trim().length < 10) return null;
  const match = clientTimeIso.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:([+-]\d{2}):?(\d{2})|Z)?$/
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return {
    localDate: `${year}年${Number(month)}月${Number(day)}日`,
    clockTime: second ? `${hour}:${minute}:${second}` : `${hour}:${minute}`
  };
}
