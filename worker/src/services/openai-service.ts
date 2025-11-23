import { CHAT_MODEL, Env } from '../types';

export class ChatCompletionError extends Error {
  status: number;
  details: string;

  constructor(status: number, details: string) {
    super(`Chat Completions API error: ${status}`);
    this.status = status;
    this.details = details;
  }
}

export async function callChatCompletions(
  env: Env,
  payload: Record<string, unknown>,
  options?: { timeoutMs?: number; model?: string }
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? 60000;
  const model = options?.model ?? CHAT_MODEL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${env.OPENAI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
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
      throw new ChatCompletionError(response.status, errorText);
    }

    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new ChatCompletionError(504, `Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
