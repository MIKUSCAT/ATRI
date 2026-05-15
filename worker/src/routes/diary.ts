import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import {
  fetchConversationLogs,
  getDiaryEntry,
  listDiaryEntries
} from '../services/data-service';
import { requireAppToken } from '../utils/auth';
import {
  createRegenerateTask,
  expireStaleRegenerateTask,
  getRegenerateTask,
  markRegenerateTaskFailed,
  requestCancelRegenerateTask,
  TOTAL_PHASES
} from '../services/nightly-orchestrator';

export function registerDiaryRoutes(router: any) {
  router.get('/diary', async (request: any, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '';
    const date = searchParams.get('date') || '';
    if (!userId || !date) {
      return jsonResponse({ error: 'missing_params' }, 400);
    }

    const entry = await getDiaryEntry(env, userId, date);
    if (!entry) {
      return jsonResponse({ status: 'missing' });
    }
    return jsonResponse({ status: entry.status, entry });
  });

  router.get('/diary/list', async (request: any, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '';
    const limit = Number(searchParams.get('limit') || '7');
    if (!userId) {
      return jsonResponse({ error: 'missing_params' }, 400);
    }
    const entries = await listDiaryEntries(env, userId, Math.min(Math.max(limit, 1), 30));
    return jsonResponse({ entries });
  });

  router.post('/diary/regenerate', async (request: any, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400);
    }

    const userId = String(body?.userId || '').trim();
    const date = String(body?.date || '').trim();
    if (!userId || !date) {
      return jsonResponse({ error: 'missing_params' }, 400);
    }

    const logs = await fetchConversationLogs(env, userId, date);
    if (!logs.length) {
      return jsonResponse({ error: 'no_conversation_logs' }, 404);
    }

    const taskId = crypto.randomUUID();
    await createRegenerateTask(env, { taskId, userId, date });

    try {
      await env.DIARY_QUEUE.send({ kind: 'diary-regenerate', taskId });
    } catch (err) {
      await markRegenerateTaskFailed(env, taskId, err instanceof Error ? err.message : String(err));
      console.error('[ATRI] enqueue diary regenerate failed', { userId, date, taskId, err });
      return jsonResponse({ error: 'enqueue_failed' }, 500);
    }

    return jsonResponse({ taskId, status: 'queued' }, 202);
  });

  router.post('/diary/regenerate/cancel', async (request: any, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400);
    }

    const taskId = String(body?.taskId || body?.task_id || '').trim();
    const userId = String(body?.userId || body?.user_id || '').trim();
    if (!taskId || !userId) {
      return jsonResponse({ error: 'missing_params' }, 400);
    }

    const task = await requestCancelRegenerateTask(env, { taskId, userId });
    if (!task) {
      return jsonResponse({ error: 'task_not_found' }, 404);
    }

    return jsonResponse(formatRegenerateTask(task));
  });

  router.get('/diary/regenerate/status', async (request: any, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    const { searchParams } = new URL(request.url);
    const taskId = String(searchParams.get('taskId') || '').trim();
    if (!taskId) {
      return jsonResponse({ error: 'missing_params' }, 400);
    }

    await expireStaleRegenerateTask(env, taskId);
    const task = await getRegenerateTask(env, taskId);
    if (!task) {
      return jsonResponse({ error: 'task_not_found' }, 404);
    }

    return jsonResponse(formatRegenerateTask(task));
  });
}

function formatRegenerateTask(task: NonNullable<Awaited<ReturnType<typeof getRegenerateTask>>>) {
  return {
    taskId: task.taskId,
    userId: task.userId,
    date: task.date,
    currentPhase: task.phase,
    status: task.status,
    percent: task.percent,
    totalPhases: TOTAL_PHASES,
    error: task.error || null,
    updatedAt: task.updatedAt
  };
}
