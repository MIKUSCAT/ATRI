import type { ContentPart, Env } from '../types';
import { CHAT_MODEL } from '../types';
import { normalizeMimeType, resolveFetchedImageMimeType } from '../utils/image-mime';

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

export type UpstreamApiFormat = 'openai' | 'anthropic' | 'gemini';

export type OpenAiToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type UpstreamMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  name?: string;
};

export function buildAssistantToolMessageForContinuation(message: {
  content: string | null;
  tool_calls: OpenAiToolCall[];
}): UpstreamMessage {
  return {
    role: 'assistant',
    content: message.content ?? null,
    tool_calls: message.tool_calls
  };
}

function joinUrl(base: string, suffix: string) {
  const left = String(base || '').trim().replace(/\/+$/, '');
  const right = String(suffix || '').trim().replace(/^\/+/, '');
  return `${left}/${right}`;
}

function withAutoApiVersion(apiBaseUrl: string, format: UpstreamApiFormat) {
  if (format === 'gemini') return joinUrl(apiBaseUrl, 'v1beta');
  return joinUrl(apiBaseUrl, 'v1');
}

function normalizeFormat(raw: unknown): UpstreamApiFormat {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (text === 'anthropic') return 'anthropic';
  if (text === 'gemini') return 'gemini';
  return 'openai';
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const text = String(dataUrl || '').trim();
  if (!text.startsWith('data:')) return null;
  const comma = text.indexOf(',');
  if (comma === -1) return null;
  const header = text.slice(5, comma);
  const data = text.slice(comma + 1);
  if (!/;base64/i.test(header)) return null;
  const mimeType = normalizeMimeType(header.replace(/;base64/i, '').trim()) || 'application/octet-stream';
  const base64 = data.trim();
  return base64 ? { mimeType, base64 } : null;
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function extractR2MediaKey(url: URL): string | null {
  if (url.pathname.startsWith('/media/')) {
    return url.pathname.slice('/media/'.length).replace(/^\/+/, '') || null;
  }
  if (url.pathname.startsWith('/media-s/')) {
    return url.pathname.split('/').slice(4).join('/').replace(/^\/+/, '') || null;
  }
  return null;
}

async function readR2ImageAsBase64(env: Env, url: URL) {
  const key = extractR2MediaKey(url);
  if (!key) return null;
  const object = await env.MEDIA_BUCKET.get(key);
  if (!object?.body) return null;
  const arrayBuffer = await object.arrayBuffer();
  const contentType = String(object.httpMetadata?.contentType || '').split(';')[0].trim();
  return {
    mimeType: resolveFetchedImageMimeType({ source: url.toString(), declaredMime: contentType, bytes: arrayBuffer }),
    base64: toBase64(arrayBuffer)
  };
}

async function resolveImageAsBase64(env: Env, urlLike: string) {
  const trimmed = String(urlLike || '').trim();
  if (!trimmed) return null;

  const dataUrl = parseDataUrl(trimmed);
  if (dataUrl) return dataUrl;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const r2Image = await readR2ImageAsBase64(env, url);
  if (r2Image) return r2Image;

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim();
    const arrayBuffer = await res.arrayBuffer();
    return {
      mimeType: resolveFetchedImageMimeType({ source: url.toString(), declaredMime: contentType, bytes: arrayBuffer }),
      base64: toBase64(arrayBuffer)
    };
  } catch {
    return null;
  }
}

function buildSystemText(messages: UpstreamMessage[]) {
  const lines: string[] = [];
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (msg?.role !== 'system') continue;
    if (typeof msg.content === 'string' && msg.content.trim()) lines.push(msg.content.trim());
  }
  return lines.join('\n\n');
}

async function openAiContentToAnthropicBlocks(env: Env, content: UpstreamMessage['content']): Promise<any[]> {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) {
    const text = content == null ? '' : String(content);
    return text ? [{ type: 'text', text }] : [];
  }

  const out: any[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      if (part.text) out.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'image_url') {
      const resolved = await resolveImageAsBase64(env, part.image_url?.url || '');
      if (!resolved) throw new ChatCompletionError('image', 422, 'image_unreadable');
      out.push({ type: 'image', source: { type: 'base64', media_type: resolved.mimeType, data: resolved.base64 } });
    }
  }
  return out;
}

