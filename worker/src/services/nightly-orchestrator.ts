import { Env } from '../types';
import {
  buildConversationTranscript,
  calculateDaysBetween,
  fetchConversationLogs,
  getDiaryEntry,
  getLastConversationDate,
  saveDiaryEntry
} from './data-service';
import { generateDiaryFromConversation, DiaryGenerationResult } from './diary-generator';
import { upsertDiaryHighlightsMemory, deleteDiaryVectorsForDate } from './memory-service';
import { persistDiaryDerivedMemories } from './memory-maintenance-service';
import { consolidateFactsForUser } from './fact-consolidation';
import { runNightlyMindForUser } from './nightly-mind-service';
import { syncFactVectorsNightly } from './fact-vectorize-service';

export type NightlyPhase =
  | 'cleanup_vectors'
  | 'generate_diary'
  | 'save_diary'
  | 'highlights_vector'
  | 'derived_memories'
  | 'fact_consolidation'
  | 'nightly_mind'
  | 'vector_sync';

const PHASE_ORDER: NightlyPhase[] = [
  'cleanup_vectors',
  'generate_diary',
  'save_diary',
  'highlights_vector',
  'derived_memories',
  'fact_consolidation',
  'nightly_mind',
  'vector_sync'
];

export const TOTAL_PHASES = PHASE_ORDER.length;

export type RegenerateTaskRow = {
  taskId: string;
  userId: string;
  date: string;
  phase: NightlyPhase | 'queued' | 'completed' | 'failed';
  status: 'queued' | 'running' | 'completed' | 'failed';
  percent: number;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
};

export async function createRegenerateTask(
  env: Env,
  params: { taskId: string; userId: string; date: string }
): Promise<void> {
  const now = Date.now();
  await env.ATRI_DB.prepare(
    `INSERT INTO regenerate_tasks (task_id, user_id, date, phase, status, percent, error, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', 'queued', 0, NULL, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET
       user_id = excluded.user_id,
       date = excluded.date,
       phase = excluded.phase,
       status = excluded.status,
       percent = excluded.percent,
       error = NULL,
       updated_at = excluded.updated_at`
  ).bind(params.taskId, params.userId, params.date, now, now).run();
}

export async function getRegenerateTask(env: Env, taskId: string): Promise<RegenerateTaskRow | null> {
  const row = await env.ATRI_DB.prepare(
    `SELECT task_id as taskId, user_id as userId, date, phase, status, percent, error,
            created_at as createdAt, updated_at as updatedAt
       FROM regenerate_tasks WHERE task_id = ?`
  ).bind(taskId).first<RegenerateTaskRow>();
  return row ?? null;
}

async function updateTask(
  env: Env,
  taskId: string | undefined,
  patch: { phase?: string; status?: string; percent?: number; error?: string | null }
) {
  if (!taskId) return;
  const now = Date.now();
  const fields: string[] = ['updated_at = ?'];
  const values: any[] = [now];
  if (patch.phase !== undefined) { fields.push('phase = ?'); values.push(patch.phase); }
  if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
  if (patch.percent !== undefined) { fields.push('percent = ?'); values.push(Math.max(0, Math.min(100, Math.trunc(patch.percent)))); }
  if (patch.error !== undefined) { fields.push('error = ?'); values.push(patch.error); }
  values.push(taskId);
  await env.ATRI_DB.prepare(
    `UPDATE regenerate_tasks SET ${fields.join(', ')} WHERE task_id = ?`
  ).bind(...values).run();
}

async function startStage(env: Env, userId: string, date: string, phase: NightlyPhase): Promise<string> {
  const id = crypto.randomUUID();
  await env.ATRI_DB.prepare(
    `INSERT INTO nightly_runs (id, user_id, date, stage, status, details, started_at, completed_at)
     VALUES (?, ?, ?, ?, 'running', NULL, ?, NULL)`
  ).bind(id, userId, date, phase, Date.now()).run();
  return id;
}

async function completeStage(env: Env, runId: string, userId: string, details?: string) {
  await env.ATRI_DB.prepare(
    `UPDATE nightly_runs SET status = 'completed', details = ?, completed_at = ? WHERE id = ? AND user_id = ?`
  ).bind((details || '').slice(0, 4000), Date.now(), runId, userId).run();
}

