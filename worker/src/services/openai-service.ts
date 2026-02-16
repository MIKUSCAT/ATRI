import { CHAT_MODEL, Env } from '../types';

export class ChatCompletionError extends Error {
  provider: string;
  status: number;
  details: string;

  constructor(provider: string, status: number, details: string) {
    super(`LLM API error (${provider}): ${status}`);
    this.provider = provider;
    this.status = status;
    this.details = details;
  }
}

export async function callChatCompletions(
  env: Env,
  payload: Record<string, unknown>,
  options?: { timeoutMs?: number; model?: string; apiUrl?: string; apiKey?: string }
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? 60000;
  const model = options?.model ?? CHAT_MODEL;
  const apiUrl = (options?.apiUrl || env.OPENAI_API_URL || '').trim();
  const apiKey = (options?.apiKey || env.OPENAI_API_KEY || '').trim();
  if (!apiUrl || !apiKey) {
    throw new ChatCompletionError('openai', 500, 'missing_api_config');
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        ...payload
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ChatCompletionError('openai', response.status, errorText);
    }

    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new ChatCompletionError('openai', 504, `Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
