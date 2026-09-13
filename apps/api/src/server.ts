import Fastify from 'fastify';
import QRCode from 'qrcode';
import { createHash, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from '@atri/db';
import { createBackup } from '@atri/db';
import type { Runtime } from '@atri/core';
import { sniffMediaMime } from '@atri/ilink';
import type { Settings } from './config.js';
import type { Stickers } from './stickers.js';
import type { WeChatBridge } from './wechat.js';

export interface ServerOptions {
  store: Store;
  settings: Settings;
  runtime: Runtime;
  bridge: WeChatBridge;
  stickers: Stickers;
}
const digest = (v: string) => createHash('sha256').update(v).digest();
const text = (v: unknown, max = 12000) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw new Error(`文本需要 1–${max} 个字符`);
  return v.trim();
};
export function createServer(o: ServerOptions) {
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024, logger: false });
  const sessions = new Map<string, number>(),
    failures = new Map<string, { count: number; until: number }>();
  const credentials = digest(o.settings.adminPassword);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'same-origin');
    reply.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    if (!request.url.startsWith('/api/') || request.url === '/api/login') return;
    const bearer = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const token = /\batri_session=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
    const validBearer = !!bearer && timingSafeEqual(digest(bearer), credentials);
    if (!validBearer && (!token || (sessions.get(token) ?? 0) < Date.now()))
      return reply.code(401).send({ error: '请先登录管理页' });
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin) {
      try {
        if (new URL(request.headers.origin).host !== request.headers.host)
          return reply.code(403).send({ error: '请求来源不匹配' });
      } catch {
        return reply.code(403).send({ error: '请求来源无效' });
      }
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const e = error as Error & { statusCode?: number };
    reply
      .code(e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 400)
      .send({ error: e.message.slice(0, 300) });
  });
  app.get('/healthz', () => ({ ok: true }));
  app.get('/', (_request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(readFileSync(join(o.settings.root, 'apps', 'api', 'public', 'index.html'), 'utf8')),
  );
  app.get('/app.js', (_request, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .send(readFileSync(join(o.settings.root, 'apps', 'api', 'public', 'app.js'), 'utf8')),
  );
  app.get('/app.css', (_request, reply) =>
    reply
      .type('text/css; charset=utf-8')
      .send(readFileSync(join(o.settings.root, 'apps', 'api', 'public', 'app.css'), 'utf8')),
  );
  for (const file of ['atri.webp', 'avatar.webp']) {
    app.get('/' + file, (_request, reply) =>
      reply
        .type('image/webp')
        .header('cache-control', 'public, max-age=86400')
        .send(readFileSync(join(o.settings.root, 'apps', 'api', 'public', file))),
    );
  }
  app.post<{ Body: { password?: string } }>('/api/login', async (request, reply) => {
    if (request.headers.origin) {
      try {
        if (new URL(request.headers.origin).host !== request.headers.host)
          return reply.code(403).send({ error: '请求来源不匹配' });
      } catch {
        return reply.code(403).send({ error: '请求来源无效' });
      }
    }
    const now = Date.now(),
      ip = request.ip,
      attempt = failures.get(ip);
    if (attempt && attempt.until > now && attempt.count >= 8)
      return reply.code(429).send({ error: '尝试次数较多，请一分钟后再试' });
    if (
      typeof request.body?.password !== 'string' ||
      !timingSafeEqual(digest(request.body.password), credentials)
    ) {
      failures.set(ip, {
        count: attempt && attempt.until > now ? attempt.count + 1 : 1,
        until: now + 60000,
      });
      if (failures.size > 1000)
        for (const [key, value] of failures) if (value.until < now) failures.delete(key);
      return reply.code(401).send({ error: '管理密码不正确' });
    }
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, now + 12 * 3600000);
    if (sessions.size > 100) sessions.delete(sessions.keys().next().value!);
    reply.header(
      'set-cookie',
      `atri_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${o.settings.secureCookie ? '; Secure' : ''}`,
    );
    return { ok: true };
  });
  app.post('/api/logout', (request, reply) => {
    const token = /\batri_session=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
    if (token) sessions.delete(token);
    reply.header('set-cookie', 'atri_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return { ok: true };
  });
  app.get('/api/status', async () => {
    const status = o.bridge.status();
    return {
      wechat: {
        ...status,
        qrContent: undefined,
        qrData: status.qrContent
          ? await QRCode.toDataURL(status.qrContent, { width: 256, margin: 2 })
          : undefined,
      },
      config: o.settings.publicConfig(),
      usage: o.store.usage(),
      recentUsage: o.store.recentUsage(),
      issues: o.store.issues(),
    };
  });
  app.post('/api/wechat/login', () => o.bridge.login());
  app.post('/api/wechat/logout', () => {
    o.bridge.logout();
    return { ok: true };
  });
  app.get('/api/config', () => o.settings.publicConfig());
  app.post('/api/backup', async () => {
    const result = await createBackup(o.store, o.settings.dataDir);
    return {
      directory: result.directory,
      files: result.manifest.files.length,
      messages: result.manifest.messages,
    };
  });
  app.put<{ Body: Record<string, unknown> }>('/api/config', (request) =>
    o.settings.update(request.body),
  );
  app.get('/api/persona', () => ({ content: o.settings.prompt('persona') }));
  app.put<{ Body: { content: string } }>('/api/persona', (request) => {
    o.settings.savePersona(text(request.body.content));
    return { ok: true };
  });
  app.get('/api/peers', () => o.store.peers().map(({ context_token, ...peer }) => peer));
  app.put<{ Params: { id: string }; Body: { approved: boolean } }>('/api/peers/:id', (request) => {
    if (typeof request.body.approved !== 'boolean' || !o.store.peer(request.params.id))
      throw new Error('联系人或设置无效');
    o.store.approve(request.params.id, request.body.approved);
    o.runtime.pump();
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/api/peers/:id/history', (request) =>
    o.store.history(request.params.id, 100).map(({ media, ...m }) => ({
      ...m,
      media: media.map(({ kind, description }) => ({ kind, description })),
    })),
  );
  app.get<{ Params: { id: string } }>('/api/peers/:id/memories', (request) =>
    o.store.memories(request.params.id),
  );
  app.get<{ Params: { id: string } }>('/api/peers/:id/diaries', (request) =>
    o.store.diaries(request.params.id),
  );
  app.get<{ Params: { id: string }; Querystring: { ids?: string } }>(
    '/api/peers/:id/sources',
    (request) => o.store.sources(request.params.id, text(request.query.ids, 4000).split(',')),
  );
  app.post<{ Params: { id: string } }>('/api/peers/:id/diary', (request) => {
    if (!o.store.peer(request.params.id)?.approved) throw new Error('请先允许此联系人使用');
    const taskId = o.runtime.queueDiary(request.params.id, true);
    return { taskId: taskId ?? null };
  });
  app.put<{ Params: { peer: string; id: string }; Body: { content: string } }>(
    '/api/peers/:peer/memories/:id',
    (request) => {
      o.store.correctMemory(
        request.params.peer,
        request.params.id,
        text(request.body.content, 800),
      );
      return { ok: true };
    },
  );
  app.delete<{ Params: { peer: string; id: string } }>(
    '/api/peers/:peer/records/:id',
    (request) => {
      o.store.forget(request.params.peer, request.params.id);
      return { ok: true };
    },
  );
  app.post<{ Body: { content: string; eventId?: string } }>('/api/chat', (request, reply) => {
    const peer = o.store.ensurePeer('preview:default', 'preview', '本地试聊', '', true);
    const event = o.runtime.accept(
      peer.id,
      request.body.eventId ? text(request.body.eventId, 100) : randomUUID(),
      text(request.body.content),
    );
    reply.code(202);
    return { peerId: peer.id, messageId: event.message.id, taskId: event.taskId ?? null };
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id', (request) => {
    const task = o.store.taskById(request.params.id);
    if (!task) throw new Error('任务不存在');
    return { id: task.id, state: task.state, error: task.error };
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/retry', (request) => {
    const task = o.store.taskById(request.params.id);
    if (!task || task.state !== 'failed') throw new Error('只有失败任务可以重试');
    o.store.retry(task.id);
    o.runtime.pump();
    return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: { action: string } }>(
    '/api/deliveries/:id',
    (request) => {
      const issue = o.store.issues().deliveries.find((d) => d.id === request.params.id);
      if (!issue) throw new Error('待处理的发送记录不存在');
      const status =
        request.body.action === 'confirmed'
          ? 'sent'
          : request.body.action === 'retry'
            ? 'pending'
            : request.body.action === 'skip'
              ? 'cancelled'
              : null;
      if (!status) throw new Error('处理方式无效');
      o.store.markDelivery(request.params.id, status);
      o.runtime.pump();
      return { ok: true };
    },
  );
  app.get('/api/stickers', () => o.stickers.list(true).map(({ file, ...s }) => s));
  app.get<{ Params: { slug: string } }>('/api/stickers/:slug/image', (request, reply) => {
    const bytes = o.stickers.bytes(request.params.slug);
    return reply.type(sniffMediaMime(bytes) ?? 'application/octet-stream').send(bytes);
  });
  app.post<{ Body: { slug: string; description: string; tags: string[]; base64: string } }>(
    '/api/stickers',
    (request) => {
      const b = request.body;
      if (!b || !Array.isArray(b.tags) || b.tags.some((t) => typeof t !== 'string'))
        throw new Error('表情标签无效');
      o.stickers.add({
        slug: text(b.slug, 40),
        description: text(b.description, 200),
        tags: b.tags,
        base64: text(b.base64, 4 * 1024 * 1024),
      });
      return { ok: true };
    },
  );
  app.delete<{ Params: { slug: string } }>('/api/stickers/:slug', (request) => {
    o.stickers.disable(request.params.slug);
    return { ok: true };
  });
  app.post<{ Params: { slug: string } }>('/api/stickers/:slug/enable', (request) => {
    o.stickers.enable(request.params.slug);
    return { ok: true };
  });
  return app;
}
