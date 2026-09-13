import { estimateRequestTokens } from './budget.js';
export { estimateTextTokens, estimateRequestTokens, trimToTokens } from './budget.js';

export type ApiFormat = 'openai' | 'anthropic' | 'gemini';
export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  format: ApiFormat;
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
  vision: boolean;
  contextWindowTokens?: number;
  inputBudgetTokens?: number;
}
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  calls?: ToolCall[];
  callId?: string;
  name?: string;
  raw?: unknown;
}
export interface Completion {
  text: string;
  calls: ToolCall[];
  continuation: ModelMessage;
  inputTokens: number;
  outputTokens: number;
}
export interface Model {
  complete(
    messages: ModelMessage[],
    tools?: ToolDefinition[],
    options?: { signal?: AbortSignal; sessionId?: string; maxTokens?: number },
  ): Promise<Completion>;
}
export class ModelError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}
type Json = Record<string, any>;
function argumentsOf(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value))
    return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}
function imageParts(message: ModelMessage, format: ApiFormat): unknown[] {
  const parts: unknown[] = [
    { text: message.content, ...(format === 'anthropic' ? { type: 'text' } : {}) },
  ];
  for (const image of message.images ?? []) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(image);
    if (!match) continue;
    parts.push(
      format === 'anthropic'
        ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
        : { inlineData: { mimeType: match[1], data: match[2] } },
    );
  }
  return parts;
}
export class HttpModel implements Model {
  constructor(
    readonly config: ModelConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async complete(
    messages: ModelMessage[],
    tools: ToolDefinition[] = [],
    options: { signal?: AbortSignal; sessionId?: string; maxTokens?: number } = {},
  ): Promise<Completion> {
    const c = this.config;
    if (!c.apiKey || !c.model) throw new ModelError('请先配置模型名称和 API 密钥');
    const base = c.baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.sessionId) headers['x-zg-session-id'] = options.sessionId;
    let url: string, body: Json;
    const maxTokens = Math.min(options.maxTokens ?? c.maxTokens, c.maxTokens);
    const inputLimit = Math.min(
      c.inputBudgetTokens ?? Infinity,
      (c.contextWindowTokens ?? Infinity) - maxTokens - 1024,
    );
    const estimatedInput = estimateRequestTokens(messages, tools);
    if (estimatedInput > inputLimit)
      throw new ModelError(
        `本次输入估算 ${estimatedInput} token，超过 ${inputLimit} 的预算，请在调试页调整上下文或缩短消息。`,
      );
    if (c.format === 'anthropic') {
      url = `${/\/v\d+$/.test(base) ? base : base + '/v1'}/messages`;
      headers['x-api-key'] = c.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      const converted: Json[] = [];
      for (const m of messages.filter((m) => m.role !== 'system')) {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        const content =
          m.role === 'tool'
            ? [{ type: 'tool_result', tool_use_id: m.callId, content: m.content }]
            : m.role === 'assistant' && m.raw
              ? m.raw
              : imageParts(m, 'anthropic');
        const last = converted.at(-1);
        if (last?.role === role) last.content.push(...(content as unknown[]));
        else converted.push({ role, content });
      }
      body = {
        model: c.model,
        max_tokens: maxTokens,
        system: messages
          .filter((m) => m.role === 'system')
          .map((m) => m.content)
          .join('\n\n'),
        messages: converted,
      };
      if (tools.length)
        body.tools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
    } else if (c.format === 'gemini') {
      url = `${/\/v\d+(beta)?$/.test(base) ? base : base + '/v1beta'}/models/${encodeURIComponent(c.model)}:generateContent`;
      headers['x-goog-api-key'] = c.apiKey;
      body = {
        systemInstruction: {
          parts: [
            {
              text: messages
                .filter((m) => m.role === 'system')
                .map((m) => m.content)
                .join('\n\n'),
            },
          ],
        },
        contents: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts:
              m.role === 'tool'
                ? [
                    {
                      functionResponse: {
                        name: m.name,
                        response: { result: argumentsOf(m.content) },
                      },
                    },
                  ]
                : (m.raw ?? imageParts(m, 'gemini')),
          })),
        generationConfig: { maxOutputTokens: maxTokens },
      };
      if (tools.length)
        body.tools = [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.parameters,
            })),
          },
        ];
      if (c.temperature !== undefined) body.generationConfig.temperature = c.temperature;
    } else {
      url = `${/\/v\d+$/.test(base) || /\/chat\/completions$/.test(base) ? base : base + '/v1'}`;
      if (!url.endsWith('/chat/completions')) url += '/chat/completions';
      headers.authorization = `Bearer ${c.apiKey}`;
      body = {
        model: c.model,
        messages: messages.map((m) => {
          if (m.role === 'assistant' && m.raw) return m.raw;
          if (m.role === 'tool')
            return { role: 'tool', tool_call_id: m.callId, content: m.content };
          const content = m.images?.length
            ? [
                { type: 'text', text: m.content },
                ...m.images.map((url) => ({
                  type: 'image_url',
                  image_url: { url, detail: 'auto' },
                })),
              ]
            : m.content;
          return { role: m.role, content };
        }),
      };
      body[/^(gpt-5|o[134])/.test(c.model) ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
      if (tools.length)
        body.tools = tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
    }
    if (c.format !== 'gemini' && c.temperature !== undefined) body.temperature = c.temperature;
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(c.timeoutMs)])
      : AbortSignal.timeout(c.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new ModelError('模型请求超时或已取消');
      throw new ModelError(`模型连接失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
    let data: Json;
    try {
      data = (await response.json()) as Json;
    } catch {
      throw new ModelError(`模型返回了无效响应（HTTP ${response.status}）`, response.status);
    }
    if (!response.ok)
      throw new ModelError(
        `模型请求失败（HTTP ${response.status}）：${String(
          data.error?.message ?? data.error ?? '上游错误',
        )
          .replaceAll(c.apiKey, '[已隐藏]')
          .slice(0, 200)}`,
        response.status,
      );
    let text = '',
      calls: ToolCall[] = [],
      raw: unknown,
      inputTokens = 0,
      outputTokens = 0;
    if (c.format === 'anthropic') {
      const content: Json[] = data.content ?? [];
      raw = content;
      text = content
        .filter((p) => p.type === 'text')
        .map((p) => String(p.text ?? ''))
        .join('');
      calls = content
        .filter((p) => p.type === 'tool_use')
        .map((p) => ({ id: String(p.id), name: String(p.name), arguments: argumentsOf(p.input) }));
      inputTokens = Number(data.usage?.input_tokens ?? 0);
      outputTokens = Number(data.usage?.output_tokens ?? 0);
    } else if (c.format === 'gemini') {
      const parts: Json[] = data.candidates?.[0]?.content?.parts ?? [];
      raw = parts;
      text = parts
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join('');
      calls = parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({
          id: String(p.functionCall.id ?? `gemini-${i}`),
          name: String(p.functionCall.name),
          arguments: argumentsOf(p.functionCall.args),
        }));
      inputTokens = Number(data.usageMetadata?.promptTokenCount ?? 0);
      outputTokens = Number(data.usageMetadata?.candidatesTokenCount ?? 0);
    } else {
      const message: Json = data.choices?.[0]?.message ?? {};
      raw = message;
      text =
        typeof message.content === 'string'
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .filter((p: Json) => p.type === 'text')
                .map((p: Json) => p.text ?? '')
                .join('')
            : '';
      calls = (message.tool_calls ?? []).map((t: Json) => ({
        id: String(t.id),
        name: String(t.function?.name),
        arguments: argumentsOf(t.function?.arguments),
      }));
      inputTokens = Number(data.usage?.prompt_tokens ?? 0);
      outputTokens = Number(data.usage?.completion_tokens ?? 0);
    }
    if (!text.trim() && !calls.length) throw new ModelError('模型没有返回可用内容');
    return {
      text,
      calls,
      continuation: { role: 'assistant', content: text, calls, raw },
      inputTokens,
      outputTokens,
    };
  }
}
