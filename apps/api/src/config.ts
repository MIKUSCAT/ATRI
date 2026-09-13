import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Store } from '@atri/db';
import type { ModelConfig, ApiFormat } from '@atri/llm';
import type { RuntimeConfig, PromptName } from '@atri/core';

export interface SavedConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  format: ApiFormat;
  vision: boolean;
  tavilyKey: string;
  timeZone: string;
  diaryHour: number;
  proactiveEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  proactiveAfterHours: number;
  contextWindowTokens: number;
  inputBudgetTokens: number;
  maxOutputTokens: number;
  requestTimeoutSeconds: number;
  turnTimeoutSeconds: number;
  temperature: number | null;
}
export class Settings {
  readonly dataDir: string;
  readonly adminPassword: string;
  readonly host: string;
  readonly port: number;
  readonly secureCookie: boolean;
  constructor(
    readonly store: Store,
    readonly root: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.dataDir = resolve(env.DATA_DIR || join(root, 'data'));
    mkdirSync(this.dataDir, { recursive: true });
    this.host = env.HOST || '127.0.0.1';
    this.port = Number(env.PORT || 3000);
    this.secureCookie = env.COOKIE_SECURE === 'true';
    const passwordFile = join(this.dataDir, 'admin-secret.txt');
    if (env.ADMIN_PASSWORD) this.adminPassword = env.ADMIN_PASSWORD;
    else if (existsSync(passwordFile))
      this.adminPassword = readFileSync(passwordFile, 'utf8').trim();
    else {
      this.adminPassword = randomBytes(24).toString('base64url');
      writeFileSync(passwordFile, this.adminPassword + '\n', { mode: 0o600, flag: 'wx' });
    }
    if (this.adminPassword.length < 12) throw new Error('ADMIN_PASSWORD 至少需要 12 个字符');
  }
  config(): SavedConfig {
    const env = this.env;
    const defaults: SavedConfig = {
      baseUrl: env.LLM_BASE_URL || 'https://api.deepseek.com',
      apiKey: env.LLM_API_KEY || '',
      model: env.LLM_MODEL || 'deepseek-chat',
      format: (env.LLM_FORMAT || 'openai') as ApiFormat,
      vision: env.LLM_VISION === 'true',
      tavilyKey: env.TAVILY_API_KEY || '',
      timeZone: env.TZ || 'Asia/Shanghai',
      diaryHour: 3,
      proactiveEnabled: false,
      quietStart: 23,
      quietEnd: 8,
      proactiveAfterHours: 6,
      contextWindowTokens: 65536,
      inputBudgetTokens: 24000,
      maxOutputTokens: 3000,
      requestTimeoutSeconds: 45,
      turnTimeoutSeconds: 90,
      temperature: null,
    };
    return { ...defaults, ...this.store.getSetting<Partial<SavedConfig>>('config', {}) };
  }
  publicConfig() {
    const { apiKey, tavilyKey, ...rest } = this.config();
    return { ...rest, hasApiKey: !!apiKey, hasTavilyKey: !!tavilyKey };
  }
  update(input: Record<string, unknown>) {
    const next = { ...this.config() };
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('设置格式无效');
    for (const field of ['baseUrl', 'model', 'timeZone'] as const)
      if (typeof input[field] === 'string') next[field] = input[field].trim();
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) next.apiKey = input.apiKey.trim();
    if (typeof input.tavilyKey === 'string' && input.tavilyKey.trim())
      next.tavilyKey = input.tavilyKey.trim();
    if (input.clearApiKey === true) next.apiKey = '';
    if (input.clearTavilyKey === true) next.tavilyKey = '';
    if (input.format !== undefined) {
      if (!['openai', 'anthropic', 'gemini'].includes(String(input.format)))
        throw new Error('模型接口格式无效');
      next.format = input.format as ApiFormat;
    }
    for (const key of ['vision', 'proactiveEnabled'] as const)
      if (input[key] !== undefined) {
        if (typeof input[key] !== 'boolean') throw new Error('开关格式无效');
        next[key] = input[key];
      }
    for (const key of ['diaryHour', 'quietStart', 'quietEnd', 'proactiveAfterHours'] as const)
      if (input[key] !== undefined) {
        const n = Number(input[key]);
        if (!Number.isInteger(n) || n < 0 || n > (key === 'proactiveAfterHours' ? 168 : 23))
          throw new Error('时间设置无效');
        next[key] = n;
      }
    const url = new URL(next.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('模型地址需要是没有凭据和查询参数的 HTTP/HTTPS URL');
    if (!next.model || next.model.length > 150) throw new Error('模型名称无效');
    const limits = {
      contextWindowTokens: [8192, 2000000, '模型上下文窗口'],
      inputBudgetTokens: [4096, 1000000, '输入预算'],
      maxOutputTokens: [256, 131072, '输出上限'],
      requestTimeoutSeconds: [10, 300, '单次请求超时'],
      turnTimeoutSeconds: [10, 600, '整轮处理超时'],
    } as const;
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      if (input[key] === undefined) continue;
      const value = input[key],
        [min, max, label] = limits[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
        throw new Error(`${label}需要 ${min}–${max} 之间的整数`);
      next[key] = value;
    }
    if (input.temperature !== undefined) {
      if (
        input.temperature !== null &&
        (typeof input.temperature !== 'number' ||
          !Number.isFinite(input.temperature) ||
          input.temperature < 0 ||
          input.temperature > 2)
      )
        throw new Error('温度需要留空或填写 0–2 之间的数值');
      next.temperature = input.temperature as number | null;
    }
    if (next.format === 'anthropic' && next.temperature !== null && next.temperature > 1)
      throw new Error('Anthropic 的温度请设为 0–1，或留空使用模型默认值');
    if (next.inputBudgetTokens + next.maxOutputTokens + 1024 > next.contextWindowTokens)
      throw new Error('输入预算 + 输出上限 + 1024 token 余量不能超过模型上下文窗口');
    if (next.turnTimeoutSeconds < next.requestTimeoutSeconds)
      throw new Error('整轮处理超时不能短于单次请求超时');
    new Intl.DateTimeFormat('zh-CN', { timeZone: next.timeZone }).format();
    this.store.setSetting('config', next);
    return this.publicConfig();
  }
  model(): ModelConfig {
    const c = this.config();
    return {
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      model: c.model,
      format: c.format,
      vision: c.vision,
      maxTokens: c.maxOutputTokens,
      timeoutMs: c.requestTimeoutSeconds * 1000,
      contextWindowTokens: c.contextWindowTokens,
      inputBudgetTokens: c.inputBudgetTokens,
      ...(c.temperature !== null ? { temperature: c.temperature } : {}),
    };
  }
  runtime(): RuntimeConfig {
    const c = this.config();
    return {
      ...c,
      contextTokens: c.inputBudgetTokens,
      turnTimeoutMs: c.turnTimeoutSeconds * 1000,
      debounceMs: 800,
      maxConcurrentPeers: 3,
    };
  }
  prompt(name: PromptName): string {
    return this.store.getSetting<string>(
      `prompt:${name}`,
      readFileSync(join(this.root, 'shared', 'prompts', `${name}.md`), 'utf8'),
    );
  }
  savePersona(text: string) {
    if (!text.trim() || text.length > 12000) throw new Error('人设需要 1–12000 个字符');
    this.store.setSetting('prompt:persona', text);
  }
  allowedPeers() {
    return new Set(
      (this.env.WECHAT_ALLOWED_PEERS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  ilinkBase() {
    return this.env.ILINK_BASE_URL || 'https://ilinkai.weixin.qq.com';
  }
}
