import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import { requireAppToken } from '../utils/auth';

type ProviderModel = {
  id?: string;
  object?: string;
  created?: number;
  owned_by?: string;
  description?: string;
};

export function registerModelRoutes(router: Router) {
  router.get('/models', async (request: Request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const response = await fetch(`${env.OPENAI_API_URL}/models`, {
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        return jsonResponse({ error: 'model_fetch_failed', details: errorText }, response.status);
      }
      const payload = await response.json();
      const models = normalizeModelPayload(payload);
      return jsonResponse({ models });
    } catch (error: any) {
      console.error('[ATRI] 模型列表请求失败', error);
      return jsonResponse({ error: 'model_fetch_error', details: String(error?.message || error) }, 500);
    }
  });
}

function normalizeModelPayload(raw: any) {
  const entries: ProviderModel[] = Array.isArray(raw?.data) ? raw.data : [];
  return entries
    .filter(item => typeof item?.id === 'string')
    .map(item => ({
      id: item.id || '',
      label: item.id || '',
      provider: item.owned_by || 'unknown',
      note: item.description || ''
    }));
}
