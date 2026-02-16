import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import { sanitizeText } from '../utils/sanitize';
import { runAgentChat } from '../services/agent-service';
import { saveConversationLog } from '../services/data-service';
import { DEFAULT_TIMEZONE, formatDateInZone } from '../utils/date';
import { getEffectiveRuntimeSettings } from '../services/runtime-settings';

type CompatGuard =
  | { ok: true; key: string }
  | { ok: false; status: number; body: any };

function pickHeader(request: Request, name: string) {
  return String(request.headers.get(name) || '').trim();
}

function extractBearerToken(request: Request) {
  const auth = pickHeader(request, 'authorization');
  if (!auth) return '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildStableAnonUserId(apiKey: string) {
  const key = String(apiKey || '').trim();
  if (!key) return 'anon';
  const hash = (await sha256Hex(key)).slice(0, 16);
  return `anon:${hash}`;
}

function getCompatExpectedKey(env: Env) {
  return String(env.COMPAT_API_KEY || env.APP_TOKEN || '').trim();
}

function requireCompatKey(rawProvidedKey: string, env: Env): CompatGuard {
  const expected = getCompatExpectedKey(env);
  if (!expected) {
    return { ok: false, status: 503, body: { error: { message: 'compat api key is not configured' } } };
  }
  const provided = String(rawProvidedKey || '').trim();
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, body: { error: { message: 'Unauthorized' } } };
  }
  return { ok: true, key: provided };
}

function extractTextFromOpenAiContent(content: any) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractLastUserTextFromOpenAiMessages(messages: any[]) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object' || msg.role !== 'user') continue;
    return extractTextFromOpenAiContent((msg as any).content);
  }
  return '';
}

function extractTextFromAnthropicContent(content: any) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractLastUserTextFromAnthropicMessages(messages: any[]) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object' || msg.role !== 'user') continue;
    return extractTextFromAnthropicContent((msg as any).content);
  }
  return '';
}

