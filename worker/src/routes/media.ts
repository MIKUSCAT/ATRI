import type { Router } from 'itty-router';
import { Env, RouterRequest } from '../types';
import { jsonResponse } from '../utils/json-response';
import { buildPublicUrl, sanitizeFileName } from '../utils/file';
import { requireAppToken } from '../utils/auth';

/**
 * 验证媒体访问token（通过query参数）
 * 媒体文件需要在img标签中直接访问，无法使用header传递token
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

      const url = buildPublicUrl(request, objectKey);
      return jsonResponse({ key: objectKey, url, mime, size });
    } catch (error: unknown) {
      console.error('[ATRI] Upload failed');
      return jsonResponse({ error: 'Upload failed' }, 500);
    }
  });

  router.get('/media/:key+', async (request: RouterRequest, env: Env) => {
    // 验证媒体访问token
    if (!validateMediaToken(request, env)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const rawKey = request.params?.key;
    if (!rawKey) {
      return new Response('Not found', { status: 404 });
    }
    const key = rawKey.replace(/^\//, '');
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
    return new Response(object.body, { status: 200, headers });
  });
}
