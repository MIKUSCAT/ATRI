import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import { requireAppToken } from '../utils/auth';
import { fetchPendingProactiveMessages, markProactiveMessagesDelivered } from '../services/data-service';

export function registerProactiveRoutes(router: Router) {
  router.get('/proactive/pending', async (request, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    const { searchParams } = new URL(request.url);
    const userId = String(searchParams.get('userId') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || '20');
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
    if (!userId) {
      return jsonResponse({ error: 'missing_user' }, 400);
    }

    try {
      const messages = await fetchPendingProactiveMessages(env, { userId, limit });
      if (messages.length) {
        await markProactiveMessagesDelivered(env, {
          userId,
          ids: messages.map((msg) => msg.id),
          deliveredAt: Date.now()
        });
      }
      return jsonResponse({ messages });
    } catch (error: any) {
      console.error('[ATRI] proactive pending error', { userId, error: String(error?.message || error) });
      return jsonResponse({ error: 'proactive_pending_failed', details: String(error?.message || error) }, 500);
    }
  });
}