function extractLastUserTextFromGeminiContents(contents: any[]) {
  if (!Array.isArray(contents)) return '';
  for (let i = contents.length - 1; i >= 0; i--) {
    const item = contents[i];
    if (!item || typeof item !== 'object' || item.role !== 'user') continue;
    const parts = Array.isArray((item as any).parts) ? (item as any).parts : [];
    const text = parts
      .map((p: any) => (p && typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return '';
}

async function logCompatConversation(env: Env, params: {
  userId: string;
  userText: string;
  replyText: string;
}) {
  const ts = Date.now();
  const date = formatDateInZone(ts, DEFAULT_TIMEZONE);
  const userLogId = crypto.randomUUID();
  const replyLogId = crypto.randomUUID();

  await saveConversationLog(env, {
    id: userLogId,
    userId: params.userId,
    role: 'user',
    content: params.userText,
    attachments: [],
    timestamp: ts,
    timeZone: DEFAULT_TIMEZONE,
    date
  });

  await saveConversationLog(env, {
    id: replyLogId,
    userId: params.userId,
    role: 'atri',
    content: params.replyText,
    attachments: [],
    replyTo: userLogId,
    timestamp: ts + 1,
    timeZone: DEFAULT_TIMEZONE,
    date
  });

  return { userLogId, replyLogId, replyTo: userLogId, replyTimestamp: ts + 1 };
}

export function registerCompatRoutes(router: Router) {
  router.post('/v1/chat/completions', async (request, env: Env) => {
    const guard = requireCompatKey(extractBearerToken(request), env);
    if (!guard.ok) return jsonResponse(guard.body, guard.status);

    const body = await request.json().catch(() => ({} as any));
    if (body?.stream === true) {
      return jsonResponse({ error: { message: 'stream=true is not supported on this backend' } }, 400);
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const messageText = sanitizeText(extractLastUserTextFromOpenAiMessages(messages)).trim();
    if (!messageText) {
      return jsonResponse({ error: { message: 'No user message found' } }, 400);
    }

    const userId =
      String(pickHeader(request, 'x-user-id') || '').trim()
      || (typeof body?.user === 'string' ? body.user.trim() : '')
      || (await buildStableAnonUserId(guard.key));

    const settings = await getEffectiveRuntimeSettings(env);
    const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : settings.defaultChatModel;
    const result = await runAgentChat(env, {
      userId,
      platform: 'openai',
      messageText,
      attachments: [],
      model,
      clientTimeIso: new Date().toISOString()
    });

    const meta = await logCompatConversation(env, {
      userId,
      userText: messageText,
      replyText: result.reply
    });

    const created = Math.floor(Date.now() / 1000);
    return jsonResponse({
      id: `chatcmpl_${meta.replyLogId.replace(/-/g, '')}`,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: result.reply },
          finish_reason: 'stop'
        }
      ]
    });
  });

  router.post('/v1/messages', async (request, env: Env) => {
    const provided = pickHeader(request, 'x-api-key') || extractBearerToken(request);
    const guard = requireCompatKey(provided, env);
    if (!guard.ok) return jsonResponse(guard.body, guard.status);

    const body = await request.json().catch(() => ({} as any));
    if (body?.stream === true) {
      return jsonResponse({ error: { message: 'stream=true is not supported on this backend' } }, 400);
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const messageText = sanitizeText(extractLastUserTextFromAnthropicMessages(messages)).trim();
    if (!messageText) {
      return jsonResponse({ error: { message: 'No user message found' } }, 400);
    }

    const userId =
      String(pickHeader(request, 'x-user-id') || '').trim()
      || (typeof body?.metadata?.user_id === 'string' ? body.metadata.user_id.trim() : '')
      || (await buildStableAnonUserId(guard.key));

    const settings = await getEffectiveRuntimeSettings(env);
    const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : settings.defaultChatModel;
    const result = await runAgentChat(env, {
      userId,
      platform: 'anthropic',
      messageText,
      attachments: [],
      model,
      clientTimeIso: new Date().toISOString()
    });

    const meta = await logCompatConversation(env, {
      userId,
      userText: messageText,
      replyText: result.reply
    });

    return jsonResponse({
      id: `msg_${meta.replyLogId.replace(/-/g, '')}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: result.reply }],
      stop_reason: 'end_turn',
      stop_sequence: null
    });
  });

  router.post('/v1beta/models/:path+', async (request: any, env: Env) => {
    const path = String(request.params?.path || '');
    const generateSuffix = ':generateContent';
    const streamSuffix = ':streamGenerateContent';

    if (path.endsWith(streamSuffix)) {
      return jsonResponse({ error: { message: 'streamGenerateContent is not supported on this backend' } }, 400);
    }
    if (!path.endsWith(generateSuffix)) {
      return new Response('Not Found', { status: 404 });
    }

    const modelFromPath = path.slice(0, -generateSuffix.length);
    const url = new URL(request.url);
    const keyFromQuery = String(url.searchParams.get('key') || '').trim();
    const keyFromHeader = pickHeader(request, 'x-goog-api-key');
    const guard = requireCompatKey(keyFromQuery || keyFromHeader, env);
    if (!guard.ok) return jsonResponse(guard.body, guard.status);

    const body = await request.json().catch(() => ({} as any));
    const contents = Array.isArray(body?.contents) ? body.contents : [];
    const messageText = sanitizeText(extractLastUserTextFromGeminiContents(contents)).trim();
    if (!messageText) {
      return jsonResponse({ error: { message: 'No user content found' } }, 400);
    }

    const userId =
      String(pickHeader(request, 'x-user-id') || '').trim()
      || (await buildStableAnonUserId(guard.key));

    const settings = await getEffectiveRuntimeSettings(env);
    const model = modelFromPath && modelFromPath.trim() ? modelFromPath.trim() : settings.defaultChatModel;
    const result = await runAgentChat(env, {
      userId,
      platform: 'gemini',
      messageText,
      attachments: [],
      model,
      clientTimeIso: new Date().toISOString()
    });

    await logCompatConversation(env, {
      userId,
      userText: messageText,
      replyText: result.reply
    });

    return jsonResponse({
      candidates: [
        {
          index: 0,
          content: {
            role: 'model',
            parts: [{ text: result.reply }]
          },
          finishReason: 'STOP'
        }
      ]
    });
  });
}
