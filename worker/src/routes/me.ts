import type { RouterType } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import { requireAppToken } from '../utils/auth';
import { getAtriSelfModel } from '../services/self-model-service';

export function registerMeRoutes(router: RouterType) {
  router.get('/api/v1/me/self-model', async (request: Request, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    const { searchParams } = new URL(request.url);
    const userId =
      (searchParams.get('userId') || '').trim() ||
      (request.headers.get('X-User-Id') || request.headers.get('x-user-id') || '').trim() ||
      'default';

    try {
      const model = await getAtriSelfModel(env, userId);
      return jsonResponse({
        coreTraits: model.coreTraits,
        speechStyle: model.speechStyle,
        relationshipStance: model.relationshipStance,
        emotionalBaseline: model.emotionalBaseline,
        recentChanges: model.recentChanges,
        taboos: model.taboos,
        updatedAt: model.updatedAt ?? null
      });
    } catch (error: unknown) {
      console.error('[ATRI] me/self-model error', error);
      return jsonResponse({ error: 'self_model_failed' }, 500);
    }
  });
}
