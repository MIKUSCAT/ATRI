import { Env } from '../types';
import { jsonResponse } from './json-response';

/**
 * 时序安全的字符串比较，防止时序攻击
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // 长度不同时仍需要执行完整比较以防止时序泄露
    const dummyA = a.padEnd(Math.max(a.length, b.length), '\0');
    const dummyB = b.padEnd(Math.max(a.length, b.length), '\0');
    let result = 0;
    for (let i = 0; i < dummyA.length; i++) {
      result |= dummyA.charCodeAt(i) ^ dummyB.charCodeAt(i);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function requireAppToken(request: Request, env: Env) {
  const expected = (env.APP_TOKEN || '').trim();
  if (!expected) {
    return jsonResponse({ error: 'app_token_missing' }, 503);
  }
  const provided = (request.headers.get('X-App-Token') || request.headers.get('x-app-token') || '').trim();

  // 使用时序安全比较防止时序攻击
  if (!timingSafeEqual(provided, expected)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  return null;
}
