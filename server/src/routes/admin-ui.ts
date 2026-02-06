import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Env } from '../runtime/types';
import { listAppLogs, pushAppLog, subscribeAppLogs } from '../admin/log-buffer';
import { sendJson } from '../utils/reply';
import { sanitizeFileName } from '../utils/file';
import {
  deleteConversationLogsByUser,
  deleteDiaryEntriesByUser,
  deleteUserSettingsByUser,
  fetchConversationLogsAfter,
  fetchConversationLogsByDateRange,
  listDiaryDatesByUser
} from '../services/data-service';
import { deleteDiaryVectors, embedText } from '../services/memory-service';
import { callUpstreamChat } from '../services/llm-service';
import {
  getEffectiveRuntimeSettings,
  getStoredPromptsView,
  getStoredRuntimeConfigView,
  resetPromptsOverride,
  resetRuntimeConfig,
  updatePromptsOverride,
  updateRuntimeConfig
} from '../services/runtime-settings';

const SESSION_COOKIE = 'atri_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    const max = Math.max(aBuf.length, bBuf.length);
    const paddedA = Buffer.concat([aBuf, Buffer.alloc(Math.max(0, max - aBuf.length))]);
    const paddedB = Buffer.concat([bBuf, Buffer.alloc(Math.max(0, max - bBuf.length))]);
    Buffer.compare(paddedA, paddedB);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