async function openAiContentToGeminiParts(env: Env, content: UpstreamMessage['content']): Promise<any[]> {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) {
    const text = content == null ? '' : String(content);
    return text ? [{ text }] : [];
  }

  const out: any[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      if (part.text) out.push({ text: part.text });
      continue;
    }
    if (part.type === 'image_url') {
      const resolved = await resolveImageAsBase64(env, part.image_url?.url || '');
      if (!resolved) throw new ChatCompletionError('image', 422, 'image_unreadable');
      out.push({ inlineData: { mimeType: resolved.mimeType, data: resolved.base64 } });
    }
  }
  return out;
}

async function openAiMessagesToAnthropic(env: Env, messages: UpstreamMessage[]) {
  const system = buildSystemText(messages);
  const out: any[] = [];
  let pendingToolResults: any[] = [];

  const flushToolResults = () => {
    if (!pendingToolResults.length) return;
    out.push({ role: 'user', content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || msg.role === 'system') continue;

    if (msg.role === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
      const toolUseId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : '';
      if (toolUseId) pendingToolResults.push({ type: 'tool_result', tool_use_id: toolUseId, content });
      continue;
    }

    flushToolResults();

    if (msg.role === 'user') {
      const blocks = await openAiContentToAnthropicBlocks(env, msg.content);
      out.push({ role: 'user', content: blocks.length ? blocks : [{ type: 'text', text: '[空消息]' }] });
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks: any[] = [];
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text) blocks.push({ type: 'text', text });
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const call of toolCalls) {
        const name = String(call?.function?.name || '').trim();
        if (!name) continue;
        let input: any = {};
        try {
          input = JSON.parse(String(call?.function?.arguments || '') || '{}');
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: String(call?.id || '').trim() || `tool_${Date.now()}`, name, input });
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] });
    }
  }

  flushToolResults();
  return { system, messages: out };
}

async function openAiMessagesToGemini(env: Env, messages: UpstreamMessage[]) {
  const system = buildSystemText(messages);
  const contents: any[] = [];
  let pendingToolResponses: any[] = [];

  const flushToolResponses = () => {
    if (!pendingToolResponses.length) return;
    contents.push({ role: 'user', parts: pendingToolResponses });
    pendingToolResponses = [];
  };

  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || msg.role === 'system') continue;

    if (msg.role === 'tool') {
      const name = typeof msg.name === 'string' ? msg.name.trim() : '';
      const content = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
      if (name) pendingToolResponses.push({ functionResponse: { name, response: { result: content } } });
      continue;
    }

    flushToolResponses();

    if (msg.role === 'user') {
      const parts = await openAiContentToGeminiParts(env, msg.content);
      contents.push({ role: 'user', parts: parts.length ? parts : [{ text: '[空消息]' }] });
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: any[] = [];
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text) parts.push({ text });
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const call of toolCalls) {
        const name = String(call?.function?.name || '').trim();
        if (!name) continue;
        let args: any = {};
        try {
          args = JSON.parse(String(call?.function?.arguments || '') || '{}');
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name, args } });
      }
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
    }
  }

  flushToolResponses();
  return { systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents };
}

function openAiToolsToAnthropic(tools: any[]) {
  const out: any[] = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const fn = tool?.function;
    const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      description: typeof fn?.description === 'string' ? fn.description : undefined,
      input_schema: fn?.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object' }
    });
  }
  return out;
}

function openAiToolsToGemini(tools: any[]) {
  const out: any[] = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const fn = tool?.function;
    const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      description: typeof fn?.description === 'string' ? fn.description : undefined,
      parameters: fn?.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object' }
    });
  }
  return out;
}

function normalizeToolArguments(argumentsLike: unknown): string {
  if (typeof argumentsLike === 'string') return argumentsLike;
  if (argumentsLike == null) return '{}';
  try {
    return JSON.stringify(argumentsLike);
  } catch {
    return '{}';
  }
}

