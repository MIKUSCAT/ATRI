import type { Env } from '../types';
import { searchMemoryVectors } from './memory-service';
import { getEffectiveRuntimeSettings } from './runtime-settings';

export type AutoRecallResult = {
  highlights: Array<{ date: string; text: string; score: number }>;
  episodes: Array<{ date: string; title: string; text: string; emotion: string }>;
} | null;

export async function autoRecallMemories(
  env: Env,
  userId: string,
  currentText: string
): Promise<AutoRecallResult> {
  const trimmed = String(currentText || '').trim();
  if (trimmed.length < 4) return null;

  const settings = await getEffectiveRuntimeSettings(env);
  if (!settings.autoRecallEnabled) return null;

  try {
    const hits = await searchMemoryVectors(env, userId, trimmed, {
      topK: 12,
      categories: ['highlight', 'episodic'],
      minScore: settings.autoRecallMinScore
    });
    if (!hits.length) return null;

    const highlights = hits
      .filter(h => h.category === 'highlight')
      .slice(0, 3)
      .map(h => ({
        date: String(h.date || '').trim(),
        text: String(h.text || '').trim(),
        score: h.score ?? 0
      }))
      .filter(h => h.text);

    const episodes = hits
      .filter(h => h.category === 'episodic')
      .slice(0, 2)
      .map(h => ({
        date: String(h.date || '').trim(),
        title: String(h.title || '').trim(),
        text: String(h.text || '').trim(),
        emotion: String(h.emotion || '').trim()
      }))
      .filter(e => e.text || e.title);

    if (!highlights.length && !episodes.length) return null;
    return { highlights, episodes };
  } catch (error) {
    console.warn('[ATRI] autoRecall_failed', { userId, error });
    return null;
  }
}

export function formatRecallsAsNaturalThoughts(recalls: AutoRecallResult): string {
  if (!recalls) return '';
  const lines: string[] = ['<脑海里浮现的片段>'];
  for (const h of recalls.highlights) lines.push(`（${h.date}那天，${h.text}）`);
  for (const e of recalls.episodes) {
    const body = e.title ? `${e.title}——${e.text}` : e.text;
    const tail = e.emotion ? `（当时的感觉：${e.emotion}）` : '';
    lines.push(`（突然想起${e.date}：${body}${tail}）`);
  }
  lines.push('</脑海里浮现的片段>');
  return lines.join('\n');
}
