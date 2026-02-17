import fs from 'node:fs/promises';
import path from 'node:path';
import type { Env } from '../runtime/types';
import { pushAppLog } from '../admin/log-buffer';
import { callChatCompletions, ChatCompletionError } from './openai-service';

export type UpstreamApiFormat = 'openai' | 'anthropic' | 'gemini';

type OpenAiToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | any[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string; name?: string };

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

function safeHost(urlLike: string) {
  const raw = String(urlLike || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch {
    return '';
  }
}

function truncateText(value: unknown, maxChars: number) {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function summarizeMessages(messages: any[], limit = 8) {
  const src = Array.isArray(messages) ? messages : [];
  const sliced = src.length > limit ? src.slice(-limit) : src;
  const out: any[] = [];

  for (const msg of sliced) {
    if (!msg || typeof msg !== 'object') continue;
    const role = (msg as any).role;
    if (role === 'system') {
      const content = typeof (msg as any).content === 'string' ? (msg as any).content : '';
      out.push({ role, text: content ? truncateText(content, 400) : '' });
      continue;
    }
    if (role === 'user') {
      const content = (msg as any).content;
      if (typeof content === 'string') {
        out.push({ role, text: truncateText(content, 800) });
        continue;
      }
      if (Array.isArray(content)) {
        const types = content.map((p: any) => p?.type).filter(Boolean);
        const textPart = content.find((p: any) => p?.type === 'text' && typeof p?.text === 'string');
        out.push({
          role,
          parts: types.slice(0, 12),
          text: textPart?.text ? truncateText(textPart.text, 800) : ''
        });
        continue;
      }
      out.push({ role, text: truncateText(content, 800) });
      continue;
    }
    if (role === 'assistant') {
      const content = (msg as any).content;
      const toolCalls = Array.isArray((msg as any).tool_calls) ? (msg as any).tool_calls : [];
      out.push({
        role,
        text: typeof content === 'string' ? truncateText(content, 800) : content == null ? '' : truncateText(content, 800),
        toolCalls: toolCalls.map((c: any) => String(c?.function?.name || '')).filter(Boolean).slice(0, 8)
      });
      continue;
    }
    if (role === 'tool') {
      out.push({
        role,
        name: String((msg as any).name || '').trim() || undefined,
        tool_call_id: String((msg as any).tool_call_id || '').trim() || undefined,
        text: truncateText((msg as any).content, 800)
      });
      continue;
    }
    out.push({ role: String(role || 'unknown') });
  }

  return out;
}

function buildSystemText(messages: any[]) {
  const lines: string[] = [];
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role !== 'system') continue;
    const content = (msg as any).content;
    if (typeof content === 'string' && content.trim()) lines.push(content.trim());
  }
  return lines.join('\n\n');
}

function sanitizeLocalMediaKeyFromUrlPathname(pathname: string) {
  const raw = String(pathname || '');
  if (raw.startsWith('/media/')) {
    const key = raw.slice('/media/'.length).replace(/^\/+/, '');
    return key || null;
  }
  if (raw.startsWith('/media-s/')) {
    const parts = raw.split('/').filter(Boolean);
    if (parts.length >= 4) {
      const key = parts.slice(3).join('/');
      return key || null;
    }
  }
  return null;
}

