import { Env } from '../types';

let cachedSecret: string | null = null;
let cachedKey: CryptoKey | null = null;

function getSigningSecret(env: Env): string {
  return ((env.MEDIA_SIGNING_KEY || env.APP_TOKEN || '') as string).trim();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
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

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedSecret = secret;
  cachedKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return cachedKey;
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64UrlEncode(signature);
}

function extractMediaKeyFromUrl(url: URL): string | null {
  if (!url.pathname.startsWith('/media/')) return null;
  const raw = url.pathname.slice('/media/'.length);
  const key = raw.replace(/^\/+/, '');
  return key ? key : null;
}

function getExistingSignedExp(url: URL): number | null {
  const expRaw = (url.searchParams.get('exp') || '').trim();
  if (!expRaw) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return null;
  return exp;
}

function isExistingSignatureStillValid(url: URL): boolean {
  const sig = (url.searchParams.get('sig') || '').trim();
  if (!sig) return false;
  const exp = getExistingSignedExp(url);
  if (exp == null) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp >= now - 30;
}

async function signMediaUrl(
  rawUrl: string | null | undefined,
  env: Env,
  options: { ttlSeconds: number; maxTtlSeconds: number }
): Promise<string | null> {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  const secret = getSigningSecret(env);
  if (!secret) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const key = extractMediaKeyFromUrl(url);
  if (!key) return trimmed;

  // 已签名且未过期就直接复用，避免重复签名导致 URL 频繁变化
  if (isExistingSignatureStillValid(url)) {
    return url.toString();
  }

  const ttlSeconds = Math.max(30, Math.min(options.maxTtlSeconds, options.ttlSeconds));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmacSha256Base64Url(secret, `${key}\n${exp}`);

  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);
  return url.toString();
}

export async function signMediaUrlForModel(
  rawUrl: string | null | undefined,
  env: Env,
  options?: { ttlSeconds?: number }
): Promise<string | null> {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  const secret = getSigningSecret(env);
  if (!secret) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  // 关键修复：模型侧经常丢 query，改用“路径签名”URL（/media-s/...）
  if (url.pathname.startsWith('/media-s/')) {
    return url.toString();
  }

  const key = extractMediaKeyFromUrl(url);
  if (!key) return trimmed;

  const ttlSeconds = Math.max(30, Math.min(3600, options?.ttlSeconds ?? 600));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmacSha256Base64Url(secret, `${key}\n${exp}`);

  url.pathname = `/media-s/${exp}/${sig}/${key}`;
  url.search = '';
  return url.toString();
}

export async function signMediaUrlForClient(
  rawUrl: string | null | undefined,
  env: Env,
  options?: { ttlSeconds?: number }
): Promise<string | null> {
  // 默认 1 年：尽量不影响聊天历史里的图片展示
  const ttlSeconds = options?.ttlSeconds ?? 31536000;
  // 最长允许到 10 年（防止误配置到离谱的值）
  return signMediaUrl(rawUrl, env, { ttlSeconds, maxTtlSeconds: 315360000 });
}

export async function validateSignedMediaRequest(request: Request, env: Env, objectKey: string): Promise<boolean> {
  const secret = getSigningSecret(env);
  if (!secret) return false;

  const url = new URL(request.url);
  const expRaw = (url.searchParams.get('exp') || '').trim();
  const sig = (url.searchParams.get('sig') || '').trim();
  if (!expRaw || !sig) return false;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return false;

  const now = Math.floor(Date.now() / 1000);
  // 允许少量时钟误差
  if (exp < now - 30) return false;

  const expected = await hmacSha256Base64Url(secret, `${objectKey}\n${exp}`);
  return timingSafeEqual(sig, expected);
}

export async function validateSignedMediaPathParams(
  env: Env,
  objectKey: string,
  expRaw: string,
  sig: string
): Promise<boolean> {
  const secret = getSigningSecret(env);
  if (!secret) return false;

  const expText = String(expRaw || '').trim();
  const providedSig = String(sig || '').trim();
  if (!expText || !providedSig) return false;

  const exp = Number(expText);
  if (!Number.isFinite(exp)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (exp < now - 30) return false;

  const expected = await hmacSha256Base64Url(secret, `${objectKey}\n${exp}`);
  return timingSafeEqual(providedSig, expected);
}
