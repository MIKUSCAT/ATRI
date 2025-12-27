import type { Router } from 'itty-router';
import { Env } from '../types';
import { checkAndGenerateProactiveMessage } from '../services/proactive-service';
import { getProactiveSettings, updateProactiveSettings } from '../services/proactive-scheduler';
import { jsonResponse } from '../utils/json-response';
import { requireAppToken } from '../utils/auth';

export function registerProactiveRoutes(router: Router) {
  router.get('/proactive/check', async (request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const url = new URL(request.url);
      const userId = url.searchParams.get('userId');
      const timeZone = url.searchParams.get('timeZone') || 'Asia/Shanghai';
      
      if (!userId) {
        return jsonResponse({ error: 'userId required' }, 400);
      }
      
      const result = await checkAndGenerateProactiveMessage(env, userId, timeZone);
      return jsonResponse(result);
    } catch (error) {
      console.error('[ATRI] proactive check failed', error);
      return jsonResponse({ error: 'Internal error' }, 500);
    }
  });

  router.get('/proactive/settings', async (request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const url = new URL(request.url);
      const userId = url.searchParams.get('userId');
      
      if (!userId) {
        return jsonResponse({ error: 'userId required' }, 400);
      }
      
      const settings = await getProactiveSettings(env, userId);
      return jsonResponse(settings);
    } catch (error) {
      console.error('[ATRI] get proactive settings failed', error);
      return jsonResponse({ error: 'Internal error' }, 500);
    }
  });

  router.post('/proactive/settings', async (request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const body = await request.json() as any;
      const userId = body.userId;
      
      if (!userId) {
        return jsonResponse({ error: 'userId required' }, 400);
      }
      
      await updateProactiveSettings(env, userId, body);
      return jsonResponse({ ok: true });
    } catch (error) {
      console.error('[ATRI] update proactive settings failed', error);
      return jsonResponse({ error: 'Internal error' }, 500);
    }
  });
}