function resolveLocalMediaPath(mediaRoot: string, key: string): string | null {
  const normalized = String(key || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('..')) return null;
  const resolved = path.resolve(mediaRoot, normalized);
  const root = path.resolve(mediaRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

async function readLocalMediaMeta(filePath: string) {
  const metaPath = `${filePath}.meta.json`;
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    const parsed = JSON.parse(raw);
    const contentType = typeof parsed?.contentType === 'string' ? String(parsed.contentType).trim() : '';
    return { contentType: contentType || null };
  } catch {
    return { contentType: null as string | null };
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const text = String(dataUrl || '').trim();
  if (!text.startsWith('data:')) return null;
  const comma = text.indexOf(',');
  if (comma === -1) return null;
  const header = text.slice(5, comma);
  const data = text.slice(comma + 1);
  const isBase64 = /;base64/i.test(header);
  if (!isBase64) return null;
  const mimeType = header.replace(/;base64/i, '').trim() || 'application/octet-stream';
  const base64 = data.trim();
  if (!base64) return null;
  return { mimeType, base64 };
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

  const key = sanitizeLocalMediaKeyFromUrlPathname(url.pathname);
  if (!key) return null;

  const filePath = resolveLocalMediaPath(env.MEDIA_ROOT, key);
  if (!filePath) return null;

  const buf = await fs.readFile(filePath);
  const meta = await readLocalMediaMeta(filePath);
  return {
    mimeType: meta.contentType || 'application/octet-stream',
    base64: buf.toString('base64')
  };
}

async function openAiContentToAnthropicBlocks(env: Env, content: any): Promise<any[]> {
  if (typeof content === 'string') {
    const text = content;
    return text ? [{ type: 'text', text }] : [];
  }
  if (!Array.isArray(content)) {
    const text = content == null ? '' : String(content);
    return text ? [{ type: 'text', text }] : [];
  }

  const out: any[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      const text = typeof part.text === 'string' ? part.text : '';
      if (text) out.push({ type: 'text', text });
      continue;
    }
    if (part.type === 'image_url') {
      const url = typeof part.image_url?.url === 'string' ? part.image_url.url : '';
      const resolved = await resolveImageAsBase64(env, url);
      if (resolved) {
        out.push({
          type: 'image',
          source: { type: 'base64', media_type: resolved.mimeType, data: resolved.base64 }
        });
      } else if (url) {
        out.push({ type: 'text', text: `[图片] ${url}` });
      }
      continue;
    }
  }
  return out;
}

async function openAiContentToGeminiParts(env: Env, content: any): Promise<any[]> {
  if (typeof content === 'string') {
    const text = content;
    return text ? [{ text }] : [];
  }
  if (!Array.isArray(content)) {
    const text = content == null ? '' : String(content);
    return text ? [{ text }] : [];
  }

  const out: any[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      const text = typeof part.text === 'string' ? part.text : '';
      if (text) out.push({ text });
      continue;
    }
    if (part.type === 'image_url') {
      const url = typeof part.image_url?.url === 'string' ? part.image_url.url : '';
      const resolved = await resolveImageAsBase64(env, url);
      if (resolved) {
        out.push({ inlineData: { mimeType: resolved.mimeType, data: resolved.base64 } });
      } else if (url) {
        out.push({ text: `[图片] ${url}` });
      }
      continue;
    }
  }
  return out;
}

async function openAiMessagesToAnthropic(env: Env, messages: any[]) {
  const system = buildSystemText(messages);
  const out: any[] = [];

  let pendingToolResults: any[] = [];
  const flushToolResults = () => {
    if (!pendingToolResults.length) return;
    out.push({ role: 'user', content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role === 'system') continue;

    if (msg.role === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
      const toolUseId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : '';
      if (toolUseId) {
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: content || ''
        });
      }
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
        blocks.push({
          type: 'tool_use',
          id: String(call?.id || '').trim() || `tool_${Date.now()}`,
          name,
          input
        });
      }

      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] });
      continue;
    }
  }

  flushToolResults();
  return { system, messages: out };
}

