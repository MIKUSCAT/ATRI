import { Router } from 'itty-router';
import { registerMediaRoutes } from './routes/media';
import { registerChatRoutes } from './routes/chat';
import { registerDiaryRoutes } from './routes/diary';
import { registerConversationRoutes } from './routes/conversation';
import { registerAdminRoutes } from './routes/admin';
import { runDiaryCron } from './jobs/diary-cron';
import { Env } from './types';
import { registerModelRoutes } from './routes/models';
import { registerCompatRoutes } from './routes/compat';
import { registerProactiveRoutes } from './routes/proactive';
import { runProactiveCron } from './jobs/proactive-cron';

const router = Router();
const DIARY_CRON_EXPR = '59 15 * * *';
const PROACTIVE_CRON_EXPR = '*/30 * * * *';

registerMediaRoutes(router);
registerChatRoutes(router);
registerDiaryRoutes(router);
registerConversationRoutes(router);
registerAdminRoutes(router);
registerModelRoutes(router);
registerCompatRoutes(router);
registerProactiveRoutes(router);

router.get('/health', () => jsonOk());

router.options('*', () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Token, Authorization, X-File-Name, X-File-Type, X-File-Size, X-User-Id'
    }
  });
});

router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
  fetch: router.fetch,
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    const cron = String(event.cron || '').trim();

    if (!cron) {
      ctx.waitUntil(runDiaryCron(env));
      ctx.waitUntil(runProactiveCron(env));
      return;
    }

    if (cron === DIARY_CRON_EXPR) {
      ctx.waitUntil(runDiaryCron(env));
      return;
    }

    if (cron === PROACTIVE_CRON_EXPR) {
      ctx.waitUntil(runProactiveCron(env));
      return;
    }

    ctx.waitUntil(runDiaryCron(env));
    ctx.waitUntil(runProactiveCron(env));
  }
};

function jsonOk() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
