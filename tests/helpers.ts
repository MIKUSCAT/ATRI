import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import type { TestContext } from 'node:test';
import { Store, type Peer, type ReplyPart } from '@atri/db';
import { Runtime, type RuntimeConfig, type Sticker } from '@atri/core';
import type { Model, Completion, ModelMessage, ToolDefinition, ToolCall } from '@atri/llm';

const cleanups = new WeakMap<TestContext, (() => void | Promise<void>)[]>();
export function cleanup(t: TestContext, fn: () => void | Promise<void>) {
  let list = cleanups.get(t);
  if (!list) {
    list = [];
    cleanups.set(t, list);
    t.after(async () => {
      for (const close of [...list!].reverse()) await close();
    });
  }
  list.push(fn);
}
export function temporary(t: TestContext) {
  const path = mkdtempSync(join(tmpdir(), 'atri-test-'));
  cleanup(t, () => {
    const absolute = resolve(path),
      root = resolve(tmpdir());
    if (!absolute.startsWith(root + sep + 'atri-test-')) throw new Error('测试清理路径无效');
    rmSync(absolute, { recursive: true, force: true });
  });
  return path;
}
export function completion(body: unknown, calls: ToolCall[] = []): Completion {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    text,
    calls,
    continuation: { role: 'assistant', content: text, calls },
    inputTokens: 20,
    outputTokens: 10,
  };
}
export class FakeModel implements Model {
  calls: { messages: ModelMessage[]; tools: ToolDefinition[] }[] = [];
  constructor(
    public handle: (
      messages: ModelMessage[],
      tools: ToolDefinition[],
      signal?: AbortSignal,
    ) => Promise<Completion> | Completion = () =>
      completion({ messages: ['听见啦。'], memoryUpdates: [] }),
  ) {}
  async complete(
    messages: ModelMessage[],
    tools: ToolDefinition[] = [],
    options: { signal?: AbortSignal } = {},
  ) {
    this.calls.push({ messages: structuredClone(messages), tools: structuredClone(tools) });
    return this.handle(messages, tools, options.signal);
  }
}
export function fixture(
  t: TestContext,
  model = new FakeModel(),
  patch: Partial<RuntimeConfig> = {},
) {
  const directory = temporary(t),
    store = new Store(join(directory, 'atri.db'));
  const root = process.cwd();
  const delivered: { peer: Peer; part: ReplyPart; id: string }[] = [];
  const config: RuntimeConfig = {
    timeZone: 'Asia/Shanghai',
    diaryHour: 3,
    proactiveEnabled: false,
    quietStart: 23,
    quietEnd: 8,
    proactiveAfterHours: 6,
    debounceMs: 0,
    maxConcurrentPeers: 2,
    turnTimeoutMs: 5000,
    contextTokens: 24000,
    ...patch,
  };
  const stickers: Sticker[] = [
    { slug: 'happy', description: '开心', tags: ['开心'], file: 'happy.png' },
  ];
  const runtime = new Runtime({
    store,
    model: () => model,
    prompt: (name) => readFileSync(join(root, 'shared', 'prompts', `${name}.md`), 'utf8'),
    stickers: () => stickers,
    web: {
      search: async () => [
        {
          title: '天气',
          snippet: '今天晴天',
          url: 'https://example.com/weather',
          fetchedAt: '2026-09-13T00:00:00Z',
          publishedAt: null,
        },
      ],
      open: async (url) => ({ url, content: '原文', fetchedAt: new Date().toISOString() }),
    },
    config: () => config,
    timeZone: () => config.timeZone,
    contextTokens: () => config.contextTokens,
    turnTimeoutMs: () => config.turnTimeoutMs,
    transport: {
      send: async (peer, part, id) => {
        delivered.push({ peer, part, id });
      },
    },
  });
  cleanup(t, async () => {
    await runtime.stop();
    store.close();
  });
  store.ensurePeer('p1', 'preview', '同学', '', true);
  return { directory, store, model, runtime, delivered, config };
}
export function userSources(messages: ModelMessage[]): string[] {
  return messages
    .filter((m) => m.role === 'user')
    .flatMap((m) => [...m.content.matchAll(/\[来源 ([^\s|]+) \|/g)].map((v) => v[1]));
}