async function openAiMessagesToGemini(env: Env, messages: any[]) {
  const system = buildSystemText(messages);
  const contents: any[] = [];
  let pendingToolResponses: any[] = [];

  const flushToolResponses = () => {
    if (!pendingToolResponses.length) return;
    contents.push({ role: 'user', parts: pendingToolResponses });
    pendingToolResponses = [];
  };

  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role === 'system') continue;

    if (msg.role === 'tool') {
      const name = typeof msg.name === 'string' ? msg.name.trim() : '';
      const content = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
      if (!name) continue;
      pendingToolResponses.push({
        functionResponse: { name, response: { result: content || '' } }
      });
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
      continue;
    }
  }

  flushToolResponses();

  const systemInstruction = system ? { parts: [{ text: system }] } : undefined;
  return { systemInstruction, contents };
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
  const decls: any[] = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const fn = tool?.function;
    const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
    if (!name) continue;
    decls.push({
      name,
      description: typeof fn?.description === 'string' ? fn.description : undefined,
      parameters: fn?.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object' }
    });
  }
  return decls;
}

function normalizeToolArguments(argumentsLike: unknown): string {
  if (typeof argumentsLike === 'string') {
    return argumentsLike;
  }
  if (argumentsLike == null) {
    return '{}';
  }
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
  if (!fn) return null;

  const name = typeof fn.name === 'string' ? fn.name.trim() : '';
  if (!name) return null;

  const id = typeof rawCall.id === 'string' && rawCall.id.trim()
    ? rawCall.id.trim()
    : fallbackId;

  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: normalizeToolArguments(fn.arguments)
    }
  };
}

function extractOpenAiAssistantMessage(data: any) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const content = typeof message?.content === 'string' ? message.content : message?.content ?? null;
  const rawToolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.toolCalls)
      ? message.toolCalls
      : [];

  const toolCalls: OpenAiToolCall[] = [];
  for (let i = 0; i < rawToolCalls.length; i++) {
    const normalized = normalizeOpenAiToolCall(rawToolCalls[i], `tool_${Date.now()}_${i}`);
    if (normalized) {
      toolCalls.push(normalized);
    }
  }

  if (!toolCalls.length) {
    const legacyFn = message?.function_call && typeof message.function_call === 'object'
      ? message.function_call
      : message?.functionCall && typeof message.functionCall === 'object'
        ? message.functionCall
        : null;
    if (legacyFn) {
      const normalized = normalizeOpenAiToolCall(
        { id: message?.id, type: 'function', function: legacyFn },
        `tool_${Date.now()}_legacy`
      );
      if (normalized) {
        toolCalls.push(normalized);
      }
    }
  }

  return { content, toolCalls };
}

function extractAnthropicAssistantMessage(data: any) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const texts: string[] = [];
  const toolCalls: OpenAiToolCall[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      texts.push(block.text);
      continue;
    }
    if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name.trim() : '';
      if (!name) continue;
      const id = typeof block.id === 'string' ? block.id.trim() : '';
      const argsObj = block.input && typeof block.input === 'object' ? block.input : {};
      toolCalls.push({
        id: id || `tool_${Date.now()}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(argsObj) }
      });
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
    if (typeof part.text === 'string' && part.text) {
      texts.push(part.text);
      continue;
    }
    const fc = part.functionCall;
    if (fc && typeof fc === 'object') {
      const name = typeof fc.name === 'string' ? fc.name.trim() : '';
      if (!name) continue;
      const argsObj = fc.args && typeof fc.args === 'object' ? fc.args : {};
      toolCalls.push({
        id: `gemini_${Date.now()}_${i}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(argsObj) }
      });
    }
  }

  const content = texts.join('\n').trim();
  return { content: content || null, toolCalls };
}