function normalizeIp(ip: string) {
  const trimmed = String(ip || '').trim();
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

function buildAllowedIps(env: Env) {
  const base = ['127.0.0.1', '::1', '172.17.0.1'];
  const extra = String(env.ADMIN_ALLOWED_IPS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allowed = Array.from(new Set([...base, ...extra]));
  return allowed;
}

function isLocalAllowed(request: FastifyRequest, env: Env) {
  const raw = String((request.raw.socket as any)?.remoteAddress || '').trim();
  const ip = normalizeIp(raw);
  const allowed = buildAllowedIps(env);
  if (allowed.includes(ip)) return true;
  if (raw.startsWith('::ffff:') && allowed.includes(raw)) return true;
  return false;
}

function isAdminPublic(env: Env) {
  return Boolean(env.ADMIN_PUBLIC);
}

function isAdminNetworkAllowed(request: FastifyRequest, env: Env) {
  return true;
}

function normalizeOriginInput(input: string): string | null {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(request: FastifyRequest) {
  const protoHeader = String(request.headers['x-forwarded-proto'] || '').trim();
  const proto = (protoHeader.split(',')[0]?.trim() || request.protocol || 'http').toLowerCase();
  const host = String(request.headers['x-forwarded-host'] || request.headers.host || '').trim();
  if (!host) return null;
  return `${proto}://${host}`;
}

function buildAllowedOrigins(request: FastifyRequest, env: Env) {
  const allowed = new Set<string>();

  for (const origin of [
    'http://localhost',
    'http://127.0.0.1',
    'http://[::1]',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]'
  ]) {
    allowed.add(origin);
  }

  const requestOrigin = getRequestOrigin(request);
  if (requestOrigin) {
    allowed.add(requestOrigin);
  }

  const extra = String(env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => normalizeOriginInput(item))
    .filter((item): item is string => Boolean(item));
  for (const origin of extra) {
    allowed.add(origin);
  }

  const publicBaseUrl = String(env.PUBLIC_BASE_URL || '').trim();
  if (publicBaseUrl) {
    const normalized = normalizeOriginInput(publicBaseUrl);
    if (normalized) allowed.add(normalized);
  }

  return Array.from(allowed);
}

function isAllowedOrigin(request: FastifyRequest, env: Env) {
  return true;
}

function requireAdminEnabled(env: Env) {
  const adminKey = String(env.ADMIN_API_KEY || '').trim();
  return adminKey ? null : { status: 404, body: 'Not Found' };
}

function hmacSign(secret: string, data: string) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function parseCookies(cookieHeader: string | undefined) {
  const out: Record<string, string> = {};
  const raw = String(cookieHeader || '').trim();
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function readAdminSession(request: FastifyRequest, env: Env): { ok: true } | { ok: false; reason: string } {
  const secret = String(env.ADMIN_API_KEY || '').trim();
  if (!secret) return { ok: false, reason: 'admin_disabled' };

  const cookies = parseCookies(String(request.headers.cookie || ''));
  const token = String(cookies[SESSION_COOKIE] || '').trim();
  if (!token) return { ok: false, reason: 'no_session' };

  const dot = token.lastIndexOf('.');
  if (dot === -1) return { ok: false, reason: 'bad_session' };
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = hmacSign(secret, payloadB64);
  if (!timingSafeEqual(sig, expectedSig)) return { ok: false, reason: 'bad_sig' };

  let payloadText = '';
  try {
    payloadText = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }

  let data: any = null;
  try {
    data = JSON.parse(payloadText);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  const exp = typeof data?.exp === 'number' ? data.exp : 0;
  if (!exp || Date.now() > exp) return { ok: false, reason: 'expired' };

  return { ok: true };
}

function requireAdmin(request: FastifyRequest, env: Env) {
  const enabled = requireAdminEnabled(env);
  if (enabled) return enabled;
  if (!isAdminNetworkAllowed(request, env)) return { status: 404, body: 'Not Found' };
  if (!isAllowedOrigin(request, env)) return { status: 403, body: { error: 'bad_origin' } };
  const session = readAdminSession(request, env);
  if (!session.ok) return { status: 401, body: { error: 'unauthorized' } };
  return null;
}

function isHttpsRequest(request: FastifyRequest) {
  const protoHeader = String(request.headers['x-forwarded-proto'] || '').trim();
  const proto = (protoHeader.split(',')[0]?.trim() || request.protocol || '').toLowerCase();
  return proto === 'https';
}

function setCookie(reply: any, request: FastifyRequest, value: string, maxAgeSeconds: number) {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    `Path=/admin`,
    `HttpOnly`,
    `SameSite=Strict`,
    `Max-Age=${Math.max(0, Math.trunc(maxAgeSeconds))}`
  ];
  if (isHttpsRequest(request)) {
    parts.push('Secure');
  }
  reply.header('Set-Cookie', parts.join('; '));
}

type AdminUiAsset = {
  content: Buffer;
  contentType: string;
};

const ADMIN_UI_ROOTS = [
  path.join(process.cwd(), 'dist', 'admin-ui'),
  path.join(process.cwd(), 'src', 'admin-ui')
];

function normalizeAdminUiKey(raw: string) {
  const key = String(raw || '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .trim();
  if (!key || key.includes('..')) return null;
  return key;
}

function getAdminUiContentType(key: string) {
  const ext = path.extname(key).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

async function loadAdminUiAsset(key: string): Promise<AdminUiAsset | null> {
  const normalized = normalizeAdminUiKey(key);
  if (!normalized) return null;

  for (const root of ADMIN_UI_ROOTS) {
    const rootAbs = path.resolve(root);
    const fullPath = path.resolve(root, normalized);
    if (!fullPath.startsWith(rootAbs + path.sep) && fullPath !== rootAbs) continue;
    try {
      const content = await fs.readFile(fullPath);
      return { content, contentType: getAdminUiContentType(normalized) };
    } catch {
      // try next root
    }
  }

  return null;
}

function buildUserMemoryVectorIds(userId: string, dates: string[]) {
  const safeUserId = String(userId || '').trim();
  const safeDates = Array.isArray(dates) ? dates : [];
  const MAX_HIGHLIGHTS_PER_DAY = 10;
  const ids: string[] = [];

  for (const date of safeDates) {
    const d = String(date || '').trim();
    if (!d) continue;
    for (let i = 0; i < MAX_HIGHLIGHTS_PER_DAY; i++) {
      ids.push(`hl:${safeUserId}:${d}:${i}`);
    }
  }

  return ids;
}

async function deleteUserMediaObjects(env: Env, userId: string) {
  const safeUser = sanitizeFileName(userId) || 'anon';
  const userDir = path.join(env.MEDIA_ROOT, 'u', safeUser);

  try {
    await fs.access(userDir);
  } catch {
    return 0;
  }

  let deleted = 0;
  const walk = async (dir: string) => {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else {
        try {
          await fs.rm(full, { force: true });
          deleted++;
        } catch {
          // ignore
        }
      }
    }
  };

  await walk(userDir);
  await fs.rm(userDir, { recursive: true, force: true });
  return deleted;
}

export function registerAdminUiRoutes(app: FastifyInstance, env: Env) {
  app.get('/', async (request, reply) => {
    const enabled = requireAdminEnabled(env);
    if (enabled) {
      reply.code(enabled.status).type('text/plain').send(enabled.body);
      return;
    }
    if (!isAdminNetworkAllowed(request, env)) {
      reply.code(404).type('text/plain').send('Not Found');
      return;
    }
    reply.redirect('/admin');
  });

  app.get('/admin/assets/*', async (request, reply) => {
    const enabled = requireAdminEnabled(env);
    if (enabled) {
      reply.code(enabled.status).type('text/plain').send(enabled.body);
      return;
    }
    if (!isAdminNetworkAllowed(request, env)) {
      reply.code(404).type('text/plain').send('Not Found');
      return;
    }

    const rawKey = String((request.params as any)['*'] || '');
    const asset = await loadAdminUiAsset(rawKey);
    if (!asset) {
      reply.code(404).type('text/plain').send('Not Found');
      return;
    }

    reply
      .header('Content-Type', asset.contentType)
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(asset.content);
  });

  app.get('/admin', async (request, reply) => {
    const enabled = requireAdminEnabled(env);
    if (enabled) {
      reply.code(enabled.status).type('text/plain').send(enabled.body);
      return;
    }
    if (!isAdminNetworkAllowed(request, env)) {
      reply.code(404).type('text/plain').send('Not Found');
      return;
    }

    const html = await loadAdminUiAsset('index.html');
    if (!html) {
      request.log.error('[ATRI] admin ui index.html is missing');
      reply.code(500).type('text/plain').send('Admin UI is missing');
      return;
    }

    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('X-Frame-Options', 'DENY')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; img-src 'self' data:; connect-src 'self'; style-src 'self'; script-src 'self'"
      )
      .send(html.content);
  });

  app.post('/admin/api/login', async (request, reply) => {
    const enabled = requireAdminEnabled(env);
    if (enabled) return sendJson(reply, { error: 'admin_disabled' }, enabled.status);
    if (!isAdminNetworkAllowed(request, env)) return sendJson(reply, { error: 'not_found' }, 404);
    if (!isAllowedOrigin(request, env)) return sendJson(reply, { error: 'bad_origin' }, 403);

    const body = request.body as any;
    const provided = String(body?.apiKey || '').trim();
    const expected = String(env.ADMIN_API_KEY || '').trim();

    if (!provided || !timingSafeEqual(provided, expected)) {
      return sendJson(reply, { error: 'forbidden' }, 403);
    }

    const payload = {
      v: 1,
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL_MS,
      nonce: randomBytes(12).toString('base64url')
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = hmacSign(expected, payloadB64);
    const token = `${payloadB64}.${sig}`;
    setCookie(reply, request, token, SESSION_TTL_MS / 1000);
    pushAppLog('info', 'admin_login', { event: 'admin_login' });
    return sendJson(reply, { ok: true });
  });

  app.post('/admin/api/logout', async (request, reply) => {
    const enabled = requireAdminEnabled(env);
    if (enabled) return sendJson(reply, { error: 'admin_disabled' }, enabled.status);
    if (!isAdminNetworkAllowed(request, env)) return sendJson(reply, { error: 'not_found' }, 404);
    setCookie(reply, request, '', 0);
    pushAppLog('info', 'admin_logout', { event: 'admin_logout' });
    return sendJson(reply, { ok: true });
  });

  app.get('/admin/api/session', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);
    return sendJson(reply, { ok: true });
  });

  app.get('/admin/api/info', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);

    const origin = getRequestOrigin(request);
    const envCandidates = [
      'ZEABUR_GIT_COMMIT_SHA',
      'RENDER_GIT_COMMIT',
      'RAILWAY_GIT_COMMIT_SHA',
      'VERCEL_GIT_COMMIT_SHA',
      'GIT_COMMIT_SHA',
      'SOURCE_VERSION'
    ];
    const commitSha = envCandidates.map(key => String(process.env[key] || '').trim()).find(Boolean) || null;

    return sendJson(reply, {
      ok: true,
      now: Date.now(),
      origin,
      admin: {
        public: isAdminPublic(env),
        allowedOrigins: buildAllowedOrigins(request, env)
      },
      build: {
        node: process.version,
        commitSha
      }
    });
  });

  app.get('/admin/api/config', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);

    const [stored, effective] = await Promise.all([
      getStoredRuntimeConfigView(env),
      getEffectiveRuntimeSettings(env)
    ]);

    return sendJson(reply, {
      ok: true,
      stored,
      effective: {
        chatApiFormat: effective.chatApiFormat,
        diaryApiFormat: effective.diaryApiFormat,
        anthropicVersion: effective.anthropicVersion,
        openaiApiUrl: effective.openaiApiUrl,
        embeddingsApiUrl: effective.embeddingsApiUrl,
        embeddingsModel: effective.embeddingsModel,
        diaryApiUrl: effective.diaryApiUrl,
        diaryModel: effective.diaryModel,
        defaultChatModel: effective.defaultChatModel,
        agentTemperature: effective.agentTemperature,
        agentMaxTokens: effective.agentMaxTokens,
        diaryTemperature: effective.diaryTemperature,
        diaryMaxTokens: effective.diaryMaxTokens,
        profileTemperature: effective.profileTemperature
      }
    });
  });

  app.post('/admin/api/config', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);

    const body = request.body as any;
    try {
      const configKeys = body?.config && typeof body.config === 'object' ? Object.keys(body.config) : [];
      const secretKeys = body?.secrets && typeof body.secrets === 'object' ? Object.keys(body.secrets) : [];
      const result = await updateRuntimeConfig(env, {
        config: body?.config,
        secrets: body?.secrets
      });
      pushAppLog('info', 'admin_config_updated', {
        event: 'admin_config_updated',
        configKeys: configKeys.slice(0, 30),
        secretKeys: secretKeys.slice(0, 30)
      });
      return sendJson(reply, result);
    } catch (error: any) {
      return sendJson(reply, { error: 'config_update_failed', details: String(error?.message || error) }, 400);
    }
  });

  app.post('/admin/api/config/reset', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);
    pushAppLog('warn', 'admin_config_reset', { event: 'admin_config_reset' });
    return sendJson(reply, await resetRuntimeConfig(env));
  });

  app.get('/admin/api/prompts', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);
    const view = await getStoredPromptsView(env);
    return sendJson(reply, { ok: true, ...view });
  });

  app.post('/admin/api/prompts', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);
    const body = request.body as any;
    try {
      const result = await updatePromptsOverride(env, body);
      pushAppLog('info', 'admin_prompts_updated', { event: 'admin_prompts_updated' });
      return sendJson(reply, result);
    } catch (error: any) {
      return sendJson(reply, { error: 'prompts_update_failed', details: String(error?.message || error) }, 400);
    }
  });

  app.post('/admin/api/prompts/reset', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);
    pushAppLog('warn', 'admin_prompts_reset', { event: 'admin_prompts_reset' });
    return sendJson(reply, await resetPromptsOverride(env));
  });

  app.post('/admin/api/prompts/import', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);

    const body = request.body as any;
    const rawUrl = String(body?.url || '').trim();
    if (!rawUrl) {
      return sendJson(reply, { error: 'missing_url' }, 400);
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return sendJson(reply, { error: 'bad_url' }, 400);
    }

    if (url.protocol !== 'https:') {
      return sendJson(reply, { error: 'https_required' }, 400);
    }

    const hostname = url.hostname.toLowerCase();
    const allowedHosts = new Set(['raw.githubusercontent.com', 'gist.githubusercontent.com']);
    if (!allowedHosts.has(hostname)) {
      return sendJson(reply, { error: 'host_not_allowed', details: hostname }, 400);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'User-Agent': 'atri-server-admin' },
        signal: controller.signal
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return sendJson(reply, { error: 'fetch_failed', status: res.status, details: text.slice(0, 500) }, 400);
      }

      const text = await res.text();
      if (text.length > 1_000_000) {
        return sendJson(reply, { error: 'payload_too_large' }, 400);
      }

      let payload: any = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        return sendJson(reply, { error: 'bad_json' }, 400);
      }

      const result = await updatePromptsOverride(env, payload);
      pushAppLog('info', 'admin_prompts_imported', { event: 'admin_prompts_imported', host: hostname });
      return sendJson(reply, result);
    } catch (error: any) {
      const reason = error?.name === 'AbortError' ? 'timeout' : String(error?.message || error);
      return sendJson(reply, { error: 'fetch_error', details: reason }, 400);
    } finally {
      clearTimeout(timeoutId);
    }
  });

  app.post('/admin/api/clear-user', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);

    const body = request.body as any;
    const userId = String(body?.userId || '').trim();
    if (!userId) {
      return sendJson(reply, { error: 'missing_user' }, 400);
    }

    try {
      pushAppLog('warn', 'admin_clear_user_begin', { event: 'admin_clear_user_begin', userId });
      const diaryDates = await listDiaryDatesByUser(env, userId);
      const diaryDeleted = await deleteDiaryEntriesByUser(env, userId);
      const logDeleted = await deleteConversationLogsByUser(env, userId);
      const vectorIds = buildUserMemoryVectorIds(userId, diaryDates);
      const vectorDeleted = vectorIds.length ? await deleteDiaryVectors(env, vectorIds) : 0;
      const mediaDeleted = await deleteUserMediaObjects(env, userId);
      const settingsDeleted = await deleteUserSettingsByUser(env, userId);

      pushAppLog('warn', 'admin_clear_user_done', {
        event: 'admin_clear_user_done',
        userId,
        stats: { diaries: diaryDeleted, diaryVectors: vectorDeleted, conversationLogs: logDeleted, mediaObjects: mediaDeleted, userSettings: settingsDeleted }
      });
      return sendJson(reply, {
        ok: true,
        userId,
        stats: {
          diaries: diaryDeleted,
          diaryVectors: vectorDeleted,
          conversationLogs: logDeleted,
          mediaObjects: mediaDeleted,
          userSettings: settingsDeleted
        }
      });
    } catch (error: any) {
      request.log.error({ error, userId }, '[ATRI] Failed to clear user data (admin-ui)');
      return sendJson(reply, { error: 'clear_failed', details: String(error?.message || error) }, 500);
    }
  });

  app.get('/admin/api/logs', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);
    return sendJson(reply, { ok: true, items: listAppLogs() });
  });

  app.get('/admin/api/logs/stream', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    (reply.raw as any).flushHeaders?.();

    const writeEvent = (event: string, data: any) => {
      try {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        // ignore
      }
    };

    writeEvent('snapshot', { items: listAppLogs() });
    const unsubscribe = subscribeAppLogs((entry) => writeEvent('log', entry));
    const pingTimer = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        // ignore
      }
    }, 15000);

    const close = () => {
      clearInterval(pingTimer);
      unsubscribe();
      try {
        reply.raw.end();
      } catch {
        // ignore
      }
    };
    request.raw.on('close', close);
    request.raw.on('error', close);

    reply.hijack();
  });

  app.get('/admin/api/conversation/pull', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);

    const userId = String((request.query as any)?.userId || '').trim();
    if (!userId) {
      return sendJson(reply, { error: 'missing_user' }, 400);
    }

    const afterRaw = Number((request.query as any)?.after || '0');
    const limitRaw = Number((request.query as any)?.limit || '50');
    const roleParam = String((request.query as any)?.role || '').trim();
    const dateRaw = String((request.query as any)?.date || '').trim();
    const dateFromRaw = String((request.query as any)?.dateFrom || '').trim() || dateRaw;
    const dateToRaw = String((request.query as any)?.dateTo || '').trim() || dateRaw;
    const roles = roleParam
      ? roleParam.split(',').map((item: string) => item.trim()).filter((r) => r === 'user' || r === 'atri')
      : [];
    const hasDateRange = Boolean(dateRaw || dateFromRaw || dateToRaw);

    const isIsoDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (hasDateRange && (!isIsoDate(dateFromRaw) || !isIsoDate(dateToRaw))) {
      return sendJson(reply, { error: 'invalid_date_format', details: 'date/dateFrom/dateTo 必须为 YYYY-MM-DD' }, 400);
    }

    try {
      const logs = hasDateRange
        ? await fetchConversationLogsByDateRange(env, {
            userId,
            dateFrom: dateFromRaw || undefined,
            dateTo: dateToRaw || undefined,
            after: Number.isFinite(afterRaw) ? afterRaw : 0,
            limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
            roles: roles as Array<'user' | 'atri'>
          })
        : await fetchConversationLogsAfter(env, {
            userId,
            after: Number.isFinite(afterRaw) ? afterRaw : 0,
            limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
            roles: roles as Array<'user' | 'atri'>
          });
      return sendJson(reply, { logs });
    } catch (error: any) {
      request.log.error({ error, userId }, '[ATRI] admin conversation pull failed');
      return sendJson(reply, { error: 'pull_failed' }, 500);
    }
  });

  app.get('/admin/api/tools/db', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);
    const result = await env.db.query('SELECT 1 as ok');
    return sendJson(reply, { ok: true, row: result.rows?.[0] ?? null });
  });

  app.get('/admin/api/tools/openai-models', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);

    const settings = await getEffectiveRuntimeSettings(env);
    const apiUrl = String(settings.openaiApiUrl || '').trim();
    const apiKey = String(settings.openaiApiKey || '').trim();
    if (!apiUrl || !apiKey) {
      return sendJson(reply, { error: 'missing_api_config' }, 400);
    }

    const model = String(settings.defaultChatModel || '').trim() || 'default';

    try {
      const result = await callUpstreamChat(env, {
        format: settings.chatApiFormat,
        apiUrl,
        apiKey,
        model,
        messages: [
          { role: 'system', content: '你是健康检查，只回复 pong。' },
          { role: 'user', content: 'ping' }
        ],
        temperature: 0,
        maxTokens: 32,
        timeoutMs: 12000,
        anthropicVersion: settings.anthropicVersion
      });

      const content = result.message?.content;
      const text = typeof content === 'string' ? content : String(content || '');
      const replyText = text.trim().slice(0, 400);

      return sendJson(reply, { ok: true, provider: settings.chatApiFormat, model, reply: replyText });
    } catch (error: any) {
      const isApi = error?.status && typeof error.status === 'number';
      const details = isApi ? String(error?.details || '') : String(error?.message || error);
      return sendJson(reply, { error: 'upstream_test_failed', details: details.slice(0, 2000) }, 502);
    }
  });

  app.post('/admin/api/tools/embeddings', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);
    const body = request.body as any;
    const text = String(body?.text || 'hello').trim() || 'hello';
    const vec = await embedText(text.slice(0, 4000), env);
    return sendJson(reply, { ok: true, dim: Array.isArray(vec) ? vec.length : 0 });
  });

  app.get('/admin/api/tools/fetch-models', async (request, reply) => {
    const guard = requireAdmin(request, env);
    if (guard) return sendJson(reply, guard.body, guard.status);

    const settings = await getEffectiveRuntimeSettings(env);
    const apiUrl = String(settings.openaiApiUrl || '').trim();
    const apiKey = String(settings.openaiApiKey || '').trim();
    if (!apiUrl || !apiKey) {
      return sendJson(reply, { error: 'missing_api_config', models: [] }, 400);
    }

    const apiBaseUrl = apiUrl.replace(/\/+$/, '');

    try {
      if (settings.chatApiFormat === 'gemini') {
        const url = new URL(`${apiBaseUrl}/v1beta/models`);
        url.searchParams.set('key', apiKey);
        const response = await fetch(url.toString(), {
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) {
          const errorText = await response.text();
          return sendJson(reply, { error: 'model_fetch_failed', details: errorText, models: [] }, 200);
        }
        const payload: any = await response.json();
        const entries: any[] = Array.isArray(payload?.models) ? payload.models : [];
        const models = entries.map((item) => {
          const name = typeof item?.name === 'string' ? item.name.trim() : '';
          const label = typeof item?.displayName === 'string' ? item.displayName.trim() : '';
          return { id: name, label: label || name, provider: 'gemini' };
        }).filter((m) => m.id);
        return sendJson(reply, { models });
      }

      if (settings.chatApiFormat === 'anthropic') {
        return sendJson(reply, { models: [], warning: 'anthropic_no_models_endpoint' });
      }

      const response = await fetch(`${apiBaseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        return sendJson(reply, { error: 'model_fetch_failed', details: errorText, models: [] }, response.status);
      }
      const payload: any = await response.json();
      const entries: any[] = Array.isArray(payload?.data) ? payload.data : [];
      const models = entries.filter(item => typeof item?.id === 'string').map(item => ({
        id: item.id || '',
        label: item.id || '',
        provider: item.owned_by || 'unknown'
      }));
      return sendJson(reply, { models });
    } catch (error: any) {
      return sendJson(reply, { error: 'model_fetch_error', details: String(error?.message || error), models: [] }, 500);
    }
  });
}
