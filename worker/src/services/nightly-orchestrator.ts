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
import { ChatCompletionError } from './llm-service';

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
  'generate_diary',
  'save_diary',
  'cleanup_vectors',
  'highlights_vector',
  'derived_memories',
  'fact_consolidation',
  'nightly_mind',
  'vector_sync'
];

export const TOTAL_PHASES = PHASE_ORDER.length;

export type RegenerateTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'superseded';

export type RegenerateTaskRow = {
  taskId: string;
  userId: string;
  date: string;
  phase: NightlyPhase | 'queued' | 'completed' | 'failed' | 'cancelled' | 'superseded';
  status: RegenerateTaskStatus;
  percent: number;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
};

const ACTIVE_TASK_STATUSES: RegenerateTaskStatus[] = ['queued', 'running', 'cancel_requested'];
const REGENERATE_TASK_STALE_MS = 20 * 60 * 1000;

class RegenerateTaskStoppedError extends Error {
  constructor(readonly status: RegenerateTaskStatus | 'missing') {
    super(`regenerate_task_${status}`);
    this.name = 'RegenerateTaskStoppedError';
  }
}

export async function createRegenerateTask(
  env: Env,
  params: { taskId: string; userId: string; date: string }
): Promise<void> {
  const now = Date.now();
  await env.ATRI_DB.prepare(
    `UPDATE regenerate_tasks
        SET status = 'superseded',
            phase = 'superseded',
            error = 'superseded_by_new_task',
            updated_at = ?
      WHERE user_id = ?
        AND date = ?
        AND status IN ('queued', 'running', 'cancel_requested')`
  ).bind(now, params.userId, params.date).run();

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

export async function claimRegenerateTask(env: Env, taskId: string): Promise<RegenerateTaskRow | null> {
  const now = Date.now();
  const result = await env.ATRI_DB.prepare(
    `UPDATE regenerate_tasks
        SET status = 'running',
            phase = CASE WHEN phase = 'queued' THEN 'generate_diary' ELSE phase END,
            updated_at = ?
      WHERE task_id = ?
        AND status = 'queued'`
  ).bind(now, taskId).run();

  if (Number(result?.meta?.changes ?? 0) <= 0) return null;
  return getRegenerateTask(env, taskId);
}

export async function requestCancelRegenerateTask(
  env: Env,
  params: { taskId: string; userId?: string }
): Promise<RegenerateTaskRow | null> {
  const now = Date.now();
  const userId = String(params.userId || '').trim();
  const whereUser = userId ? ' AND user_id = ?' : '';
  const values = userId ? [now, params.taskId, userId] : [now, params.taskId];
  await env.ATRI_DB.prepare(
    `UPDATE regenerate_tasks
        SET status = 'cancel_requested',
            error = NULL,
            updated_at = ?
      WHERE task_id = ?
        ${whereUser}
        AND status IN ('queued', 'running')`
  ).bind(...values).run();

  const task = await getRegenerateTask(env, params.taskId);
  if (task && userId && task.userId !== userId) return null;
  if (task?.status === 'queued' || task?.status === 'cancel_requested') {
    await markRegenerateTaskCancelled(env, task.taskId);
    return getRegenerateTask(env, task.taskId);
  }
  return task;
}

export async function markRegenerateTaskFailed(env: Env, taskId: string, error: string) {
  await updateTask(env, taskId, {
    phase: 'failed',
    status: 'failed',
    error: error.slice(0, 2000)
  }, false);
}

export async function markRegenerateTaskCancelled(env: Env, taskId: string) {
  await updateTask(env, taskId, {
    phase: 'cancelled',
    status: 'cancelled',
    error: null
  }, false);
}

export async function expireStaleRegenerateTask(env: Env, taskId: string): Promise<void> {
  const task = await getRegenerateTask(env, taskId);
  if (!task || (task.status !== 'queued' && task.status !== 'running' && task.status !== 'cancel_requested')) return;
  if (Date.now() - Number(task.updatedAt || 0) < REGENERATE_TASK_STALE_MS) return;
  await markRegenerateTaskFailed(env, taskId, 'task_stale_timeout');
}

async function updateTask(
  env: Env,
  taskId: string | undefined,
  patch: { phase?: string; status?: string; percent?: number; error?: string | null },
  onlyActive = true
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
  const activeGuard = onlyActive
    ? ` AND status IN (${ACTIVE_TASK_STATUSES.map(() => '?').join(', ')})`
    : '';
  if (onlyActive) values.push(...ACTIVE_TASK_STATUSES);
  await env.ATRI_DB.prepare(
    `UPDATE regenerate_tasks SET ${fields.join(', ')} WHERE task_id = ?${activeGuard}`
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

function isTaskStoppedError(err: unknown) {
  return err instanceof RegenerateTaskStoppedError
    || (err instanceof ChatCompletionError && err.status === 499)
    || (err instanceof Error && /request_cancelled|regenerate_task_/.test(err.message));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function assertTaskActive(env: Env, taskId: string | undefined, signal?: AbortSignal) {
  if (!taskId) return;
  if (signal?.aborted) throw new RegenerateTaskStoppedError('cancel_requested');

  const task = await getRegenerateTask(env, taskId);
  if (!task) throw new RegenerateTaskStoppedError('missing');
  if (task.status === 'cancel_requested') throw new RegenerateTaskStoppedError('cancel_requested');
  if (task.status !== 'queued' && task.status !== 'running') {
    throw new RegenerateTaskStoppedError(task.status);
  }
}

async function watchRegenerateTaskStop(env: Env, taskId: string | undefined, controller: AbortController, done: () => boolean) {
  if (!taskId) return;
  while (!done()) {
    await sleep(1500);
    if (done() || controller.signal.aborted) return;
    const task = await getRegenerateTask(env, taskId).catch(() => null);
    if (!task || task.status === 'cancel_requested' || (task.status !== 'queued' && task.status !== 'running')) {
      controller.abort('regenerate_task_stopped');
      return;
    }
  }
}

async function settleStoppedTask(env: Env, taskId: string | undefined) {
  if (!taskId) return;
  const task = await getRegenerateTask(env, taskId);
  if (!task) return;
  if (task.status === 'cancel_requested' || task.status === 'queued' || task.status === 'running') {
    await markRegenerateTaskCancelled(env, taskId);
  }
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
  let watcherDone = false;
  const abortController = new AbortController();
  const stopWatcher = watchRegenerateTaskStop(env, taskId, abortController, () => watcherDone);

  const runStage = async <T>(
    phase: NightlyPhase,
    fn: () => Promise<T>,
    detailsOf?: (result: T) => string
  ): Promise<T | undefined> => {
    await assertTaskActive(env, taskId, abortController.signal);
    await updateTask(env, taskId, { phase, status: 'running', percent: phasePercent(completed) });
    const runId = await startStage(env, userId, date, phase);
    try {
      await assertTaskActive(env, taskId, abortController.signal);
      const result = await fn();
      await assertTaskActive(env, taskId, abortController.signal);
      await completeStage(env, runId, userId, detailsOf ? detailsOf(result) : '');
      completed += 1;
      await updateTask(env, taskId, { percent: phasePercent(completed) });
      return result;
    } catch (err) {
      await failStage(env, runId, userId, err);
      if (isTaskStoppedError(err)) throw err;
      console.warn('[ATRI] nightly phase failed', { userId, date, phase, err });
      completed += 1;
      await updateTask(env, taskId, { percent: phasePercent(completed), error: `${phase}: ${serializeError(err)}` });
      return undefined;
    }
  };

  let diary: DiaryGenerationResult | null = null;
  let transcript = '';

  try {
    // Phase 1: 取或生成日记。取 transcript 是后续 phase 需要的，所以这里也准备好。
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
        modelKey,
        signal: abortController.signal
      });
      return { regenerated: true };
    }, (r) => JSON.stringify(r || {}));
    if (!diary) throw new Error('diary_generation_failed');

    // Phase 2: 保存日记。
    const saved = await runStage('save_diary', async () => {
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
      return { saved: true };
    });
    if (!saved) throw new Error('diary_save_failed');

    // Phase 3: 新日记保存成功后，再清理旧 highlight 向量，避免取消时先删旧数据。
    await runStage('cleanup_vectors', async () => {
      await deleteDiaryVectorsForDate(env, userId, date);
    });

    // Phase 4: 写 highlights 向量。
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

    // Phase 5: 情景记忆 + 意图 + 候选事实。
    await runStage('derived_memories', async () => {
      if (!diary) throw new Error('diary_missing');
      return persistDiaryDerivedMemories(env, { userId, date, diary });
    }, (r) => JSON.stringify(r || {}));

    // Phase 6: 事实合并。
    await runStage('fact_consolidation', async () => {
      await consolidateFactsForUser(env, {
        userId,
        userName: userName || '这个人',
        modelKey,
        date,
        signal: abortController.signal
      });
    });

    // Phase 7: nightly mind（含状态胶囊、三维情绪、自我模型/情绪底色）。
    await runStage('nightly_mind', async () => {
      if (!diary) throw new Error('diary_missing');
      return runNightlyMindForUser(env, {
        userId,
        userName: userName || '这个人',
        date,
        diaryContent: diary.content,
        transcript,
        signal: abortController.signal
      });
    }, (r) => JSON.stringify(r || {}));

    // Phase 8: 事实向量同步。
    await runStage('vector_sync', async () => {
      await syncFactVectorsNightly(env, userId);
    });

    await updateTask(env, taskId, { phase: 'completed', status: 'completed', percent: 100 });
  } catch (err) {
    if (isTaskStoppedError(err)) {
      await settleStoppedTask(env, taskId);
      console.log('[ATRI] regenerate task stopped', { userId, date, taskId });
      return;
    }
    await markRegenerateTaskFailed(env, taskId || '', serializeError(err));
    throw err;
  } finally {
    watcherDone = true;
    abortController.abort('regenerate_task_done');
    await stopWatcher.catch(() => undefined);
  }
}
