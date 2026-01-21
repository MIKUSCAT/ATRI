import type { FastifyRequest } from 'fastify';
import { Env } from '../runtime/types';

export function timingSafeEqual(a: string, b: string): boolean {
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

export function requireAppToken(request: FastifyRequest, env: Env) {
  const expected = String(env.APP_TOKEN || '').trim();
  if (!expected) {
    return { status: 503, body: { error: 'app_token_missing' } };
  }
  const provided = String(request.headers['x-app-token'] || '').trim();
  if (!timingSafeEqual(provided, expected)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  return null;
}
