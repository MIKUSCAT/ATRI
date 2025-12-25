import { Env } from '../types';

export class GeminiApiError extends Error {
  status: number;
  details: string;

  constructor(status: number, details: string) {
    super(`Gemini API error: ${status}`);
    this.status = status;
    this.details = details;
  }
}

// Gemini 原生 API 类型定义
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: string;
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  responseMimeType?: string;
}

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
  tools?: GeminiTool[];
  toolConfig?: {
    functionCallingConfig?: {
      mode?: 'AUTO' | 'ANY' | 'NONE';
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: GeminiGenerationConfig;
}

export interface GeminiCandidate {
  content: {
    parts: Array<{
      text?: string;
      functionCall?: {
        name: string;
        args: Record<string, unknown>;
      };
    }>;
    role: string;
  };
  finishReason?: string;
  safetyRatings?: Array<{
    category: string;
    probability: string;
  }>;
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * 判断模型是否应该使用 Gemini 原生 API
 */
export function isGeminiNativeModel(model: string): boolean {
  const lowerModel = model.toLowerCase();
  // 以 gemini- 开头且不包含 openai 兼容标记的模型使用原生 API
  return lowerModel.startsWith('gemini-') && !lowerModel.includes('openai');
}

/**
 * 调用 Gemini 原生 generateContent API
 */
export async function callGeminiGenerateContent(
  env: Env,
  payload: GeminiRequest,
  options?: {
    timeoutMs?: number;
    model?: string;
    apiUrl?: string;
    apiKey?: string;
    stream?: boolean;
  }
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? 60000;
  const model = options?.model ?? 'gemini-2.5-flash';
  const apiUrl = (options?.apiUrl || env.GEMINI_API_URL || '').trim();
  const apiKey = (options?.apiKey || env.GEMINI_API_KEY || '').trim();
  const stream = options?.stream ?? false;

  if (!apiUrl || !apiKey) {
    throw new GeminiApiError(500, 'missing_gemini_api_config');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 构建完整的 API URL
  const action = stream ? 'streamGenerateContent' : 'generateContent';
  const endpoint = stream
    ? `${apiUrl}/v1beta/models/${model}:${action}?alt=sse`
    : `${apiUrl}/v1beta/models/${model}:${action}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new GeminiApiError(response.status, errorText);
    }

    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new GeminiApiError(504, `Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 将 OpenAI 格式的消息转换为 Gemini 格式
 */
export function convertOpenAIMessagesToGemini(
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
    name?: string;
  }>
): { contents: GeminiContent[]; systemInstruction?: { parts: { text: string }[] } } {
  let systemInstruction: { parts: { text: string }[] } | undefined;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    // 处理 system 消息 -> systemInstruction
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
      systemInstruction = { parts: [{ text }] };
      continue;
    }

    // 处理 tool 消息 -> 作为 user 角色的 function response
    if (msg.role === 'tool') {
      // Gemini 使用 functionResponse 格式
      contents.push({
        role: 'user',
        parts: [{
          text: `[Function Response: ${msg.name}]\n${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`
        }]
      });
      continue;
    }

    // 转换角色
    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';

    // 转换内容
    const parts: GeminiPart[] = [];

    if (typeof msg.content === 'string') {
      if (msg.content.trim()) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) {
          parts.push({ text: part.text });
        } else if (part.type === 'image_url' && part.image_url?.url) {
          const url = part.image_url.url;
          // 处理 base64 图片
          if (url.startsWith('data:')) {
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2]
                }
              });
            }
          } else {
            // 对于 URL 图片，Gemini 需要使用 fileData 或先上传
            // 这里简化处理，添加文本描述
            parts.push({ text: `[Image: ${url}]` });
          }
        }
      }
    }

    // 处理 assistant 的 tool_calls
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      for (const toolCall of msg.tool_calls) {
        parts.push({
          text: `[Function Call: ${toolCall.function.name}(${toolCall.function.arguments})]`
        });
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return { contents, systemInstruction };
}

/**
 * 将 OpenAI 格式的 tools 转换为 Gemini 格式
 */
export function convertOpenAIToolsToGemini(
  tools: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters?: {
        type: string;
        properties: Record<string, unknown>;
        required?: string[];
      };
    };
  }>
): GeminiTool[] {
  const functionDeclarations: GeminiFunctionDeclaration[] = tools
    .filter(tool => tool.type === 'function')
    .map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters as GeminiFunctionDeclaration['parameters']
    }));

  if (functionDeclarations.length === 0) {
    return [];
  }

  return [{ functionDeclarations }];
}

/**
 * 将 Gemini 响应转换为 OpenAI 兼容格式
 */
