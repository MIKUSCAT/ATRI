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

// Gemini Part 基础类型
export interface GeminiTextPart {
  text: string;
  thoughtSignature?: string;
}

export interface GeminiInlineDataPart {
  inlineData: { mimeType: string; data: string };
  thoughtSignature?: string;
}

export interface GeminiFileDataPart {
  fileData: { mimeType: string; fileUri: string };
  thoughtSignature?: string;
}

export interface GeminiFunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
  // Gemini API 使用 thought_signature (下划线格式)
  thought_signature?: string;
}

export interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
  };
}

export type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFileDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

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

export interface GeminiCandidatePart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  // Gemini API 可能使用 thought_signature (下划线) 或 thoughtSignature (驼峰)
  thought_signature?: string;
  thoughtSignature?: string;
}

export interface GeminiCandidate {
  content: {
    parts: GeminiCandidatePart[];
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
  }
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? 60000;
  const model = options?.model ?? 'gemini-2.5-flash';
  const apiUrl = (options?.apiUrl || env.GEMINI_API_URL || '').trim();
  const apiKey = (options?.apiKey || env.GEMINI_API_KEY || '').trim();

  if (!apiUrl || !apiKey) {
    throw new GeminiApiError(500, 'missing_gemini_api_config');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 构建完整的 API URL
  const endpoint = `${apiUrl}/v1beta/models/${model}:generateContent`;

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
 * OpenAI 格式消息的扩展类型，支持 thoughtSignature
 */
export interface OpenAIMessageWithSignature {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
    // Gemini 3 思路签名 - 存储在 extra_content.google.thought_signature 中
    extra_content?: {
      google?: {
        thought_signature?: string;
      };
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

/**
 * 将 OpenAI 格式的消息转换为 Gemini 格式
 * 支持 Gemini 3 的 thoughtSignature 传递
 */
export function convertOpenAIMessagesToGemini(
  messages: OpenAIMessageWithSignature[]
): { contents: GeminiContent[]; systemInstruction?: { parts: { text: string }[] } } {
  let systemInstruction: { parts: { text: string }[] } | undefined;
  const contents: GeminiContent[] = [];
  
  // 用于收集连续的 functionResponse
  let pendingFunctionResponses: GeminiFunctionResponsePart[] = [];

  const flushFunctionResponses = () => {
    if (pendingFunctionResponses.length > 0) {
      contents.push({
        role: 'user',
        parts: pendingFunctionResponses
      });
      pendingFunctionResponses = [];
    }
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // 处理 system 消息 -> systemInstruction
    if (msg.role === 'system') {
      flushFunctionResponses();
      const text = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n')
          : '';
      systemInstruction = { parts: [{ text }] };
      continue;
    }

    // 处理 tool 消息 -> 收集为 functionResponse
    // 多个连续的 tool 消息应该合并到同一个 user 消息的 parts 中
    if (msg.role === 'tool') {
      // 解析 tool response 内容
      let responseData: Record<string, unknown>;
      try {
        if (typeof msg.content === 'string') {
          responseData = JSON.parse(msg.content);
        } else if (msg.content === null) {
          responseData = {};
        } else {
          // content 是数组类型时，转换为对象
          responseData = { parts: msg.content };
        }
      } catch {
        responseData = { result: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) };
      }
      
      pendingFunctionResponses.push({
        functionResponse: {
          name: msg.name || 'unknown',
          response: responseData
        }
      });
      
      // 检查下一条消息是否还是 tool，如果不是则 flush
      const nextMsg = messages[i + 1];
      if (!nextMsg || nextMsg.role !== 'tool') {
        flushFunctionResponses();
      }
      continue;
    }
    
    // 非 tool 消息前先 flush 任何待处理的 functionResponse
    flushFunctionResponses();

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

    // 处理 assistant 的 tool_calls - 转换为 Gemini 的 functionCall 格式
    // 重要：必须保留 thoughtSignature！
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      let isFirstFunctionCall = true;
      for (const toolCall of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }
        
        const functionCallPart: GeminiFunctionCallPart = {
          functionCall: {
            name: toolCall.function.name,
            args
          }
        };
        
        // 只有第一个 functionCall 需要携带 thought_signature（并行函数调用的情况）
        // 或者每个顺序调用都有自己的签名
        // 注意：Gemini API 使用下划线格式 thought_signature
        const signature = toolCall.extra_content?.google?.thought_signature;
        if (signature && isFirstFunctionCall) {
          functionCallPart.thought_signature = signature;
          isFirstFunctionCall = false;
        } else if (signature) {
          // 顺序调用时每个都可能有签名
          functionCallPart.thought_signature = signature;
        }
        
        parts.push(functionCallPart);
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }
  
  // 最终 flush，以防最后的消息是 tool 消息
  flushFunctionResponses();

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
 * OpenAI 兼容格式的 tool_call，支持 thoughtSignature
 */
export interface OpenAIToolCallWithSignature {
  id: string;
  type: string;
  function: { name: string; arguments: string };
  extra_content?: {
    google?: {
      thought_signature?: string;
    };
  };
}

/**
 * 将 Gemini 响应转换为 OpenAI 兼容格式
 * 重要：保留 thoughtSignature 以便后续请求传回
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
      tool_calls?: OpenAIToolCallWithSignature[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
} {
  // 安全检查：确保 candidates 存在
  const candidates = geminiResponse?.candidates || [];
  
  if (candidates.length === 0) {
    // 没有候选结果时返回空响应
    console.warn('[Gemini] No candidates in response:', JSON.stringify(geminiResponse));
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null
        },
        finish_reason: 'stop'
      }]
    };
  }
  
  const choices = candidates.map((candidate, index) => {
    let content: string | null = null;
    const toolCalls: OpenAIToolCallWithSignature[] = [];

    // 安全检查：确保 content 和 parts 存在
    const parts = candidate?.content?.parts || [];
    
    for (const part of parts) {
      if (part.text) {
        content = (content || '') + part.text;
      }
      if (part.functionCall) {
        const toolCall: OpenAIToolCallWithSignature = {
          id: `call_${Date.now()}_${index}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {})
          }
        };
        
        // 重要：保留 thought_signature！
        // Gemini 3 模型在函数调用时会返回 thought_signature (下划线格式)
        // 必须在后续请求中原样传回，否则会收到 400 错误
        // 同时检查两种可能的命名格式
        const signature = part.thought_signature || part.thoughtSignature;
        if (signature) {
          toolCall.extra_content = {
            google: {
              thought_signature: signature
            }
          };
        }
        
        toolCalls.push(toolCall);
      }
    }

    const message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCallWithSignature[];
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
 * 支持 Gemini 3 的 thoughtSignature 传递
 */
export async function callChatCompletionsUnified(
  env: Env,
  payload: {
    messages: OpenAIMessageWithSignature[];
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

  // 调试日志：打印发送给 Gemini 的请求
  console.log('[Gemini] Request contents:', JSON.stringify(geminiRequest.contents, null, 2));

  const response = await callGeminiGenerateContent(env, geminiRequest, options);
  
  // 解析响应并添加错误处理
  let geminiResponse: GeminiResponse;
  try {
    const responseText = await response.text();
    geminiResponse = JSON.parse(responseText);
    
    // 调试日志：检查响应结构
    if (!geminiResponse?.candidates?.length) {
      console.warn('[Gemini] Empty or invalid response:', responseText.slice(0, 500));
    }
  } catch (parseError) {
    console.error('[Gemini] Failed to parse response:', parseError);
    throw new GeminiApiError(500, 'Failed to parse Gemini response');
  }

  // 转换为 OpenAI 兼容格式返回
  const openAIResponse = convertGeminiResponseToOpenAI(geminiResponse, options.model!);

  return new Response(JSON.stringify(openAIResponse), {
    headers: { 'Content-Type': 'application/json' }
  });
}
