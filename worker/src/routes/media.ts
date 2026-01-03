import type { Router } from 'itty-router';
import { Env, RouterRequest } from '../types';
import { jsonResponse } from '../utils/json-response';
import { buildPublicUrl, sanitizeFileName } from '../utils/file';
import { requireAppToken } from '../utils/auth';
import { signMediaUrlForClient, signMediaUrlForModel, validateSignedMediaPathParams, validateSignedMediaRequest } from '../utils/media-signature';

/**
 * 验证媒体访问token（通过 query 参数）
 * 仅作为兼容兜底：更推荐签名 URL（给模型）或 Header 鉴权（给 App）
 */
function validateMediaToken(request: Request, env: Env): boolean {
  const expected = (env.APP_TOKEN || '').trim();
  if (!expected) return true; // 未配置token时跳过验证

  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').trim();

  // 时序安全比较
  if (token.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

function validateMediaHeaderToken(request: Request, env: Env): boolean {
  const expected = (env.APP_TOKEN || '').trim();
  if (!expected) return true;
  const provided = (request.headers.get('X-App-Token') || request.headers.get('x-app-token') || '').trim();
  if (provided.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < provided.length; i++) {
    result |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

export function registerMediaRoutes(router: Router) {
  router.post('/upload', async (request: RouterRequest, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      if (!request.body) {
        return jsonResponse({ error: 'Missing file body' }, 400);
      }
      const fileNameHeader = request.headers.get('x-file-name') || `upload-${Date.now()}`;
      const userIdHeader = request.headers.get('x-user-id') || 'anonymous';
      const mime = request.headers.get('x-file-type') || 'application/octet-stream';
      const sizeHeader = request.headers.get('x-file-size');
      const size = sizeHeader ? Number(sizeHeader) : undefined;
      const safeName = sanitizeFileName(fileNameHeader);
      const safeUser = sanitizeFileName(userIdHeader) || 'anon';
      const objectKey = `u/${safeUser}/${Date.now()}-${safeName}`;

      await env.MEDIA_BUCKET.put(objectKey, request.body, {
        httpMetadata: {
          contentType: mime,
          contentDisposition: `inline; filename="${safeName}"`
        }
      });

      const rawUrl = buildPublicUrl(request, objectKey);
      // 给 App 的 url：默认签 1 年，避免聊天历史图片很快失效
      const url = await signMediaUrlForClient(rawUrl, env);
      // 给模型的短签名 URL（可选，兜底给需要“短时效”的场景）
      const signedUrl = await signMediaUrlForModel(rawUrl, env, { ttlSeconds: 600 });
      return jsonResponse({ key: objectKey, url: url || rawUrl, signedUrl, rawUrl, mime, size });
    } catch (error: unknown) {
      console.error('[ATRI] Upload failed');
      return jsonResponse({ error: 'Upload failed' }, 500);
    }
  });

  // 给模型用的“路径签名”媒体地址：避免模型侧丢 query 参数导致 401
  router.head('/media-s/:exp/:sig/:key+', async (request: RouterRequest, env: Env) => {
    const rawKey = request.params?.key;
    const exp = request.params?.exp;
    const sig = request.params?.sig;
    if (!rawKey || !exp || !sig) {
      return new Response('Not found', { status: 404 });
    }
    const key = rawKey.replace(/^\//, '');

    const signedOk = await validateSignedMediaPathParams(env, key, exp, sig);
    if (!signedOk && !validateMediaHeaderToken(request, env) && !validateMediaToken(request, env)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const object = await env.MEDIA_BUCKET.head(key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }
    const headers = new Headers();
    headers.set('Cache-Control', 'public, max-age=31536000');
    if (object.httpMetadata?.contentType) {
      headers.set('Content-Type', object.httpMetadata.contentType);
    }
    if (object.httpMetadata?.contentDisposition) {
      headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
    }
    if (typeof object.size === 'number' && Number.isFinite(object.size)) {
      headers.set('Content-Length', String(object.size));
    }
    return new Response(null, { status: 200, headers });
  });

  router.get('/media-s/:exp/:sig/:key+', async (request: RouterRequest, env: Env) => {
    const rawKey = request.params?.key;
    const exp = request.params?.exp;
    const sig = request.params?.sig;
    if (!rawKey || !exp || !sig) {
      return new Response('Not found', { status: 404 });
    }
    const key = rawKey.replace(/^\//, '');

    const signedOk = await validateSignedMediaPathParams(env, key, exp, sig);
    if (!signedOk && !validateMediaHeaderToken(request, env) && !validateMediaToken(request, env)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const object = await env.MEDIA_BUCKET.get(key);
    if (!object || !object.body) {
      return new Response('Not found', { status: 404 });
    }
    const headers = new Headers();
    headers.set('Cache-Control', 'public, max-age=31536000');
    if (object.httpMetadata?.contentType) {
      headers.set('Content-Type', object.httpMetadata.contentType);
    }
    if (object.httpMetadata?.contentDisposition) {
      headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
    }
    if (typeof object.size === 'number' && Number.isFinite(object.size)) {
      headers.set('Content-Length', String(object.size));
    }
    return new Response(object.body, { status: 200, headers });
  });

  router.head('/media/:key+', async (request: RouterRequest, env: Env) => {
    const rawKey = request.params?.key;
    if (!rawKey) {
      return new Response('Not found', { status: 404 });
    }
    const key = rawKey.replace(/^\//, '');

    // 访问控制：签名 URL（给模型）优先，其次 Header Token（给 App），最后兼容 query token
    const signedOk = await validateSignedMediaRequest(request, env, key);
    if (!signedOk && !validateMediaHeaderToken(request, env) && !validateMediaToken(request, env)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const object = await env.MEDIA_BUCKET.head(key);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }
    const headers = new Headers();
    headers.set('Cache-Control', 'public, max-age=31536000');
    if (object.httpMetadata?.contentType) {
      headers.set('Content-Type', object.httpMetadata.contentType);
    }
    if (object.httpMetadata?.contentDisposition) {
      headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
    }
    if (typeof object.size === 'number' && Number.isFinite(object.size)) {
      headers.set('Content-Length', String(object.size));
    }
    return new Response(null, { status: 200, headers });
  });

  router.get('/media/:key+', async (request: RouterRequest, env: Env) => {
    const rawKey = request.params?.key;
    if (!rawKey) {
      return new Response('Not found', { status: 404 });
    }
    const key = rawKey.replace(/^\//, '');

    // 访问控制：签名 URL（给模型）优先，其次 Header Token（给 App），最后兼容 query token
    const signedOk = await validateSignedMediaRequest(request, env, key);
    if (!signedOk && !validateMediaHeaderToken(request, env) && !validateMediaToken(request, env)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const object = await env.MEDIA_BUCKET.get(key);
    if (!object || !object.body) {
      return new Response('Not found', { status: 404 });
    }
    const headers = new Headers();
    headers.set('Cache-Control', 'public, max-age=31536000');
    if (object.httpMetadata?.contentType) {
      headers.set('Content-Type', object.httpMetadata.contentType);
    }
    if (object.httpMetadata?.contentDisposition) {
      headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
    }
    if (typeof object.size === 'number' && Number.isFinite(object.size)) {
      headers.set('Content-Length', String(object.size));
    }
    return new Response(object.body, { status: 200, headers });
  });
}
