import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { Env } from '../runtime/types';
import { sendJson } from '../utils/reply';
import { sanitizeText } from '../utils/sanitize';
import { runAgentChat } from '../services/agent-service';
import { saveConversationLog } from '../services/data-service';
import { getEffectiveRuntimeSettings } from '../services/runtime-settings';
import { DEFAULT_TIMEZONE, formatDateInZone } from '../utils/date';

function pickHeader(request: FastifyRequest, name: string) {
  const raw = request.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ? String(raw[0]) : '';
  return typeof raw === 'string' ? raw : '';
}

function extractBearerToken(request: FastifyRequest) {
  const auth = pickHeader(request, 'authorization').trim();
  if (!auth) return '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function buildStableAnonUserId(apiKey: string) {
  const key = String(apiKey || '').trim();
  if (!key) return 'anon';
  const hash = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
  return `anon:${hash}`;
}

function getCompatExpectedKey(env: Env) {
  return String(env.COMPAT_API_KEY || env.APP_TOKEN || '').trim();
}

function requireCompatKey(rawProvidedKey: string, env: Env): { ok: true; key: string } | { ok: false; status: number; body: any } {
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
  if (Array.isArray(content)) {
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
  return '';
}

function extractLastUserTextFromOpenAiMessages(messages: any[]) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role !== 'user') continue;
    return extractTextFromOpenAiContent((msg as any).content);
  }
  return '';
}

function extractTextFromAnthropicContent(content: any) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
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
  return '';
}

function extractLastUserTextFromAnthropicMessages(messages: any[]) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role !== 'user') continue;
    return extractTextFromAnthropicContent((msg as any).content);
  }
  return '';
}

function extractLastUserTextFromGeminiContents(contents: any[]) {
  if (!Array.isArray(contents)) return '';
  for (let i = contents.length - 1; i >= 0; i--) {
    const item = contents[i];
    if (!item || typeof item !== 'object') continue;
    if (item.role !== 'user') continue;
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
  model: string;
  platform: string;
}) {
  const ts = Date.now();
  const date = formatDateInZone(ts, DEFAULT_TIMEZONE);
  const userLogId = randomUUID();
  const replyLogId = randomUUID();

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

export function registerCompatRoutes(app: FastifyInstance, env: Env) {
  app.post('/v1/chat/completions', async (request, reply) => {
    const guard = requireCompatKey(extractBearerToken(request), env);
    if (!guard.ok) return sendJson(reply, guard.body, guard.status);

    const body = (request.body || {}) as any;
    if (body?.stream === true) {
      return sendJson(reply, { error: { message: 'stream=true is not supported on this VPS backend (please disable streaming).' } }, 400);
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const messageText = sanitizeText(extractLastUserTextFromOpenAiMessages(messages)).trim();
    if (!messageText) {
      return sendJson(reply, { error: { message: 'No user message found' } }, 400);
    }

    const userId =
      String(pickHeader(request, 'x-user-id') || '').trim()
      || (typeof body?.user === 'string' ? body.user.trim() : '')
      || buildStableAnonUserId(guard.key);

    const settings = await getEffectiveRuntimeSettings(env);
    const model = typeof body?.model === 'string' && body.model.trim()
      ? body.model.trim()
      : settings.defaultChatModel;

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
      replyText: result.reply,
      model,
      platform: 'openai'
    });

    const created = Math.floor(Date.now() / 1000);
    return sendJson(reply, {
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

  app.post('/v1/messages', async (request, reply) => {
    const provided = pickHeader(request, 'x-api-key').trim() || extractBearerToken(request);
    const guard = requireCompatKey(provided, env);
    if (!guard.ok) return sendJson(reply, guard.body, guard.status);

    const body = (request.body || {}) as any;
    if (body?.stream === true) {
      return sendJson(reply, { error: { message: 'stream=true is not supported on this VPS backend (please disable streaming).' } }, 400);
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const messageText = sanitizeText(extractLastUserTextFromAnthropicMessages(messages)).trim();
    if (!messageText) {
      return sendJson(reply, { error: { message: 'No user message found' } }, 400);
    }

    const userId =
      String(pickHeader(request, 'x-user-id') || '').trim()
      || (typeof body?.metadata?.user_id === 'string' ? body.metadata.user_id.trim() : '')
      || buildStableAnonUserId(guard.key);

    const settings = await getEffectiveRuntimeSettings(env);
    const model = typeof body?.model === 'string' && body.model.trim()
      ? body.model.trim()
      : settings.defaultChatModel;

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
      replyText: result.reply,
      model,
      platform: 'anthropic'
    });

    return sendJson(reply, {
      id: `msg_${meta.replyLogId.replace(/-/g, '')}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: result.reply }],
      stop_reason: 'end_turn',
      stop_sequence: null
    });
  });

  app.post('/v1beta/models/*', async (request, reply) => {
    const path = String((request.params as any)?.['*'] || '');
    const generateSuffix = ':generateContent';
    const streamSuffix = ':streamGenerateContent';

    if (path.endsWith(streamSuffix)) {
      return sendJson(reply, { error: { message: 'streamGenerateContent is not supported on this VPS backend (use generateContent).' } }, 400);
    }

    if (!path.endsWith(generateSuffix)) {
      return reply.callNotFound();
    }

    const modelFromPath = path.slice(0, -generateSuffix.length);

    const keyFromQuery = typeof (request.query as any)?.key === 'string' ? String((request.query as any).key || '') : '';
    const keyFromHeader = pickHeader(request, 'x-goog-api-key').trim();
    const guard = requireCompatKey(keyFromQuery || keyFromHeader, env);
    if (!guard.ok) return sendJson(reply, guard.body, guard.status);

    const body = (request.body || {}) as any;
    const contents = Array.isArray(body?.contents) ? body.contents : [];
    const messageText = sanitizeText(extractLastUserTextFromGeminiContents(contents)).trim();
    if (!messageText) {
      return sendJson(reply, { error: { message: 'No user content found' } }, 400);
    }

    const userId =
      String(pickHeader(request, 'x-user-id') || '').trim()
      || buildStableAnonUserId(guard.key);

    const settings = await getEffectiveRuntimeSettings(env);
    const model = modelFromPath && modelFromPath.trim()
      ? modelFromPath.trim()
      : settings.defaultChatModel;

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
      replyText: result.reply,
      model,
      platform: 'gemini'
    });

    return sendJson(reply, {
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
