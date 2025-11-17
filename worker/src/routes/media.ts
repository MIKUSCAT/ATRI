import type { Router } from 'itty-router';
import { Env, RouterRequest } from '../types';
import { jsonResponse } from '../utils/json-response';
import { buildPublicUrl, sanitizeFileName } from '../utils/file';

export function registerMediaRoutes(router: Router) {
  router.post('/upload', async (request: RouterRequest, env: Env) => {
    try {
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
    } catch (error: any) {
      console.error('[ATRI] Upload failed', error);
      return jsonResponse({ error: 'Upload failed', details: String(error) }, 500);
    }
  });

  router.get('/media/:key+', async (request: RouterRequest, env: Env) => {
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
