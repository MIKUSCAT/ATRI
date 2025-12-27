import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import { requireAppToken } from '../utils/auth';

// OpenAI 格式的模型信息
type OpenAIModel = {
  id?: string;
  object?: string;
  created?: number;
  owned_by?: string;
  description?: string;
};

// Gemini 格式的模型信息
type GeminiModel = {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
};

// 统一的模型输出格式
type NormalizedModel = {
  id: string;
  label: string;
  provider: string;
  note: string;
};

export function registerModelRoutes(router: Router) {
  router.get('/models', async (request: Request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const allModels: NormalizedModel[] = [];

      // 尝试从 Gemini API 获取模型列表
      const geminiModels = await fetchGeminiModels(env);
      allModels.push(...geminiModels);

      // 尝试从 OpenAI 兼容 API 获取模型列表
      const openaiModels = await fetchOpenAIModels(env);
      allModels.push(...openaiModels);

      // 去重（基于 id）
      const uniqueModels = deduplicateModels(allModels);

      return jsonResponse({ models: uniqueModels });
    } catch (error: any) {
      console.error('[ATRI] 模型列表请求失败', error);
      return jsonResponse({ error: 'model_fetch_error', details: String(error?.message || error) }, 500);
    }
  });
}

/**
 * 从 Gemini 原生 API 获取模型列表
 */
async function fetchGeminiModels(env: Env): Promise<NormalizedModel[]> {
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  const apiUrl = (env.GEMINI_API_URL || '').trim();

  if (!apiKey || !apiUrl) {
    return [];
  }

  try {
    const response = await fetch(`${apiUrl}/v1beta/models?key=${apiKey}`, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.warn('[ATRI] Gemini 模型列表请求失败:', response.status);
      return [];
    }

    const payload = await response.json() as { models?: GeminiModel[] };
    return normalizeGeminiPayload(payload);
  } catch (error: any) {
    console.warn('[ATRI] Gemini 模型列表请求异常:', error?.message || error);
    return [];
  }
}

/**
 * 从 OpenAI 兼容 API 获取模型列表
 */
async function fetchOpenAIModels(env: Env): Promise<NormalizedModel[]> {
  const apiKey = (env.OPENAI_API_KEY || '').trim();
  const apiUrl = (env.OPENAI_API_URL || '').trim();

  if (!apiKey || !apiUrl) {
    return [];
  }

  try {
    const response = await fetch(`${apiUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.warn('[ATRI] OpenAI 模型列表请求失败:', response.status);
      return [];
    }

    const payload = await response.json();
    return normalizeOpenAIPayload(payload);
  } catch (error: any) {
    console.warn('[ATRI] OpenAI 模型列表请求异常:', error?.message || error);
    return [];
  }
}

/**
 * 标准化 Gemini API 返回的模型列表
 * Gemini 格式: { models: [{ name: "models/gemini-2.0-flash", displayName: "...", ... }] }
 */
function normalizeGeminiPayload(raw: { models?: GeminiModel[] }): NormalizedModel[] {
  const entries: GeminiModel[] = Array.isArray(raw?.models) ? raw.models : [];
  return entries
    .filter(item => typeof item?.name === 'string')
    // 只保留支持 generateContent 的模型（用于聊天）
    .filter(item => item.supportedGenerationMethods?.includes('generateContent'))
    .map(item => {
      // Gemini 的 name 格式是 "models/gemini-2.0-flash"，需要提取模型 ID
      const modelId = item.name?.replace(/^models\//, '') || '';
      return {
        id: modelId,
        label: item.displayName || modelId,
        provider: 'google',
        note: item.description || ''
      };
    });
}

/**
 * 标准化 OpenAI 兼容 API 返回的模型列表
 * OpenAI 格式: { data: [{ id: "gpt-4", owned_by: "openai", ... }] }
 */
function normalizeOpenAIPayload(raw: any): NormalizedModel[] {
  const entries: OpenAIModel[] = Array.isArray(raw?.data) ? raw.data : [];
  return entries
    .filter(item => typeof item?.id === 'string')
    .map(item => ({
      id: item.id || '',
      label: item.id || '',
      provider: item.owned_by || 'unknown',
      note: item.description || ''
    }));
}

/**
 * 根据 id 去重模型列表
 */
function deduplicateModels(models: NormalizedModel[]): NormalizedModel[] {
  const seen = new Set<string>();
  return models.filter(model => {
    if (seen.has(model.id)) {
      return false;
    }
    seen.add(model.id);
    return true;
  });
}
