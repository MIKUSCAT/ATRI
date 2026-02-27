import defaultPrompts from '../config/prompts.json';
import { CHAT_MODEL, Env } from '../types';

type RuntimeConfigPublic = {
  chatApiFormat?: string;
  openaiApiUrl?: string;
  embeddingsApiUrl?: string;
  embeddingsModel?: string;
  diaryApiUrl?: string;
  diaryApiFormat?: string;
  diaryModel?: string;
  defaultChatModel?: string;

  agentTemperature?: number;
  agentMaxTokens?: number;
  diaryTemperature?: number;
  diaryMaxTokens?: number;
  profileTemperature?: number;

  proactiveEnabled?: boolean | string | number;
  proactiveIntervalMinutes?: number;
  proactiveTimeZone?: string;
  proactiveQuietStartHour?: number;
  proactiveQuietEndHour?: number;
  proactiveMaxDaily?: number;
  proactiveCooldownHours?: number;
  proactiveIntimacyThreshold?: number;
  proactiveRecentActiveMinutes?: number;
  proactiveNotificationChannel?: string;
  proactiveNotificationTarget?: string;
};

type RuntimeConfigSecrets = {
  openaiApiKey?: string;
  embeddingsApiKey?: string;
  diaryApiKey?: string;
  tavilyApiKey?: string;
};

export type EffectiveRuntimeSettings = {
  updatedAt: number | null;
  chatApiFormat: 'openai' | 'anthropic' | 'gemini';
  diaryApiFormat: 'openai' | 'anthropic' | 'gemini';
  openaiApiUrl: string;
  openaiApiKey: string;
  embeddingsApiUrl: string;
  embeddingsApiKey: string;
  embeddingsModel: string;
  diaryApiUrl?: string;
  diaryApiKey?: string;
  diaryModel?: string;
  tavilyApiKey?: string;
  defaultChatModel: string;

  agentTemperature: number;
  agentMaxTokens: number;
  agentTimeoutMs: number;
  diaryTemperature: number;
  diaryMaxTokens: number;
  profileTemperature: number;

  proactiveEnabled: boolean;
  proactiveIntervalMinutes: number;
  proactiveTimeZone: string;
  proactiveQuietStartHour: number;
  proactiveQuietEndHour: number;
  proactiveMaxDaily: number;
  proactiveCooldownHours: number;
  proactiveIntimacyThreshold: number;
  proactiveRecentActiveMinutes: number;
  proactiveNotificationChannel: 'none' | 'email' | 'wechat_work';
  proactiveNotificationTarget?: string;

  prompts: any;
};

export type StoredRuntimeConfigView = {
  updatedAt: number | null;
  config: RuntimeConfigPublic;
  secrets: {
    openaiApiKey: boolean | null;
    embeddingsApiKey: boolean | null;
    diaryApiKey: boolean | null;
    tavilyApiKey: boolean | null;
  };
  encryption: { configured: boolean; canDecryptStoredSecrets: boolean };
};

export type StoredPromptsView = {
  updatedAt: number | null;
  hasOverride: boolean;
  effective: any;
  override: any | null;
};

let adminTablesEnsured = false;
let ensuringTables: Promise<void> | null = null;

let cachedEffective: { at: number; value: EffectiveRuntimeSettings } | null = null;
let inflightEffective: Promise<EffectiveRuntimeSettings> | null = null;

let cachedStoredConfig: { at: number; value: StoredRuntimeConfigView } | null = null;
let inflightStoredConfig: Promise<StoredRuntimeConfigView> | null = null;

let cachedStoredPrompts: { at: number; value: StoredPromptsView } | null = null;
let inflightStoredPrompts: Promise<StoredPromptsView> | null = null;

const CACHE_TTL_MS = 1500;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const DEFAULTS = {
  agentTemperature: 1.0,
  agentMaxTokens: 4096,
  agentTimeoutMs: 300000,
  diaryTemperature: 0.7,
  diaryMaxTokens: 4096,
  profileTemperature: 0.2,
  proactiveEnabled: false,
  proactiveIntervalMinutes: 60,
  proactiveTimeZone: 'Asia/Shanghai',
  proactiveQuietStartHour: 23,
  proactiveQuietEndHour: 7,
  proactiveMaxDaily: 2,
  proactiveCooldownHours: 6,
  proactiveIntimacyThreshold: 10,
  proactiveRecentActiveMinutes: 60,
  proactiveNotificationChannel: 'none' as const
};