function normalizeOpenAiToolCall(rawCall: any, fallbackId: string): OpenAiToolCall | null {
  if (!rawCall || typeof rawCall !== 'object') return null;
  const fn = rawCall.function && typeof rawCall.function === 'object'
    ? rawCall.function
    : rawCall.function_call && typeof rawCall.function_call === 'object'
      ? rawCall.function_call
      : null;
  const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
  if (!name) return null;
  return {
    id: typeof rawCall.id === 'string' && rawCall.id.trim() ? rawCall.id.trim() : fallbackId,
    type: 'function',
    function: { name, arguments: normalizeToolArguments(fn.arguments) }
  };
}

function extractOpenAiAssistantMessage(data: any) {
  const message = data?.choices?.[0]?.message;
  const content = typeof message?.content === 'string' ? message.content : message?.content ?? null;
  const rawToolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.toolCalls)
      ? message.toolCalls
      : [];
  const toolCalls: OpenAiToolCall[] = [];
  for (let i = 0; i < rawToolCalls.length; i++) {
    const call = normalizeOpenAiToolCall(rawToolCalls[i], `tool_${Date.now()}_${i}`);
    if (call) toolCalls.push(call);
  }
  if (!toolCalls.length) {
    const legacyFn = message?.function_call && typeof message.function_call === 'object'
      ? message.function_call
      : message?.functionCall && typeof message.functionCall === 'object'
        ? message.functionCall
        : null;
    const call = legacyFn
      ? normalizeOpenAiToolCall({ id: message?.id, type: 'function', function: legacyFn }, `tool_${Date.now()}_legacy`)
      : null;
    if (call) toolCalls.push(call);
  }
  return { content, toolCalls };
}

function extractAnthropicAssistantMessage(data: any) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const texts: string[] = [];
  const toolCalls: OpenAiToolCall[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'thinking' || block.type === 'redacted_thinking') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      texts.push(block.text);
      continue;
    }
    if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name.trim() : '';
      if (!name) continue;
      const id = typeof block.id === 'string' ? block.id.trim() : '';
      const argsObj = block.input && typeof block.input === 'object' ? block.input : {};
      toolCalls.push({ id: id || `tool_${Date.now()}`, type: 'function', function: { name, arguments: JSON.stringify(argsObj) } });
    }
  }

  const content = texts.join('\n').trim();
  return { content: content || null, toolCalls };
}

function extractGeminiAssistantMessage(data: any) {
  const parts = data?.candidates?.[0]?.content?.parts;
  const list = Array.isArray(parts) ? parts : [];
  const texts: string[] = [];
  const toolCalls: OpenAiToolCall[] = [];

  for (let i = 0; i < list.length; i++) {
    const part = list[i];
    if (!part || typeof part !== 'object') continue;
    if (part.thought === true) continue;
    if (typeof part.text === 'string' && part.text) {
      texts.push(part.text);
      continue;
    }
    const fc = part.functionCall;
    const name = typeof fc?.name === 'string' ? fc.name.trim() : '';
    if (!name) continue;
    const argsObj = fc.args && typeof fc.args === 'object' ? fc.args : {};
    toolCalls.push({ id: `gemini_${Date.now()}_${i}`, type: 'function', function: { name, arguments: JSON.stringify(argsObj) } });
  }

  const content = texts.join('\n').trim();
  return { content: content || null, toolCalls };
}

function logCall(params: { format: UpstreamApiFormat; model: string; scope?: string; userId?: string; loop?: number }) {
  console.log('[ATRI] llm_call', params);
}

function logFailure(params: {
  format: UpstreamApiFormat;
  status: number;
  userId?: string;
  scope?: string;
  loop?: number;
  details: string;
}) {
  console.error('[ATRI] llm_call_failed', params);
}

