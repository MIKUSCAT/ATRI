import type { Message, Store, Task, SearchHit, MemoryUpdate } from '@atri/db';
import type { Model, ModelMessage, ToolDefinition } from '@atri/llm';
import { estimateRequestTokens, estimateTextTokens, trimToTokens } from '@atri/llm';
import { parseJson, parseMemories, parseReply, type Sticker, type ParsedReply } from './reply.js';
import type { WebTools } from './web.js';

export type PromptName = 'persona' | 'chat' | 'diary' | 'context_notes';
export interface AgentOptions {
  store: Store;
  model: () => Model;
  prompt: (name: PromptName) => string;
  stickers: () => Sticker[];
  web: WebTools;
  timeZone: () => string;
  contextTokens: () => number;
  turnTimeoutMs: () => number;
  images?: (message: Message) => Promise<string[]>;
}
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const string = { type: 'string' };
export const INFO_TOOLS: ToolDefinition[] = [
  {
    name: 'search_memory',
    description: '搜索当前联系人的记忆、日记和原始对话。换个关键词可继续寻找。',
    parameters: object(
      { query: string, kind: { type: 'string', enum: ['message', 'memory', 'diary'] } },
      ['query'],
    ),
  },
  {
    name: 'read_history',
    description: '按搜索或上下文给出的来源 ID 读取完整片段及相邻原话。',
    parameters: object({ ids: { type: 'array', items: string, maxItems: 8 } }, ['ids']),
  },
  {
    name: 'web_search',
    description: '查询最新公开信息，返回真实来源及时间。',
    parameters: object(
      { query: string, freshness: { type: 'string', enum: ['d', 'w', 'm', 'y'] } },
      ['query'],
    ),
  },
  {
    name: 'open_page',
    description: '读取公开网页原文，核实搜索摘要中的信息。',
    parameters: object({ url: string }, ['url']),
  },
];
export function renderMessage(m: Message): string {
  const media = m.media
    .map((a) => (a.description ? `[${a.kind}，模型观察：${a.description}]` : `[收到${a.kind}附件]`))
    .join('\n');
  return `[来源 ${m.id} | ${new Date(m.created_at).toISOString()}]\n${m.content}${media ? '\n' + media : ''}`;
}
export class Agent {
  constructor(private readonly o: AgentOptions) {}
  private async complete(
    task: Task,
    messages: ModelMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
    maxTokens?: number,
  ) {
    if (estimateRequestTokens(messages, tools) > this.o.contextTokens())
      throw new Error('输入超过当前上下文预算，请在调试页增加输入预算或缩短人物设定、消息。');
    const started = Date.now();
    const result = await this.o.model().complete(messages, tools, {
      signal,
      sessionId: `atri:${task.peer_id}:${task.kind}`,
      maxTokens,
    });
    this.o.store.recordUsage(
      task.peer_id,
      task.id,
      task.kind,
      result.inputTokens,
      result.outputTokens,
      Date.now() - started,
    );
    return result;
  }
  private filteredUpdates(updates: MemoryUpdate[], available: Set<string>) {
    return updates
      .filter((u) => u.sources.length > 0 && u.sources.every((id) => available.has(id)))
      .map((u) => ({ ...u, supersedes: u.supersedes?.filter((id) => available.has(id)) }));
  }
  async reply(task: Task, parentSignal?: AbortSignal): Promise<ParsedReply> {
    const { store } = this.o;
    const peer = store.peer(task.peer_id)!;
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, AbortSignal.timeout(this.o.turnTimeoutMs())])
      : AbortSignal.timeout(this.o.turnTimeoutMs());
    const through =
      typeof task.payload.through === 'number' ? task.payload.through : Number.MAX_SAFE_INTEGER;
    const history = store.history(peer.id, 500, through);
    const query = history
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content)
      .join(' ')
      .slice(-1000);
    let recalled = store
      .search(peer.id, query, 6)
      .map((h) => ({ ...h, content: h.content.slice(0, 600) }));
    let memories = store
      .memories(peer.id)
      .slice(0, 10)
      .map((m) => ({ ...m, content: m.content.slice(0, 500), sources: m.sources.slice(0, 3) }));
    const stickers = this.o.stickers().slice(0, 32);
    const base = [
      this.o.prompt('persona'),
      this.o.prompt('chat'),
      `当前时间：${new Intl.DateTimeFormat('zh-CN', { timeZone: this.o.timeZone(), dateStyle: 'full', timeStyle: 'long' }).format(new Date())}`,
      `本次模式：${task.kind === 'proactive' ? '主动联系，可跳过' : '回应用户消息'}`,
      `可用表情目录：\n${JSON.stringify(stickers.map(({ slug, description, tags }) => ({ slug, description, tags })))}`,
    ].join('\n\n');
    const budget = this.o.contextTokens();
    const initialBudget = budget - Math.min(6000, Math.floor(budget * 0.25));
    const reserve = Math.max(
      Math.floor(initialBudget * 0.6),
      history.at(-1) ? estimateTextTokens(renderMessage(history.at(-1)!)) + 32 : 0,
    );
    let optional = Math.max(
      0,
      initialBudget -
        estimateRequestTokens([{ role: 'system', content: base }], INFO_TOOLS) -
        reserve -
        256,
    );
    const notes = trimToTokens(peer.notes, Math.min(1500, optional));
    optional -= estimateTextTokens(notes);
    while (
      memories.length &&
      estimateTextTokens(JSON.stringify(memories)) > Math.min(3000, optional)
    )
      memories.pop();
    optional -= estimateTextTokens(JSON.stringify(memories));
    while (recalled.length && estimateTextTokens(JSON.stringify(recalled)) > Math.max(0, optional))
      recalled.pop();
    const system = [
      base,
      `当前话题笔记（资料）：\n${notes || '暂无'}`,
      `必要认识（资料，stated 是对话依据，interpretation 是主观理解）：\n${JSON.stringify(memories)}`,
      `相关旧事（资料）：\n${JSON.stringify(recalled)}`,
    ].join('\n\n');
    let remaining = Math.max(
      0,
      initialBudget -
        estimateRequestTokens([{ role: 'system', content: system }], INFO_TOOLS) -
        256,
    );
    const recent: Message[] = [];
    for (const m of [...history].reverse()) {
      const length = estimateTextTokens(renderMessage(m)) + 32;
      if (recent.length && remaining < length) break;
      recent.unshift(m);
      remaining -= length;
    }
    const messages: ModelMessage[] = [{ role: 'system', content: system }];
    const imageMessages = recent
      .filter((m) => m.role === 'user' && m.media.some((a) => a.kind === 'image'))
      .slice(-2);
    for (const m of recent) {
      let images: string[] = [];
      if (this.o.images && imageMessages.some((i) => i.id === m.id))
        images = await this.o.images(m);
      const updated = store.getMessage(peer.id, m.id) ?? m;
      messages.push({
        role: m.role,
        content: renderMessage(updated),
        ...(images.length ? { images } : {}),
      });
    }
    if (task.kind === 'proactive')
      messages.push({
        role: 'user',
        content: '现在是一次主动联系机会。依据已有真实话题决定是否开场，没有合适理由就跳过。',
      });
    if (messages.length === 1) messages.push({ role: 'user', content: '请自然开始对话。' });
    // Retain the latest input and whole provider messages when images add input cost.
    while (messages.length > 2 && estimateRequestTokens(messages, INFO_TOOLS) > budget) {
      messages.splice(1, 1);
      recent.shift();
    }
    const available = new Set([
      ...recent.map((m) => m.id),
      ...memories.map((m) => m.id),
      ...recalled.map((m) => m.id),
    ]);
    let toolRounds = 0,
      toolCalls = 0,
      repaired = false,
      toolTokens = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      signal.throwIfAborted();
      const tools = toolRounds < 2 && toolCalls < 4 ? INFO_TOOLS : [];
      const completion = await this.complete(task, messages, tools, signal);
      if (completion.calls.length) {
        if (!tools.length) throw new Error('模型在工具预算耗尽后仍要求调用工具');
        messages.push(completion.continuation);
        toolRounds++;
        for (const call of completion.calls) {
          let result: unknown;
          if (toolCalls++ >= 4) result = { error: '本轮工具调用次数已达上限，请使用已有信息回应' };
          else
            try {
              result = await this.tool(task, call.name, call.arguments, available, signal);
            } catch (error) {
              result = { error: error instanceof Error ? error.message : '工具读取失败' };
            }
          const encoded = JSON.stringify(result),
            remainingTools = Math.max(
              64,
              Math.min(
                6000 - toolTokens,
                budget - estimateRequestTokens(messages, INFO_TOOLS) - 1024,
              ),
            );
          const content =
            estimateTextTokens(encoded) <= remainingTools
              ? encoded
              : JSON.stringify({
                  truncated: true,
                  excerpt: trimToTokens(
                    encoded,
                    Math.max(0, Math.floor((remainingTools - 40) / 2)),
                  ),
                });
          toolTokens += estimateTextTokens(content);
          messages.push({ role: 'tool', callId: call.id, name: call.name, content });
        }
        if (toolRounds >= 2 || toolCalls >= 4)
          messages.push({
            role: 'user',
            content:
              '本轮查询预算已用完。请根据已有资料直接给出最终 JSON；无法核实的部分如实说明。',
          });
        continue;
      }
      try {
        const result = parseReply(completion.text, stickers, task.kind === 'proactive');
        result.memories = this.filteredUpdates(result.memories, available);
        result.descriptions = result.descriptions.filter(
          (d) => available.has(d.messageId) && imageMessages.some((m) => m.id === d.messageId),
        );
        return result;
      } catch (error) {
        if (repaired || attempt === 3) throw error;
        repaired = true;
        messages.push({ role: 'assistant', content: completion.text.slice(0, 8000) });
        messages.push({
          role: 'user',
          content:
            '请仅修复最终输出格式为包含 messages 数组和 memoryUpdates 数组的 JSON，保留已有回应，不再调用工具。',
        });
        toolRounds = 2;
      }
    }
    throw new Error('本轮模型调用已达上限');
  }
  private async tool(
    task: Task,
    name: string,
    args: Record<string, unknown>,
    available: Set<string>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const { store } = this.o,
      peer = task.peer_id;
    let hits: SearchHit[];
    if (name === 'search_memory') {
      const query = String(args.query ?? '').slice(0, 600);
      if (!query.trim()) throw new Error('请提供搜索词');
      const kind = ['message', 'memory', 'diary'].includes(String(args.kind))
        ? (args.kind as 'message' | 'memory' | 'diary')
        : undefined;
      hits = store.search(peer, query, 8, kind);
    } else if (name === 'read_history') {
      if (!Array.isArray(args.ids)) throw new Error('请提供来源 ID 数组');
      hits = store.sources(
        peer,
        args.ids.filter((s): s is string => typeof s === 'string').slice(0, 8),
      );
      const neighbors: SearchHit[] = [];
      for (const hit of hits.filter((h) => h.kind === 'message')) {
        const msg = store.getMessage(peer, hit.id)!;
        neighbors.push(
          ...store.history(peer, 3, msg.seq + 1).map((m) => ({
            id: m.id,
            kind: 'message' as const,
            role: m.role,
            content: renderMessage(m),
            created_at: m.created_at,
            score: 1,
          })),
        );
      }
      hits = [...new Map([...hits, ...neighbors].map((h) => [h.id, h])).values()];
    } else if (name === 'web_search')
      return this.o.web.search(
        String(args.query ?? ''),
        typeof args.freshness === 'string' ? args.freshness : undefined,
        signal,
      );
    else if (name === 'open_page') return this.o.web.open(String(args.url ?? ''), signal);
    else throw new Error('未知工具');
    hits = hits.slice(0, 12).map((h) => ({ ...h, content: h.content.slice(0, 1600) }));
    hits.forEach((h) => available.add(h.id));
    return hits;
  }
  async reflect(task: Task, signal: AbortSignal): Promise<void> {
    const { store } = this.o,
      peer = store.peer(task.peer_id)!;
    const through = Number(task.payload.through ?? Number.MAX_SAFE_INTEGER);
    const after = task.kind === 'notes' ? peer.notes_until : Number(task.payload.after ?? 0);
    let messages = store.historyAfter(peer.id, after, through, 200);
    if (Array.isArray(task.payload.ids)) {
      const ids = new Set(task.payload.ids);
      messages = messages.filter((m) => ids.has(m.id));
    }
    const kind = task.kind === 'notes' ? 'context_notes' : 'diary';
    const prompt =
      (kind === 'diary' ? this.o.prompt('persona') + '\n\n' : '') + this.o.prompt(kind);
    const budget = this.o.contextTokens();
    const notes = trimToTokens(peer.notes, Math.min(1500, budget * 0.08));
    const memories = store.memories(peer.id).slice(0, 12);
    while (
      memories.length &&
      estimateTextTokens(JSON.stringify(memories)) > Math.min(3000, budget * 0.15)
    )
      memories.pop();
    const background = `日期：${String(task.payload.day ?? '')}\n当前话题笔记：${notes}\n已知认识：${JSON.stringify(memories)}\n本次原始记录：\n`;
    const availableTokens =
      budget -
      estimateRequestTokens([
        { role: 'system', content: prompt },
        { role: 'user', content: background },
      ]) -
      64;
    const input: Message[] = [];
    let count = 0;
    for (const m of messages) {
      const size = estimateTextTokens(`${m.role} ${renderMessage(m)}\n\n`);
      if (count + size > availableTokens && input.length) break;
      input.push(m);
      count += size;
    }
    if (!input.length) {
      store.finish(task.id);
      return;
    }
    const content = background + input.map((m) => `${m.role} ${renderMessage(m)}`).join('\n\n');
    const completion = await this.complete(
      task,
      [
        { role: 'system', content: prompt },
        { role: 'user', content },
      ],
      [],
      signal,
      4000,
    );
    const raw = parseJson(completion.text);
    if (kind === 'context_notes') {
      if (typeof raw.notes !== 'string') throw new Error('话题笔记格式无效');
      store.setNotes(task, raw.notes, input.at(-1)!.seq);
      return;
    }
    if (!Array.isArray(raw.sections)) throw new Error('日记格式无效');
    const available = new Set(input.map((m) => m.id));
    const sections = raw.sections
      .slice(0, 6)
      .filter(
        (s: any) =>
          typeof s?.content === 'string' &&
          Array.isArray(s.sources) &&
          s.sources.length &&
          s.sources.every((id: unknown) => typeof id === 'string' && available.has(id)),
      )
      .map((s: any) => ({
        content: s.content.slice(0, 5000),
        sources: [...new Set(s.sources)] as string[],
      }));
    if (raw.sections.length && !sections.length) throw new Error('日记缺少有效来源');
    const updates = this.filteredUpdates(
      parseMemories(raw.memoryUpdates),
      new Set([...available, ...store.memories(peer.id).map((m) => m.id)]),
    );
    store.saveDiary(
      { ...task, payload: { ...task.payload, through: input.at(-1)!.seq } },
      String(task.payload.day),
      sections,
      updates,
    );
  }
}