const RUNTIME_CONFIG_KEYS: Array<keyof RuntimeConfigPublic> = [
  'chatApiFormat',
  'openaiApiUrl',
  'embeddingsApiUrl',
  'embeddingsModel',
  'diaryApiUrl',
  'diaryApiFormat',
  'diaryModel',
  'defaultChatModel',
  'agentTemperature',
  'agentMaxTokens',
  'diaryTemperature',
  'diaryMaxTokens',
  'profileTemperature',
  'proactiveEnabled',
  'proactiveIntervalMinutes',
  'proactiveTimeZone',
  'proactiveQuietStartHour',
  'proactiveQuietEndHour',
  'proactiveMaxDaily',
  'proactiveCooldownHours',
  'proactiveIntimacyThreshold',
  'proactiveRecentActiveMinutes',
  'proactiveNotificationChannel',
  'proactiveNotificationTarget'
];

function normalizeApiFormat(value: unknown): 'openai' | 'anthropic' | 'gemini' | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return null;
  if (text === 'openai') return 'openai';
  if (text === 'anthropic') return 'anthropic';
  if (text === 'gemini') return 'gemini';
  return null;
}

function normalizeOptionalText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (!text) return undefined;
    if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  }
  return undefined;
}

function normalizeProactiveChannel(value: unknown): 'none' | 'email' | 'wechat_work' | undefined {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return undefined;
  if (text === 'email') return 'email';
  if (text === 'wechat_work') return 'wechat_work';
  if (text === 'none') return 'none';
  return undefined;
}

function normalizeTimeZone(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: text }).format(new Date());
    return text;
  } catch {
    return fallback;
  }
}

function validateProactiveConfig(config: RuntimeConfigPublic) {
  const channel = normalizeProactiveChannel(config.proactiveNotificationChannel) || 'none';
  const target = normalizeOptionalText(config.proactiveNotificationTarget);
  if ((channel === 'email' || channel === 'wechat_work') && !target) {
    throw new Error('proactive_target_required');
  }
  if (channel === 'email' && target) {
    const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target);
    if (!isEmail) {
      throw new Error('proactive_email_target_invalid');
    }
  }
  if (channel === 'wechat_work' && target) {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new Error('proactive_wechat_target_invalid');
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'qyapi.weixin.qq.com') {
      throw new Error('proactive_wechat_target_invalid');
    }
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sanitizeRuntimeConfig(input: unknown): RuntimeConfigPublic {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out: RuntimeConfigPublic = {};
  for (const key of RUNTIME_CONFIG_KEYS) {
    if (key in raw) {
      (out as any)[key] = raw[key];
    }
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isHex64(raw: string) {
  return /^[0-9a-fA-F]{64}$/.test(raw);
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function deriveAes256Key(secret: string): Promise<Uint8Array | null> {
  const raw = String(secret || '').trim();
  if (!raw) return null;

  if (isHex64(raw)) {
    return hexToBytes(raw);
  }

  try {
    const decoded = base64ToBytes(raw.replace(/\s+/g, ''));
    if (decoded.length === 32) return decoded;
  } catch {
    // ignore
  }

  const digest = await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(raw));
  return new Uint8Array(digest);
}

async function importAesGcmKey(key: Uint8Array) {
  return crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptJson(key: Uint8Array, payload: unknown) {
  const cryptoKey = await importAesGcmKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = TEXT_ENCODER.encode(JSON.stringify(payload ?? {}));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, plaintext)
  );
  if (encrypted.length < 16) {
    throw new Error('encrypt_failed');
  }
  const ciphertext = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);

  return {
    ciphertextB64: bytesToBase64(ciphertext),
    ivB64: bytesToBase64(iv),
    tagB64: bytesToBase64(tag)
  };
}

async function decryptJson(key: Uint8Array, ciphertextB64: string, ivB64: string, tagB64: string): Promise<any> {
  const cryptoKey = await importAesGcmKey(key);
  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(ciphertextB64);
  const tag = base64ToBytes(tagB64);

  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    combined
  );
  return safeJsonParse(TEXT_DECODER.decode(new Uint8Array(plaintext))) ?? {};
}