export async function callUpstreamChat(env: Env, params: {
  format: UpstreamApiFormat;
  apiUrl: string;
  apiKey: string;
  model: string;
  messages: UpstreamMessage[];
  tools?: any[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  trace?: { scope?: string; userId?: string; loop?: number };
}): Promise<{ message: { content: string | null; tool_calls: OpenAiToolCall[] }; raw: any }> {
  const format = normalizeFormat(params.format);
  const apiUrl = String(params.apiUrl || '').trim();
  const apiKey = String(params.apiKey || '').trim();
  const model = String(params.model || '').trim();
  const timeoutMs = params.timeoutMs ?? 85000;
  const trace = params.trace || {};

  if (!apiUrl || !apiKey || !model) {
    throw new ChatCompletionError(format, 500, 'missing_api_config');
  }

  logCall({ format, model, scope: trace.scope, userId: trace.userId, loop: trace.loop });
  const versionedApiUrl = withAutoApiVersion(apiUrl, format);

  try {
    if (format === 'openai') {
      const body: any = {
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tools?.length ? 'auto' : undefined,
        temperature: params.temperature,
        stream: false,
        max_tokens: params.maxTokens
      };
      const response = await callChatCompletions(env, body, { timeoutMs, model, apiUrl: versionedApiUrl, apiKey });
      const data = await response.json();
      const extracted = extractOpenAiAssistantMessage(data);
      return { message: { content: extracted.content, tool_calls: extracted.toolCalls }, raw: data };
    }

    if (format === 'anthropic') {
      const { system, messages } = await openAiMessagesToAnthropic(env, params.messages);
      const anthropicTools = openAiToolsToAnthropic(params.tools || []);
      const body: any = {
        model,
        max_tokens: Math.max(1, Math.trunc(params.maxTokens ?? 1024)),
        temperature: typeof params.temperature === 'number' ? params.temperature : undefined,
        system: system || undefined,
        messages,
        tools: anthropicTools.length ? anthropicTools : undefined,
        tool_choice: anthropicTools.length ? { type: 'auto' } : undefined
      };
      const data = await postJsonWithTimeout('anthropic', joinUrl(versionedApiUrl, 'messages'), apiKey, body, timeoutMs);
      const extracted = extractAnthropicAssistantMessage(data);
      return { message: { content: extracted.content, tool_calls: extracted.toolCalls }, raw: data };
    }

    const { systemInstruction, contents } = await openAiMessagesToGemini(env, params.messages);
    const decls = openAiToolsToGemini(params.tools || []);
    const modelName = model.startsWith('models/') ? model.slice('models/'.length) : model;
    const url = new URL(joinUrl(versionedApiUrl, `models/${encodeURIComponent(modelName)}:generateContent`));
    url.searchParams.set('key', apiKey);
    const body: any = {
      contents,
      systemInstruction,
      generationConfig: {
        temperature: typeof params.temperature === 'number' ? params.temperature : undefined,
        maxOutputTokens: Math.max(1, Math.trunc(params.maxTokens ?? 1024))
      },
      tools: decls.length ? [{ functionDeclarations: decls }] : undefined,
      toolConfig: decls.length ? { functionCallingConfig: { mode: 'AUTO' } } : undefined
    };
    const data = await postJsonWithTimeout('gemini', url.toString(), apiKey, body, timeoutMs);
    const extracted = extractGeminiAssistantMessage(data);
    return { message: { content: extracted.content, tool_calls: extracted.toolCalls }, raw: data };
  } catch (error: any) {
    const status = error instanceof ChatCompletionError ? error.status : 500;
    const details = error instanceof ChatCompletionError
      ? error.details
      : error?.name === 'AbortError'
        ? `Request timeout after ${timeoutMs}ms`
        : String(error?.message || error);
    logFailure({ format, status, userId: trace.userId, scope: trace.scope, loop: trace.loop, details: details.slice(0, 2000) });
    if (error?.name === 'AbortError') throw new ChatCompletionError(format, 504, `Request timeout after ${timeoutMs}ms`);
    throw error;
  }
}

async function postJsonWithTimeout(provider: UpstreamApiFormat, url: string, apiKey: string, body: any, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-goog-api-key': apiKey,
        'authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ChatCompletionError(provider, res.status, text);
    }
    return await res.json();
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new ChatCompletionError(provider, 504, `Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
