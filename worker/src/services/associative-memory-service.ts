import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { getActiveFacts, markFactRecalled, searchMemoryVectors } from './memory-service';
import { getEpisodicMemoryById, listRecentEpisodicMemories, markEpisodicRecalled, EpisodicMemoryRecord } from './episodic-memory-service';
import { listPendingIntentions, markIntentionRecalled, MemoryIntentionRecord } from './memory-intention-service';
import { recordMemoryEvent } from './memory-event-service';

export type AssociativeMemoryContext = {
  facts: Array<{ id: string; text: string; type: string; importance: number; confidence: number }>;
  episodes: EpisodicMemoryRecord[];
  intentions: MemoryIntentionRecord[];
};

function keywords(text: string) {
  return Array.from(new Set(
    sanitizeText(text)
      .toLowerCase()
      .split(/[\s，。！？、,.!?;；:：()（）【】\[\]"'“”‘’]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 2)
      .slice(0, 80)
  ));
}

function lexicalScore(text: string, ks: string[]) {
  if (!ks.length) return 0;
  const lower = sanitizeText(text).toLowerCase();
  let score = 0;
  for (const k of ks) {
    if (lower.includes(k)) score += 1;
  }
  return score / Math.max(1, ks.length);
}

export async function retrieveAssociativeMemories(env: Env, params: {
  userId: string;
  query: string;
  conversationLogId?: string;
}): Promise<AssociativeMemoryContext> {
  const userId = String(params.userId || '').trim();
  const query = sanitizeText(String(params.query || '')).trim();
  if (!userId || !query) return { facts: [], episodes: [], intentions: [] };

  const ks = keywords(query);
  const [factsRaw, intentions] = await Promise.all([
    getActiveFacts(env, userId, 80).catch(() => []),
    listPendingIntentions(env, userId, 3).catch(() => [])
  ]);

  const facts = factsRaw
    .map(f => ({
      ...f,
      score: lexicalScore(f.text, ks) * 4 + f.importance * 0.35 + f.confidence * 1.5 + Math.min(f.recallCount, 5) * 0.15
    }))
    .filter(f => f.score >= 2.3 || f.importance >= 8)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5)
    .map(f => ({ id: f.id, text: f.text, type: f.type, importance: f.importance, confidence: f.confidence }));

  let episodes: EpisodicMemoryRecord[] = [];
  try {
    const vectorHits = await searchMemoryVectors(env, userId, query, { topK: 8, categories: ['episodic'] });
    const seen = new Set<string>();
    for (const hit of vectorHits) {
      const id = normalizeEpisodicId(userId, hit.id);
      if (!id || seen.has(id)) continue;
      const row = await getEpisodicMemoryById(env, userId, id);
      if (!row) continue;
      seen.add(id);
      episodes.push(row);
      if (episodes.length >= 5) break;
    }
  } catch (err) {
    console.warn('[ATRI] episodic vector recall failed', { userId, err });
  }

  if (!episodes.length) {
    const recent = await listRecentEpisodicMemories(env, userId, 12).catch(() => []);
    episodes = recent
      .map((e: EpisodicMemoryRecord) => ({ ...e, score: lexicalScore(`${e.title} ${e.content} ${e.emotion || ''} ${e.tags.join(' ')}`, ks) * 5 + e.importance * 0.4 + e.emotionalWeight * 0.25 }))
      .filter((e: EpisodicMemoryRecord & { score: number }) => e.score >= 2.6 || e.importance >= 8)
      .sort((a: EpisodicMemoryRecord & { score: number }, b: EpisodicMemoryRecord & { score: number }) => b.score - a.score)
      .slice(0, 5);
  }

  for (const f of facts) {
    await markFactRecalled(env, userId, f.id).catch(() => undefined);
    await recordMemoryEvent(env, { userId, memoryId: f.id, memoryType: 'fact', eventType: 'recalled', conversationLogId: params.conversationLogId }).catch(() => undefined);
  }
  for (const e of episodes) {
    await markEpisodicRecalled(env, userId, e.id, params.conversationLogId).catch(() => undefined);
  }
  for (const i of intentions) {
    await markIntentionRecalled(env, userId, i.id, params.conversationLogId).catch(() => undefined);
  }

  return { facts, episodes, intentions };
}

function normalizeEpisodicId(userId: string, vectorId: string) {
  const raw = String(vectorId || '').trim();
  const prefix = `epi:${userId}:`;
  if (!raw.startsWith(prefix)) return '';
  const rest = raw.slice(prefix.length);
  return `epi:${userId}:${rest}`;
}

export function buildAssociativeMemoryPrompt(ctx: AssociativeMemoryContext) {
  const parts: string[] = [];

  if (ctx.facts.length) {
    parts.push('<对他的长期理解>');
    for (const f of ctx.facts) {
      parts.push(`- [${f.id}] ${f.text}（${f.type}，重要度${f.importance}，置信${f.confidence.toFixed(2)}）`);
    }
    parts.push('</对他的长期理解>');
  }

  if (ctx.episodes.length) {
    parts.push('<脑海里自然浮现的旧事>');
    parts.push('这些只是像人一样被当前话题触发的联想，不是任务清单。合适才自然提起；不合适就只用来理解他。不要说“检索到/数据库显示/记录显示”。');
    for (const e of ctx.episodes) {
      const tags = e.tags.length ? ` #${e.tags.join(' #')}` : '';
      const emotion = e.emotion ? `；当时的感觉：${e.emotion}` : '';
      parts.push(`- [${e.id}] ${e.sourceDate}｜${e.title}：${e.content}${emotion}${tags}`);
    }
    parts.push('</脑海里自然浮现的旧事>');
  }

  if (ctx.intentions.length) {
    parts.push('<心里挂着的念头>');
    parts.push('这些是之前日记里留下的未说出口的话。只有当前气氛合适时才说，不要突兀完成任务。');
    for (const i of ctx.intentions) {
      const trigger = i.triggerHint ? `（触发：${i.triggerHint}）` : '';
      parts.push(`- [${i.id}] ${i.content}${trigger}`);
    }
    parts.push('</心里挂着的念头>');
  }

  return parts.join('\n');
}