async function ensureAdminTables(env: Env) {
  if (adminTablesEnsured) return;
  if (ensuringTables) return ensuringTables;

  ensuringTables = (async () => {
    await env.ATRI_DB.prepare(
      `CREATE TABLE IF NOT EXISTS admin_runtime_config (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        secrets_ciphertext TEXT,
        secrets_iv TEXT,
        secrets_tag TEXT,
        updated_at INTEGER NOT NULL
      )`
    ).run();

    await env.ATRI_DB.prepare(
      `CREATE TABLE IF NOT EXISTS admin_prompts_override (
        id TEXT PRIMARY KEY,
        prompts_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ).run();

    adminTablesEnsured = true;
  })().finally(() => {
    ensuringTables = null;
  });

  return ensuringTables;
}

export function invalidateRuntimeSettingsCache() {
  cachedEffective = null;
  inflightEffective = null;
  cachedStoredConfig = null;
  inflightStoredConfig = null;
  cachedStoredPrompts = null;
  inflightStoredPrompts = null;
}

async function loadStoredConfig(env: Env) {
  await ensureAdminTables(env);

  const row = await env.ATRI_DB.prepare(
    `SELECT config_json,
            secrets_ciphertext,
            secrets_iv,
            secrets_tag,
            updated_at
       FROM admin_runtime_config
      WHERE id = 'global'
      LIMIT 1`
  ).first<{
    config_json?: string;
    secrets_ciphertext?: string;
    secrets_iv?: string;
    secrets_tag?: string;
    updated_at?: number;
  }>();

  const configJson = typeof row?.config_json === 'string' ? row.config_json : '{}';
  const config = sanitizeRuntimeConfig(safeJsonParse(configJson) ?? {});
  const updatedAt = Number.isFinite(Number(row?.updated_at)) ? Number(row?.updated_at) : null;

  const secretsCipher = typeof row?.secrets_ciphertext === 'string' ? row.secrets_ciphertext : '';
  const secretsIv = typeof row?.secrets_iv === 'string' ? row.secrets_iv : '';
  const secretsTag = typeof row?.secrets_tag === 'string' ? row.secrets_tag : '';

  return {
    updatedAt,
    config,
    encryptedSecrets: secretsCipher && secretsIv && secretsTag
      ? { secretsCipher, secretsIv, secretsTag }
      : null
  };
}

async function loadStoredPromptsOverride(env: Env) {
  await ensureAdminTables(env);

  const row = await env.ATRI_DB.prepare(
    `SELECT prompts_json, updated_at
       FROM admin_prompts_override
      WHERE id = 'global'
      LIMIT 1`
  ).first<{ prompts_json?: string; updated_at?: number }>();

  const promptsJson = typeof row?.prompts_json === 'string' ? row.prompts_json : '';
  const updatedAt = Number.isFinite(Number(row?.updated_at)) ? Number(row?.updated_at) : null;
  const parsed = promptsJson ? safeJsonParse(promptsJson) : null;

  return {
    updatedAt,
    override: parsed && typeof parsed === 'object' ? parsed : null
  };
}

function mergePrompts(base: any, override: any | null) {
  if (!override || typeof override !== 'object') return base;
  const merged = JSON.parse(JSON.stringify(base));

  for (const key of ['agent', 'diary', 'profile', 'proactive']) {
    const src = (override as any)[key];
    if (!src || typeof src !== 'object') continue;

    merged[key] = merged[key] && typeof merged[key] === 'object' ? merged[key] : {};
    for (const subKey of Object.keys(src)) {
      const val = (src as any)[subKey];
      if (typeof val === 'string') {
        (merged as any)[key][subKey] = val;
      }
    }
  }

  return merged;
}

function resolveEffectiveSettings(
  env: Env,
  stored: { updatedAt: number | null; config: RuntimeConfigPublic; secrets: RuntimeConfigSecrets },
  promptsOverride: any | null
): EffectiveRuntimeSettings {
  const c = stored.config || {};
  const s = stored.secrets || {};

  const chatApiFormat = normalizeApiFormat(c.chatApiFormat) ?? 'openai';
  const diaryApiFormat = normalizeApiFormat(c.diaryApiFormat) ?? chatApiFormat;

  const openaiApiUrl = String(c.openaiApiUrl ?? env.OPENAI_API_URL ?? '').trim();
  const openaiApiKey = String(s.openaiApiKey ?? env.OPENAI_API_KEY ?? '').trim();

  const embeddingsApiUrl = String(c.embeddingsApiUrl ?? env.EMBEDDINGS_API_URL ?? '').trim();
  const embeddingsApiKey = String(s.embeddingsApiKey ?? env.EMBEDDINGS_API_KEY ?? '').trim();
  const embeddingsModel = String(c.embeddingsModel ?? env.EMBEDDINGS_MODEL ?? '').trim();

  const diaryApiUrl = normalizeOptionalText(c.diaryApiUrl ?? env.DIARY_API_URL);
  const diaryApiKey = normalizeOptionalText(s.diaryApiKey ?? env.DIARY_API_KEY);
  const diaryModel = normalizeOptionalText(c.diaryModel ?? env.DIARY_MODEL);

  const tavilyApiKey = normalizeOptionalText(s.tavilyApiKey ?? env.TAVILY_API_KEY);

  const defaultChatModel = String(c.defaultChatModel || '').trim() || CHAT_MODEL;

  const agentTemperature = clampNumber(
    normalizeOptionalNumber(c.agentTemperature) ?? DEFAULTS.agentTemperature,
    0,
    2
  );
  const agentMaxTokens = Math.trunc(
    clampNumber(normalizeOptionalNumber(c.agentMaxTokens) ?? DEFAULTS.agentMaxTokens, 64, 8192)
  );

  const agentTimeoutMs = Math.trunc(
    clampNumber(
      normalizeOptionalNumber((c as any).agentTimeoutMs ?? env.AGENT_TIMEOUT_MS) ?? DEFAULTS.agentTimeoutMs,
      10000,
      600000
    )
  );

  const diaryTemperature = clampNumber(
    normalizeOptionalNumber(c.diaryTemperature) ?? DEFAULTS.diaryTemperature,
    0,
    2
  );
  const diaryMaxTokens = Math.trunc(
    clampNumber(normalizeOptionalNumber(c.diaryMaxTokens) ?? DEFAULTS.diaryMaxTokens, 64, 8192)
  );

  const profileTemperature = clampNumber(
    normalizeOptionalNumber(c.profileTemperature) ?? DEFAULTS.profileTemperature,
    0,
    2
  );

  const proactiveEnabled =
    normalizeOptionalBoolean(env.PROACTIVE_ENABLED)
    ?? normalizeOptionalBoolean(c.proactiveEnabled)
    ?? DEFAULTS.proactiveEnabled;
  const proactiveIntervalMinutes = Math.trunc(
    clampNumber(
      normalizeOptionalNumber(env.PROACTIVE_INTERVAL_MINUTES)
      ?? normalizeOptionalNumber(c.proactiveIntervalMinutes)
      ?? DEFAULTS.proactiveIntervalMinutes,
      5,
      720
    )
  );
  const proactiveTimeZone = normalizeTimeZone(
    normalizeOptionalText(env.PROACTIVE_TIME_ZONE) ?? c.proactiveTimeZone,
    DEFAULTS.proactiveTimeZone
  );
  const proactiveQuietStartHour = Math.trunc(
    clampNumber(
      normalizeOptionalNumber(env.PROACTIVE_QUIET_START_HOUR)
      ?? normalizeOptionalNumber(c.proactiveQuietStartHour)
      ?? DEFAULTS.proactiveQuietStartHour,
      0,
      23
    )
  );
  const proactiveQuietEndHour = Math.trunc(
    clampNumber(
      normalizeOptionalNumber(env.PROACTIVE_QUIET_END_HOUR)
      ?? normalizeOptionalNumber(c.proactiveQuietEndHour)
      ?? DEFAULTS.proactiveQuietEndHour,
      0,
      23
    )
  );
  const proactiveMaxDaily = Math.trunc(
    clampNumber(
      normalizeOptionalNumber(env.PROACTIVE_MAX_DAILY)
      ?? normalizeOptionalNumber(c.proactiveMaxDaily)
      ?? DEFAULTS.proactiveMaxDaily,
      0,
      20
    )
  );
  const proactiveCooldownHours = Math.trunc(
    clampNumber(
      normalizeOptionalNumber(env.PROACTIVE_COOLDOWN_HOURS)
      ?? normalizeOptionalNumber(c.proactiveCooldownHours)
      ?? DEFAULTS.proactiveCooldownHours,
      0,
      168
    )
  );
  const proactiveIntimacyThreshold = Math.trunc(
    clampNumber(
      normalizeOptionalNumber(env.PROACTIVE_INTIMACY_THRESHOLD)
      ?? normalizeOptionalNumber(c.proactiveIntimacyThreshold)
      ?? DEFAULTS.proactiveIntimacyThreshold,
      -100,
      100
    )
  );
  const proactiveRecentActiveMinutes = Math.trunc(
    clampNumber(
      normalizeOptionalNumber(env.PROACTIVE_RECENT_ACTIVE_MINUTES)
      ?? normalizeOptionalNumber(c.proactiveRecentActiveMinutes)
      ?? DEFAULTS.proactiveRecentActiveMinutes,
      1,
      1440
    )
  );
  const proactiveNotificationChannel =
    normalizeProactiveChannel(env.PROACTIVE_NOTIFICATION_CHANNEL)
    ?? normalizeProactiveChannel(c.proactiveNotificationChannel)
    ?? DEFAULTS.proactiveNotificationChannel;
  const proactiveNotificationTarget =
    normalizeOptionalText(env.PROACTIVE_NOTIFICATION_TARGET)
    ?? normalizeOptionalText(c.proactiveNotificationTarget);

  const prompts = mergePrompts(defaultPrompts as any, promptsOverride);

  return {
    updatedAt: stored.updatedAt,
    chatApiFormat,
    diaryApiFormat,
    openaiApiUrl,
    openaiApiKey,
    embeddingsApiUrl,
    embeddingsApiKey,
    embeddingsModel,
    diaryApiUrl,
    diaryApiKey,
    diaryModel,
    tavilyApiKey,
    defaultChatModel,
    agentTemperature,
    agentMaxTokens,
    agentTimeoutMs,
    diaryTemperature,
    diaryMaxTokens,
    profileTemperature,
    proactiveEnabled,
    proactiveIntervalMinutes,
    proactiveTimeZone,
    proactiveQuietStartHour,
    proactiveQuietEndHour,
    proactiveMaxDaily,
    proactiveCooldownHours,
    proactiveIntimacyThreshold,
    proactiveRecentActiveMinutes,
    proactiveNotificationChannel,
    proactiveNotificationTarget,
    prompts
  };
}

export async function getEffectiveRuntimeSettings(env: Env): Promise<EffectiveRuntimeSettings> {
  const now = Date.now();
  if (cachedEffective && now - cachedEffective.at < CACHE_TTL_MS) {
    return cachedEffective.value;
  }
  if (inflightEffective) return inflightEffective;

  inflightEffective = (async () => {
    const [storedConfig, storedPrompts] = await Promise.all([
      loadStoredConfig(env),
      loadStoredPromptsOverride(env)
    ]);

    const key = await deriveAes256Key(String(env.ADMIN_CONFIG_ENCRYPTION_KEY || ''));
    let secrets: RuntimeConfigSecrets = {};
    if (storedConfig.encryptedSecrets && key) {
      try {
        const parsed = await decryptJson(
          key,
          storedConfig.encryptedSecrets.secretsCipher,
          storedConfig.encryptedSecrets.secretsIv,
          storedConfig.encryptedSecrets.secretsTag
        );
        if (parsed && typeof parsed === 'object') {
          secrets = parsed as RuntimeConfigSecrets;
        }
      } catch {
        secrets = {};
      }
    }

    const effective = resolveEffectiveSettings(
      env,
      { updatedAt: storedConfig.updatedAt, config: storedConfig.config, secrets },
      storedPrompts.override
    );

    cachedEffective = { at: Date.now(), value: effective };
    return effective;
  })().finally(() => {
    inflightEffective = null;
  });

  return inflightEffective;
}

export async function getStoredRuntimeConfigView(env: Env): Promise<StoredRuntimeConfigView> {
  const now = Date.now();
  if (cachedStoredConfig && now - cachedStoredConfig.at < CACHE_TTL_MS) {
    return cachedStoredConfig.value;
  }
  if (inflightStoredConfig) return inflightStoredConfig;

  inflightStoredConfig = (async () => {
    const stored = await loadStoredConfig(env);
    const key = await deriveAes256Key(String(env.ADMIN_CONFIG_ENCRYPTION_KEY || ''));

    let secrets: RuntimeConfigSecrets = {};
    let canDecryptStoredSecrets = false;
    if (stored.encryptedSecrets && key) {
      try {
        const parsed = await decryptJson(
          key,
          stored.encryptedSecrets.secretsCipher,
          stored.encryptedSecrets.secretsIv,
          stored.encryptedSecrets.secretsTag
        );
        if (parsed && typeof parsed === 'object') {
          secrets = parsed as RuntimeConfigSecrets;
        }
        canDecryptStoredSecrets = true;
      } catch {
        canDecryptStoredSecrets = false;
      }
    } else if (!stored.encryptedSecrets) {
      canDecryptStoredSecrets = true;
    }

    const view: StoredRuntimeConfigView = {
      updatedAt: stored.updatedAt,
      config: stored.config || {},
      secrets: {
        openaiApiKey: key ? Boolean(String(secrets.openaiApiKey || '').trim()) : stored.encryptedSecrets ? null : false,
        embeddingsApiKey: key ? Boolean(String(secrets.embeddingsApiKey || '').trim()) : stored.encryptedSecrets ? null : false,
        diaryApiKey: key ? Boolean(String(secrets.diaryApiKey || '').trim()) : stored.encryptedSecrets ? null : false,
        tavilyApiKey: key ? Boolean(String(secrets.tavilyApiKey || '').trim()) : stored.encryptedSecrets ? null : false
      },
      encryption: { configured: Boolean(key), canDecryptStoredSecrets }
    };

    cachedStoredConfig = { at: Date.now(), value: view };
    return view;
  })().finally(() => {
    inflightStoredConfig = null;
  });

  return inflightStoredConfig;
}

export async function updateRuntimeConfig(
  env: Env,
  update: { config?: Record<string, unknown>; secrets?: Record<string, unknown> }
) {
  await ensureAdminTables(env);

  const stored = await loadStoredConfig(env);
  const existingConfig: RuntimeConfigPublic = stored.config && typeof stored.config === 'object' ? stored.config : {};

  const key = await deriveAes256Key(String(env.ADMIN_CONFIG_ENCRYPTION_KEY || ''));
  const requestedSecrets = update.secrets && typeof update.secrets === 'object' ? update.secrets : {};

  const wantsSecretsChange = Object.keys(requestedSecrets).length > 0;
  if (wantsSecretsChange && !key) {
    throw new Error('ADMIN_CONFIG_ENCRYPTION_KEY is missing');
  }

  let existingSecrets: RuntimeConfigSecrets = {};
  if (stored.encryptedSecrets && key) {
    try {
      const parsed = await decryptJson(
        key,
        stored.encryptedSecrets.secretsCipher,
        stored.encryptedSecrets.secretsIv,
        stored.encryptedSecrets.secretsTag
      );
      if (parsed && typeof parsed === 'object') {
        existingSecrets = parsed as RuntimeConfigSecrets;
      }
    } catch {
      existingSecrets = {};
    }
  }

  const incomingConfig = update.config && typeof update.config === 'object' ? update.config : {};
  const mergedConfig: RuntimeConfigPublic = { ...existingConfig };

  for (const keyName of RUNTIME_CONFIG_KEYS) {
    if (!(keyName in incomingConfig)) continue;
    const raw = (incomingConfig as any)[keyName];
    if (raw === null) {
      delete (mergedConfig as any)[keyName];
      continue;
    }
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (!t) {
        delete (mergedConfig as any)[keyName];
      } else {
        (mergedConfig as any)[keyName] = t;
      }
      continue;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      (mergedConfig as any)[keyName] = raw;
      continue;
    }
    if (typeof raw === 'boolean') {
      (mergedConfig as any)[keyName] = raw;
      continue;
    }
  }

  const mergedSecrets: RuntimeConfigSecrets = { ...existingSecrets };
  const secretKeys: Array<keyof RuntimeConfigSecrets> = [
    'openaiApiKey',
    'embeddingsApiKey',
    'diaryApiKey',
    'tavilyApiKey'
  ];

  for (const keyName of secretKeys) {
    if (!(keyName in requestedSecrets)) continue;
    const raw = (requestedSecrets as any)[keyName];
    if (raw === null) {
      delete (mergedSecrets as any)[keyName];
      continue;
    }
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (!t) {
        delete (mergedSecrets as any)[keyName];
      } else {
        (mergedSecrets as any)[keyName] = t;
      }
    }
  }

  validateProactiveConfig(mergedConfig);

  const now = Date.now();
  const configJson = JSON.stringify(mergedConfig);

  let enc: { ciphertextB64: string; ivB64: string; tagB64: string } | null = null;
  if (key && Object.keys(mergedSecrets).length > 0) {
    enc = await encryptJson(key, mergedSecrets);
  }

  await env.ATRI_DB.prepare(
    `INSERT INTO admin_runtime_config (id, config_json, secrets_ciphertext, secrets_iv, secrets_tag, updated_at)
     VALUES ('global', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       config_json = excluded.config_json,
       secrets_ciphertext = excluded.secrets_ciphertext,
       secrets_iv = excluded.secrets_iv,
       secrets_tag = excluded.secrets_tag,
       updated_at = excluded.updated_at`
  )
    .bind(configJson, enc?.ciphertextB64 ?? null, enc?.ivB64 ?? null, enc?.tagB64 ?? null, now)
    .run();

  invalidateRuntimeSettingsCache();
  return { ok: true, updatedAt: now };
}

export async function resetRuntimeConfig(env: Env) {
  await ensureAdminTables(env);
  await env.ATRI_DB.prepare(`DELETE FROM admin_runtime_config WHERE id = 'global'`).run();
  invalidateRuntimeSettingsCache();
  return { ok: true };
}

function normalizePromptsForSave(input: any) {
  const required = [
    ['agent', 'system'],
    ['diary', 'system'],
    ['diary', 'userTemplate'],
    ['profile', 'system'],
    ['profile', 'userTemplate']
  ] as const;

  const out: any = {};
  for (const [group, key] of required) {
    const val = input?.[group]?.[key];
    if (typeof val !== 'string') {
      throw new Error(`prompt_missing:${group}.${key}`);
    }
    const text = val;
    if (!text.trim()) {
      throw new Error(`prompt_empty:${group}.${key}`);
    }
    out[group] = out[group] || {};
    out[group][key] = text;
  }

  const proactiveSystem = input?.proactive?.system;
  if (typeof proactiveSystem === 'string' && proactiveSystem.trim()) {
    out.proactive = { system: proactiveSystem };
  }

  return out;
}

export async function getStoredPromptsView(env: Env): Promise<StoredPromptsView> {
  const now = Date.now();
  if (cachedStoredPrompts && now - cachedStoredPrompts.at < CACHE_TTL_MS) {
    return cachedStoredPrompts.value;
  }
  if (inflightStoredPrompts) return inflightStoredPrompts;

  inflightStoredPrompts = (async () => {
    const stored = await loadStoredPromptsOverride(env);
    const effective = mergePrompts(defaultPrompts as any, stored.override);
    const view: StoredPromptsView = {
      updatedAt: stored.updatedAt,
      hasOverride: Boolean(stored.override),
      effective,
      override: stored.override
    };
    cachedStoredPrompts = { at: Date.now(), value: view };
    return view;
  })().finally(() => {
    inflightStoredPrompts = null;
  });

  return inflightStoredPrompts;
}

export async function updatePromptsOverride(env: Env, payload: any) {
  await ensureAdminTables(env);
  const normalized = normalizePromptsForSave(payload);
  const now = Date.now();

  await env.ATRI_DB.prepare(
    `INSERT INTO admin_prompts_override (id, prompts_json, updated_at)
     VALUES ('global', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       prompts_json = excluded.prompts_json,
       updated_at = excluded.updated_at`
  )
    .bind(JSON.stringify(normalized), now)
    .run();

  invalidateRuntimeSettingsCache();
  return { ok: true, updatedAt: now };
}

export async function resetPromptsOverride(env: Env) {
  await ensureAdminTables(env);
  await env.ATRI_DB.prepare(`DELETE FROM admin_prompts_override WHERE id = 'global'`).run();
  invalidateRuntimeSettingsCache();
  return { ok: true };
}
