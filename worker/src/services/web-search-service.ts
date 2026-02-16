import { Env } from '../types';
import { getEffectiveRuntimeSettings } from './runtime-settings';

type TavilySearchResponse = {
  results?: Array<{
    title?: string;
    content?: string;
    url?: string;
    score?: number;
    raw_content?: string | null;
  }>;
  answer?: string;
  query?: string;
};

export type WebSearchItem = {
  title: string;
  snippet: string;
};

function truncateText(text: string, maxChars: number) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

async function tavilySearchRequest(
  apiKey: string,
  payload: Record<string, unknown>,
  options: { timeoutMs: number; useAuthHeader?: boolean }
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (options.useAuthHeader) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function webSearch(
  env: Env,
  params: { query: string; maxResults?: number; timeoutMs?: number }
): Promise<WebSearchItem[]> {
  const settings = await getEffectiveRuntimeSettings(env);
  const apiKey = String(settings.tavilyApiKey || '').trim();
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is missing');
  }

  const query = String(params.query || '').trim();
  if (!query) return [];

  const maxResults = Math.min(Math.max(1, Number(params.maxResults ?? 5)), 8);
  const timeoutMs = Math.min(Math.max(3000, Number(params.timeoutMs ?? 12000)), 30000);

  const basePayload = {
    query,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    include_images: false
  };

  const bodyPayload = { ...basePayload, api_key: apiKey };
  let response = await tavilySearchRequest(apiKey, bodyPayload, { timeoutMs });

  if (!response.ok) {
    const retryPayload = { ...basePayload };
    response = await tavilySearchRequest(apiKey, retryPayload, { timeoutMs, useAuthHeader: true });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily API error: ${response.status} ${text}`);
  }

  const data = (await response.json()) as TavilySearchResponse;
  const results = Array.isArray(data?.results) ? data.results : [];

  return results
    .map((item) => {
      const title = truncateText(item?.title || '', 80);
      const snippetRaw = item?.content || '';
      const snippet = truncateText(snippetRaw, 220);
      return {
        title: title || truncateText(snippet, 30) || '（无标题）',
        snippet
      };
    })
    .filter((item) => item.title || item.snippet)
    .slice(0, maxResults);
}