export async function callUpstreamChat(env: Env, params: {
  format: UpstreamApiFormat;
  apiUrl: string;
  apiKey: string;
  model: string;
  messages: any[];
  tools?: any[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  trace?: { scope?: string; userId?: string };
}) {
  const format = normalizeFormat(params.format);
  const apiUrl = String(params.apiUrl || '').trim();
  const apiKey = String(params.apiKey || '').trim();
  const model = String(params.model || '').trim();
  const timeoutMs = params.timeoutMs ?? 120000;

  if (!apiUrl || !apiKey || !model) {
    throw new ChatCompletionError(format, 500, 'missing_api_config');
  }

  const versionedApiUrl = withAutoApiVersion(apiUrl, format);
  const trace = params.trace || {};
  const startedAt = Date.now();
  const apiHost = safeHost(versionedApiUrl) || safeHost(apiUrl);

  pushAppLog('info', 'llm_request', {
    event: 'llm_request',
    scope: trace.scope,
    userId: trace.userId,
    format,
    model,
    apiHost,
    timeoutMs,
    messageCount: Array.isArray(params.messages) ? params.messages.length : 0,
    toolCount: Array.isArray(params.tools) ? params.tools.length : 0,
    messages: summarizeMessages(params.messages, 8)
  });

  try {
    if (format === 'openai') {
      const response = await callChatCompletions(
        env,
        {
          messages: params.messages,
          tools: params.tools,
          tool_choice: params.tools && Array.isArray(params.tools) && params.tools.length ? 'auto' : undefined,
          temperature: params.temperature,
          stream: false,
          max_tokens: params.maxTokens
        },
        {
          timeoutMs,
          model,
          apiUrl: versionedApiUrl,
          apiKey
        }
      );
      const data = await response.json();
      const extracted = extractOpenAiAssistantMessage(data);
      pushAppLog('info', 'llm_response', {
        event: 'llm_response',
        scope: trace.scope,
        userId: trace.userId,
        format,
        model,
        apiHost,
        durationMs: Date.now() - startedAt,
        usage: (data as any)?.usage,
        content: extracted.content ? truncateText(extracted.content, 1200) : null,
        toolCalls: extracted.toolCalls?.map((c: any) => ({
          id: c.id,
          name: c.function?.name,
          arguments: c.function?.arguments ? truncateText(c.function.arguments, 1200) : ''
        }))
      });
      return {
        message: {
          content: extracted.content,
          tool_calls: extracted.toolCalls
        },
        raw: data
      };
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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(joinUrl(versionedApiUrl, 'messages'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new ChatCompletionError('anthropic', res.status, text);
        }
        const data = await res.json();
        const extracted = extractAnthropicAssistantMessage(data);
        pushAppLog('info', 'llm_response', {
          event: 'llm_response',
          scope: trace.scope,
          userId: trace.userId,
          format,
          model,
          apiHost,
          durationMs: Date.now() - startedAt,
          content: extracted.content ? truncateText(extracted.content, 1200) : null,
          toolCalls: extracted.toolCalls?.map((c: any) => ({
            id: c.id,
            name: c.function?.name,
            arguments: c.function?.arguments ? truncateText(c.function.arguments, 1200) : ''
          }))
        });
        return {
          message: {
            content: extracted.content,
            tool_calls: extracted.toolCalls
          },
          raw: data
        };
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          throw new ChatCompletionError('anthropic', 504, `Request timeout after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
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
      }
    };
    if (decls.length) {
      body.tools = [{ functionDeclarations: decls }];
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          'authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ChatCompletionError('gemini', res.status, text);
      }
      const data = await res.json();
      const extracted = extractGeminiAssistantMessage(data);
      pushAppLog('info', 'llm_response', {
        event: 'llm_response',
        scope: trace.scope,
        userId: trace.userId,
        format,
        model,
        apiHost,
        durationMs: Date.now() - startedAt,
        content: extracted.content ? truncateText(extracted.content, 1200) : null,
        toolCalls: extracted.toolCalls?.map((c: any) => ({
          id: c.id,
          name: c.function?.name,
          arguments: c.function?.arguments ? truncateText(c.function.arguments, 1200) : ''
        }))
      });
      return {
        message: {
          content: extracted.content,
          tool_calls: extracted.toolCalls
        },
        raw: data
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new ChatCompletionError('gemini', 504, `Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: any) {
    pushAppLog('error', 'llm_error', {
      event: 'llm_error',
      scope: trace.scope,
      userId: trace.userId,
      format,
      model,
      apiHost,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