export function convertGeminiResponseToOpenAI(
  geminiResponse: GeminiResponse,
  model: string
): {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
} {
  const choices = geminiResponse.candidates.map((candidate, index) => {
    let content: string | null = null;
    const toolCalls: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }> = [];

    for (const part of candidate.content.parts) {
      if (part.text) {
        content = (content || '') + part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${index}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args)
          }
        });
      }
    }

    const message: {
      role: string;
      content: string | null;
      tool_calls?: typeof toolCalls;
    } = {
      role: 'assistant',
      content
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      index,
      message,
      finish_reason: mapFinishReason(candidate.finishReason)
    };
  });

  const result: ReturnType<typeof convertGeminiResponseToOpenAI> = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices
  };

  if (geminiResponse.usageMetadata) {
    result.usage = {
      prompt_tokens: geminiResponse.usageMetadata.promptTokenCount,
      completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount,
      total_tokens: geminiResponse.usageMetadata.totalTokenCount
    };
  }

  return result;
}

function mapFinishReason(geminiReason?: string): string {
  switch (geminiReason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
      return 'content_filter';
    case 'RECITATION':
      return 'content_filter';
    default:
      return 'stop';
  }
}

/**
 * 统一的聊天完成调用接口 - 自动选择 OpenAI 或 Gemini 原生 API
 */
export async function callChatCompletionsUnified(
  env: Env,
  payload: {
    messages: Array<{
      role: string;
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
      tool_call_id?: string;
      name?: string;
    }>;
    tools?: Array<{
      type: string;
      function: {
        name: string;
        description: string;
        parameters?: {
          type: string;
          properties: Record<string, unknown>;
          required?: string[];
        };
      };
    }>;
    tool_choice?: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    [key: string]: unknown;
  },
  options?: {
    timeoutMs?: number;
    model?: string;
    apiUrl?: string;
    apiKey?: string;
  }
): Promise<Response> {
  const model = options?.model ?? 'gemini-2.5-flash';

  // 判断是否使用 Gemini 原生 API（需要配置了 GEMINI_API_KEY）
  const geminiApiKey = (options?.apiKey || env.GEMINI_API_KEY || '').trim();
  const geminiApiUrl = (options?.apiUrl || env.GEMINI_API_URL || '').trim();
  
  if (isGeminiNativeModel(model) && geminiApiKey && geminiApiUrl) {
    return callGeminiNative(env, payload, { ...options, model, apiKey: geminiApiKey, apiUrl: geminiApiUrl });
  }

  // 否则使用 OpenAI 兼容 API (原有逻辑或回退)
  const { callChatCompletions } = await import('./openai-service');
  return callChatCompletions(env, { model, ...payload }, options);
}

async function callGeminiNative(
  env: Env,
  payload: Parameters<typeof callChatCompletionsUnified>[1],
  options: NonNullable<Parameters<typeof callChatCompletionsUnified>[2]>
): Promise<Response> {
  const { contents, systemInstruction } = convertOpenAIMessagesToGemini(payload.messages);
  const stream = payload.stream ?? false;

  const geminiRequest: GeminiRequest = {
    contents,
    generationConfig: {
      temperature: payload.temperature ?? 1.0,
      maxOutputTokens: payload.max_tokens ?? 4096
    }
  };

  if (systemInstruction) {
    geminiRequest.systemInstruction = systemInstruction;
  }

  if (payload.tools && payload.tools.length > 0) {
    geminiRequest.tools = convertOpenAIToolsToGemini(payload.tools);
    geminiRequest.toolConfig = {
      functionCallingConfig: {
        mode: payload.tool_choice === 'none' ? 'NONE' : 'AUTO'
      }
    };
  }

  const response = await callGeminiGenerateContent(env, geminiRequest, { ...options, stream });

  if (stream) {
    return convertGeminiStreamToOpenAI(response, options.model!);
  }

  const geminiResponse: GeminiResponse = await response.json();
  const openAIResponse = convertGeminiResponseToOpenAI(geminiResponse, options.model!);

  return new Response(JSON.stringify(openAIResponse), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 将 Gemini 流式响应转换为 OpenAI 兼容的 SSE 格式
 */
function convertGeminiStreamToOpenAI(response: Response, model: string): Response {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new GeminiApiError(500, 'No response body');
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const chatId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            try {
              const geminiChunk: GeminiResponse = JSON.parse(jsonStr);
              const text = geminiChunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
              const finishReason = geminiChunk.candidates?.[0]?.finishReason;

              const openAIChunk = {
                id: chatId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                  index: 0,
                  delta: text ? { content: text } : {},
                  finish_reason: finishReason ? mapFinishReason(finishReason) : null
                }]
              };

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
            } catch {
              // 忽略解析错误
            }
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
