import { Env } from '../types';
import { fetchConversationLogs } from './data-service';
import {
  claimRegenerateTask,
  getRegenerateTask,
  markRegenerateTaskCancelled,
  markRegenerateTaskFailed,
  runFullNightlyForDate
} from './nightly-orchestrator';

export type DiaryQueueMessage = { kind: 'diary-regenerate'; taskId: string };

export async function processDiaryTaskQueueBatch(batch: MessageBatch<DiaryQueueMessage>, env: Env) {
  for (const message of batch.messages) {
    const taskId = String(message.body?.taskId || '').trim();
    try {
      if (taskId) await processDiaryRegenerateTask(env, taskId);
      message.ack();
    } catch (e) {
      console.error('[ATRI] diary_task_queue_failed', { taskId, e });
      message.retry({ delaySeconds: 10 });
    }
  }
}

async function processDiaryRegenerateTask(env: Env, taskId: string) {
  const claimed = await claimRegenerateTask(env, taskId);
  if (!claimed) return;

  try {
    const logs = await fetchConversationLogs(env, claimed.userId, claimed.date);
    if (!logs.length) {
      await markRegenerateTaskFailed(env, taskId, 'no_conversation_logs');
      return;
    }

    const userName = logs.find(l => l.role === 'user' && l.userName)?.userName
      || logs.find(l => l.userName)?.userName
      || '这个人';

    await runFullNightlyForDate(env, {
      userId: claimed.userId,
      userName,
      date: claimed.date,
      modelKey: null,
      taskId,
      forceRegenerate: true
    });

    const latest = await getRegenerateTask(env, taskId);
    if (latest?.status === 'cancel_requested') {
      await markRegenerateTaskCancelled(env, taskId);
    }
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await markRegenerateTaskFailed(env, taskId, msg || 'diary_regenerate_failed');
  }
}
