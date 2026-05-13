import { Env } from '../types';
import { DiaryGenerationResult } from './diary-generator';
import { upsertEpisodicMemories } from './episodic-memory-service';
import { upsertMemoryIntentions } from './memory-intention-service';
import { upsertFactMemory } from './memory-service';

const ALLOWED_FACT_TYPES = new Set(['profile', 'preference', 'taboo', 'promise', 'relationship', 'habit', 'important']);
const JUNK_PATTERNS = [
  /今天.*(困|累|吃|睡|洗澡|出门|回来)/,
  /刚刚/,
  /临时/,
  /可能等会/,
  /今天聊了/,
  /这次.*讨论/,
  /晚上要/,
  /明天可能/
];

export async function persistDiaryDerivedMemories(env: Env, params: {
  userId: string;
  date: string;
  diary: DiaryGenerationResult;
}) {
  const userId = params.userId;
  const date = params.date;

  const [episodic, intentions] = await Promise.all([
    upsertEpisodicMemories(env, { userId, sourceDate: date, memories: params.diary.episodicMemories || [] }),
    upsertMemoryIntentions(env, { userId, sourceDate: date, intentions: params.diary.innerThoughts || [] })
  ]);

  let facts = 0;
  for (const candidate of params.diary.factCandidates || []) {
    const content = String(candidate?.content || '').trim();
    if (!isStrongFactCandidate(content, candidate?.type, Number(candidate?.importance ?? 0))) continue;
    await upsertFactMemory(env, userId, content, {
      type: candidate.type,
      importance: candidate.importance,
      confidence: candidate.confidence,
      source: 'diary',
      sourceDate: date
    });
    facts++;
  }

  return { episodic: episodic.count, intentions: intentions.count, facts };
}

function isStrongFactCandidate(content: string, type: unknown, importance: number) {
  const trimmed = content.trim();
  if (trimmed.length < 6) return false;
  const t = String(type || '').trim();
  if (!ALLOWED_FACT_TYPES.has(t)) return false;
  if (importance < 6 && t !== 'taboo' && t !== 'promise') return false;
  if (JUNK_PATTERNS.some(re => re.test(trimmed))) return false;
  return true;
}
