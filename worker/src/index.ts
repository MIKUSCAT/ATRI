import { Router } from 'itty-router';
import { registerMediaRoutes } from './routes/media';
import { registerChatRoutes } from './routes/chat';
import { registerDiaryRoutes } from './routes/diary';
import { registerConversationRoutes } from './routes/conversation';
import { registerAdminRoutes } from './routes/admin';
import { runDiaryCron } from './jobs/diary-cron';
import { Env } from './types';
import { registerModelRoutes } from './routes/models';

const router = Router();

registerMediaRoutes(router);
registerChatRoutes(router);
registerDiaryRoutes(router);
registerConversationRoutes(router);
registerAdminRoutes(router);
registerModelRoutes(router);

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
    ctx.waitUntil(runDiaryCron(env));
  }
};
