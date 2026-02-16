import type { Env } from '../types';
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
  const isBase64 = /;base64/i.test(header);
  if (!isBase64) return null;
  const mimeType = header.replace(/;base64/i, '').trim() || 'application/octet-stream';
  const base64 = data.trim();
  if (!base64) return null;
  return { mimeType, base64 };
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

async function resolveImageAsBase64(urlLike: string) {
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

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim();
    return {
      mimeType: contentType || 'application/octet-stream',
      base64: toBase64(arrayBuffer)
    };
  } catch {
    return null;
  }
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

async function openAiContentToAnthropicBlocks(content: any): Promise<any[]> {
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
      const resolved = await resolveImageAsBase64(url);
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

async function openAiContentToGeminiParts(content: any): Promise<any[]> {
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
      const resolved = await resolveImageAsBase64(url);
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

async function openAiMessagesToAnthropic(messages: any[]) {
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
      const blocks = await openAiContentToAnthropicBlocks(msg.content);
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

async function openAiMessagesToGemini(messages: any[]) {
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
      const parts = await openAiContentToGeminiParts(msg.content);
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

function extractOpenAiAssistantMessage(data: any) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const content = typeof message?.content === 'string' ? message.content : message?.content ?? null;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
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
    return {
      message: {
        content: extracted.content,
        tool_calls: extracted.toolCalls
      },
      raw: data
    };
  }

  if (format === 'anthropic') {
    const { system, messages } = await openAiMessagesToAnthropic(params.messages);
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

  const { systemInstruction, contents } = await openAiMessagesToGemini(params.messages);
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
}