async function failStage(env: Env, runId: string, userId: string, err: unknown) {
  const msg = serializeError(err);
  await env.ATRI_DB.prepare(
    `UPDATE nightly_runs SET status = 'failed', details = ?, completed_at = ? WHERE id = ? AND user_id = ?`
  ).bind(msg.slice(0, 4000), Date.now(), runId, userId).run();
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function phasePercent(completed: number): number {
  return Math.round((completed / TOTAL_PHASES) * 100);
}

export async function runFullNightlyForDate(env: Env, params: {
  userId: string;
  userName: string;
  date: string;
  modelKey?: string | null;
  taskId?: string;
  forceRegenerate?: boolean;
}): Promise<void> {
  const { userId, userName, date, taskId } = params;
  const modelKey = params.modelKey ?? null;
  const force = !!params.forceRegenerate;
  let completed = 0;

  const runStage = async <T>(
    phase: NightlyPhase,
    fn: () => Promise<T>,
    detailsOf?: (result: T) => string
  ): Promise<T | undefined> => {
    await updateTask(env, taskId, { phase, status: 'running', percent: phasePercent(completed) });
    const runId = await startStage(env, userId, date, phase);
    try {
      const result = await fn();
      await completeStage(env, runId, userId, detailsOf ? detailsOf(result) : '');
      completed += 1;
      await updateTask(env, taskId, { percent: phasePercent(completed) });
      return result;
    } catch (err) {
      await failStage(env, runId, userId, err);
      console.warn('[ATRI] nightly phase failed', { userId, date, phase, err });
      completed += 1;
      await updateTask(env, taskId, { percent: phasePercent(completed), error: `${phase}: ${serializeError(err)}` });
      return undefined;
    }
  };

  let diary: DiaryGenerationResult | null = null;
  let transcript = '';

  // Phase 1: 清理旧 highlight 向量
  await runStage('cleanup_vectors', async () => {
    await deleteDiaryVectorsForDate(env, userId, date);
  });

  // Phase 2: 取或生成日记。取 transcript 是后续 phase 需要的，所以这里也准备好。
  await runStage('generate_diary', async () => {
    const logs = await fetchConversationLogs(env, userId, date);
    if (!logs.length) throw new Error('no_conversation_logs');

    const detectedUserName = logs.find(l => l.role === 'user' && l.userName)?.userName
      || logs.find(l => l.userName)?.userName
      || userName
      || '';
    transcript = buildConversationTranscript(logs, detectedUserName || '你');

    const existing = await getDiaryEntry(env, userId, date);
    if (existing && existing.status === 'ready' && !force) {
      diary = {
        content: String(existing.content || ''),
        timestamp: Number(existing.updatedAt || Date.now()),
        mood: String(existing.mood || ''),
        highlights: String(existing.summary || '').split('；').map(s => s.trim()).filter(Boolean),
        episodicMemories: [],
        factCandidates: [],
        innerThoughts: []
      } as DiaryGenerationResult;
      return { regenerated: false };
    }

    const lastDate = await getLastConversationDate(env, userId, date);
    const daysSince = lastDate ? calculateDaysBetween(lastDate, date) : null;

    diary = await generateDiaryFromConversation(env, {
      conversation: transcript,
      userId,
      userName: detectedUserName || userName || '这个人',
      date,
      daysSinceLastChat: daysSince,
      modelKey
    });
    return { regenerated: true };
  }, (r) => JSON.stringify(r || {}));

  // Phase 3: 保存日记
  await runStage('save_diary', async () => {
    if (!diary) throw new Error('diary_missing');
    const summaryText = diary.highlights.length ? diary.highlights.join('；') : diary.content;
    await saveDiaryEntry(env, {
      userId,
      date,
      content: diary.content,
      summary: summaryText,
      mood: diary.mood,
      status: 'ready'
    });
  });

  // Phase 4: 写 highlights 向量
  await runStage('highlights_vector', async () => {
    if (!diary) throw new Error('diary_missing');
    const summaryText = diary.highlights.length ? diary.highlights.join('；') : diary.content;
    const highlights = Array.isArray(diary.highlights) && diary.highlights.length
      ? diary.highlights
      : summaryText
        ? summaryText.split('；').map(s => s.trim()).filter(Boolean).slice(0, 10)
        : [diary.content];
    await upsertDiaryHighlightsMemory(env, {
      userId,
      date,
      mood: diary.mood,
      highlights,
      timestamp: diary.timestamp
    });
  });

  // Phase 5: 情景记忆 + 意图 + 候选事实
  await runStage('derived_memories', async () => {
    if (!diary) throw new Error('diary_missing');
    return persistDiaryDerivedMemories(env, { userId, date, diary });
  }, (r) => JSON.stringify(r || {}));

  // Phase 6: 事实合并
  await runStage('fact_consolidation', async () => {
    await consolidateFactsForUser(env, {
      userId,
      userName: userName || '这个人',
      modelKey,
      date
    });
  });

  // Phase 7: nightly mind（含 pillColor 更新）—— 此前重生成时漏掉的关键步骤
  await runStage('nightly_mind', async () => {
    if (!diary) throw new Error('diary_missing');
    return runNightlyMindForUser(env, {
      userId,
      userName: userName || '这个人',
      date,
      diaryContent: diary.content,
      transcript
    });
  }, (r) => JSON.stringify(r || {}));

  // Phase 8: 事实向量同步
  await runStage('vector_sync', async () => {
    await syncFactVectorsNightly(env, userId);
  });

  await updateTask(env, taskId, { phase: 'completed', status: 'completed', percent: 100 });
}
