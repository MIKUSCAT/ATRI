import type { Router } from 'itty-router';
import { Env, CHAT_MODEL } from '../types';
import { jsonResponse } from '../utils/json-response';
import { requireAppToken } from '../utils/auth';
import { getEffectiveRuntimeSettings, getStoredRuntimeConfigView } from '../services/runtime-settings';

type ProviderModel = {
  id?: string;
  object?: string;
  created?: number;
  owned_by?: string;
  description?: string;
};

function normalizeOpenAiModelPayload(raw: any) {
  const entries: ProviderModel[] = Array.isArray(raw?.data) ? raw.data : [];
  return entries
    .filter((item) => typeof item?.id === 'string')
    .map((item) => ({
      id: item.id || '',
      label: item.id || '',
      provider: item.owned_by || 'unknown',
      note: item.description || ''
    }));
}

function normalizeGeminiModelPayload(raw: any) {
  const entries: any[] = Array.isArray(raw?.models) ? raw.models : [];
  return entries
    .map((item) => {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (!name) return null;
      const label = typeof item?.displayName === 'string' ? item.displayName.trim() : '';
      const desc = typeof item?.description === 'string' ? item.description.trim() : '';
      return {
        id: name,
        label: label || name,
        provider: 'gemini',
        note: desc
      };
    })
    .filter(Boolean);
}

function fallbackModels(settings: any) {
  const models: any[] = [];
  const chat = typeof settings?.defaultChatModel === 'string' ? settings.defaultChatModel.trim() : '';
  const diary = typeof settings?.diaryModel === 'string' ? settings.diaryModel.trim() : '';

  for (const id of [chat, diary]) {
    if (!id) continue;
    models.push({ id, label: id, provider: String(settings?.chatApiFormat || 'unknown'), note: '' });
  }

  if (!models.length) {
    models.push({ id: 'default', label: 'default', provider: String(settings?.chatApiFormat || 'unknown'), note: '' });
  }

  return models;
}

export function registerModelRoutes(router: Router) {
  router.get('/current-model', async (request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const [settings, stored] = await Promise.all([
        getEffectiveRuntimeSettings(env),
        getStoredRuntimeConfigView(env)
      ]);

      const currentModel = settings.defaultChatModel;
      const storedModel = stored.config.defaultChatModel?.trim();

      let source: 'admin' | 'env' | 'default';
      if (storedModel && storedModel === currentModel) {
        source = 'admin';
      } else if (currentModel === CHAT_MODEL) {
        source = 'default';
      } else {
        source = 'env';
      }

      return jsonResponse({ model: currentModel, source });
    } catch (error: any) {
      return jsonResponse(
        { error: 'fetch_current_model_error', details: String(error?.message || error) },
        500
      );
    }
  });

  router.get('/models', async (request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const settings = await getEffectiveRuntimeSettings(env);
      const apiUrl = String(settings.openaiApiUrl || '').trim();
      const apiKey = String(settings.openaiApiKey || '').trim();
      if (!apiUrl || !apiKey) {
        return jsonResponse({ error: 'missing_api_config' }, 500);
      }

      const apiBaseUrl = apiUrl.replace(/\/+$/, '');
      const versionedApiUrl = settings.chatApiFormat === 'gemini' ? `${apiBaseUrl}/v1beta` : `${apiBaseUrl}/v1`;

      if (settings.chatApiFormat === 'gemini') {
        try {
          const url = new URL(`${versionedApiUrl}/models`);
          url.searchParams.set('key', apiKey);
          const response = await fetch(url.toString(), {
            headers: {
              'x-goog-api-key': apiKey,
              'Content-Type': 'application/json'
            }
          });
          if (!response.ok) {
            const errorText = await response.text();
            return jsonResponse(
              { models: fallbackModels(settings), warning: 'model_fetch_failed', details: errorText },
              200
            );
          }
          const payload = await response.json();
          const models = normalizeGeminiModelPayload(payload);
          return jsonResponse({ models: models.length ? models : fallbackModels(settings) });
        } catch (error: any) {
          return jsonResponse(
            {
              models: fallbackModels(settings),
              warning: 'model_fetch_error',
              details: String(error?.message || error)
            },
            200
          );
        }
      }

      if (settings.chatApiFormat !== 'openai') {
        return jsonResponse({ models: fallbackModels(settings), warning: 'provider_no_models_endpoint' });
      }

      const response = await fetch(`${versionedApiUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        return jsonResponse({ error: 'model_fetch_failed', details: errorText }, response.status);
      }
      const payload = await response.json();
      const models = normalizeOpenAiModelPayload(payload);
      return jsonResponse({ models });
    } catch (error: any) {
      console.error('[ATRI] 模型列表请求失败', error);
      return jsonResponse({ error: 'model_fetch_error', details: String(error?.message || error) }, 500);
    }
  });
}
