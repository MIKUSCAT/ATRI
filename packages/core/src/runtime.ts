import type { Store, Peer, ReplyPart, Task, Media } from '@atri/db';
import { Agent, renderMessage, type AgentOptions } from './agent.js';
import { estimateTextTokens } from '@atri/llm';

export interface RuntimeConfig {
  timeZone: string;
  diaryHour: number;
  proactiveEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  proactiveAfterHours: number;
  debounceMs: number;
  maxConcurrentPeers: number;
  turnTimeoutMs: number;
  contextTokens: number;
}
export interface Transport {
  send(peer: Peer, part: ReplyPart, clientId: string): Promise<void>;
  typing?(peer: Peer, active: boolean): Promise<void>;
}
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly certainFailure = false,
  ) {
    super(message);
  }
}
export interface RuntimeOptions extends AgentOptions {
  config: () => RuntimeConfig;
  transport: Transport;
  log?: (message: string, details?: unknown) => void;
}
export function dayAt(at: number, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  return ['year', 'month', 'day'].map((t) => p.find((v) => v.type === t)!.value).join('-');
}
function hourAt(at: number, timeZone: string) {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(at),
    ),
  );
}
export function inQuietHours(hour: number, start: number, end: number) {
  return start === end
    ? false
    : start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
}
export class Runtime {
  readonly agent: Agent;
  private active = new Map<
    string,
    { promise: Promise<void>; controller: AbortController; kind?: string }
  >();
  private timer?: ReturnType<typeof setInterval>;
  private scheduleTimer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(readonly options: RuntimeOptions) {
    this.agent = new Agent(options);
  }
  get store(): Store {
    return this.options.store;
  }
  start() {
    this.store.recover();
    this.stopped = false;
    this.timer = setInterval(() => this.pump(), 300);
    this.scheduleTimer = setInterval(() => this.schedule(), 60000);
    this.schedule();
    this.pump();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    for (const a of this.active.values()) a.controller.abort();
    await Promise.allSettled([...this.active.values()].map((a) => a.promise));
  }
  accept(
    peer: string,
    eventKey: string,
    content: string,
    media: Media[] = [],
    timestamp = Date.now(),
  ) {
    const result = this.store.transaction(() => {
      const event = this.store.ingest(peer, eventKey, content, media, timestamp);
      const taskId = !event.duplicate
        ? this.store.enqueueChat(peer, event.message.seq, this.options.config().debounceMs)
        : undefined;
      return { ...event, taskId };
    });
    const active = this.active.get(peer);
    if (
      active &&
      (active.kind === 'diary' || active.kind === 'notes' || active.kind === 'proactive')
    )
      active.controller.abort();
    this.pump();
    return result;
  }
  pump() {
    if (this.stopped) return;
    for (const peer of this.store.readyPeers()) {
      if (this.active.has(peer)) continue;
      if (this.active.size >= this.options.config().maxConcurrentPeers) break;
      const controller = new AbortController();
      const entry = {
        promise: Promise.resolve(),
        controller,
        kind: undefined as string | undefined,
      };
      this.active.set(peer, entry);
      entry.promise = this.work(peer, entry)
        .catch((error) => this.options.log?.('会话处理失败', { peer, error: String(error) }))
        .finally(() => {
          this.active.delete(peer);
          if (!this.stopped) queueMicrotask(() => this.pump());
        });
    }
  }
  async drain(timeoutMs = 10000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      this.pump();
      if (!this.active.size && !this.store.readyPeers().length) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('等待队列处理超时');
  }
  private async work(peerId: string, entry: { controller: AbortController; kind?: string }) {
    for (let n = 0; n < 12 && !this.stopped; n++) {
      const peer = this.store.peer(peerId)!;
      if (!peer.approved) return;
      const deliveries = this.store.pendingDeliveries(peerId);
      if (deliveries.length) {
        entry.kind = 'delivery';
        const task = this.store.taskById(deliveries[0].task_id)!;
        if (task.version !== peer.version && this.store.cancelUnsent(task)) continue;
        for (const delivery of deliveries.filter((d) => d.task_id === task.id)) {
          this.store.startDelivery(delivery.id);
          try {
            await this.options.transport.send(this.store.peer(peerId)!, delivery.part, delivery.id);
            this.store.markDelivery(delivery.id, 'sent');
          } catch (error) {
            this.store.markDelivery(
              delivery.id,
              error instanceof DeliveryError && error.certainFailure ? 'failed' : 'uncertain',
              error instanceof Error ? error.message : '发送失败',
            );
            return;
          }
          if (delivery !== deliveries.at(-1)) await new Promise((r) => setTimeout(r, 120));
        }
        this.maybeNotes(peerId);
        continue;
      }
      const task = this.store.claim(peerId);
      if (!task) return;
      entry.kind = task.kind;
      if (entry.controller.signal.aborted) entry.controller = new AbortController();
      const signal = AbortSignal.any([
        entry.controller.signal,
        AbortSignal.timeout(this.options.config().turnTimeoutMs),
      ]);
      try {
        if (task.kind === 'chat' || task.kind === 'proactive') {
          if (task.kind === 'proactive' && !this.proactiveAllowed(peer, Date.now())) {
            this.store.finish(task.id);
            continue;
          }
          const typing = this.options.transport.typing?.(peer, true).catch(() => {});
          try {
            const reply = await this.agent.reply(task, signal);
            const saved = this.store.saveReply(task, reply.parts, reply.memories);
            if (saved)
              for (const description of reply.descriptions) {
                const msg = this.store.getMessage(peerId, description.messageId);
                if (msg) {
                  this.store.updateMedia(
                    peerId,
                    msg.id,
                    msg.media.map((m) =>
                      m.kind === 'image' ? { ...m, description: description.description } : m,
                    ),
                  );
                }
              }
          } finally {
            void Promise.resolve(typing)
              .then(() => this.options.transport.typing?.(peer, false))
              .catch(() => {});
          }
        } else await this.agent.reflect(task, signal);
      } catch (error) {
        if (this.stopped || entry.controller.signal.aborted) {
          this.store.finish(task.id, 'interrupted');
          this.store.retry(task.id, task.kind === 'chat' ? 0 : 60000);
        } else {
          this.store.finish(task.id, 'failed', error instanceof Error ? error.message : '任务失败');
          this.options.log?.('任务失败', { task: task.id, kind: task.kind, error: String(error) });
        }
      }
    }
  }
  private maybeNotes(peerId: string) {
    const peer = this.store.peer(peerId)!;
    const recent = this.store.historyAfter(peerId, peer.notes_until, Number.MAX_SAFE_INTEGER, 200);
    if (
      recent.length < 20 ||
      (recent.length < 200 &&
        recent.reduce((n, m) => n + estimateTextTokens(renderMessage(m)), 0) <
          this.options.config().contextTokens * 0.65)
    )
      return;
    const through = recent[Math.max(0, recent.length - 13)].seq;
    if (through > peer.notes_until)
      this.store.enqueue(peerId, 'notes', String(through), { through });
  }
  queueDiary(peerId: string, force = false, now = Date.now()): string | undefined {
    const after = this.store.getSetting<number>(`diary_cursor:${peerId}`, 0);
    const today = dayAt(now, this.options.config().timeZone);
    const records = this.store
      .historyAfter(peerId, after, Number.MAX_SAFE_INTEGER, 200)
      .filter((m) => force || dayAt(m.created_at, this.options.config().timeZone) < today);
    if (!records.length) return;
    const day = dayAt(records[0].created_at, this.options.config().timeZone);
    let chars = 0;
    const picked = [];
    for (const m of records) {
      if (dayAt(m.created_at, this.options.config().timeZone) !== day) break;
      const size = renderMessage(m).length;
      if (picked.length && chars + size > 22000) break;
      picked.push(m);
      chars += size;
    }
    const through = picked.at(-1)!.seq;
    const id = this.store.enqueue(peerId, 'diary', `${day}:${through}`, {
      day,
      through,
      after,
      ids: picked.map((m) => m.id),
    });
    this.pump();
    return id;
  }
  proactiveAllowed(peer: Peer, now: number): boolean {
    const c = this.options.config(),
      hour = hourAt(now, c.timeZone);
    return (
      c.proactiveEnabled &&
      !!peer.approved &&
      !!peer.context_token &&
      peer.channel === 'wechat' &&
      peer.last_user_at > 0 &&
      now - peer.last_user_at >= c.proactiveAfterHours * 3600000 &&
      now - peer.last_proactive_at >= 12 * 3600000 &&
      !inQuietHours(hour, c.quietStart, c.quietEnd) &&
      (!peer.last_proactive_at ||
        dayAt(peer.last_proactive_at, c.timeZone) !== dayAt(now, c.timeZone))
    );
  }
  schedule(now = Date.now()) {
    if (this.stopped) return;
    const c = this.options.config(),
      hour = hourAt(now, c.timeZone);
    for (const peer of this.store.peers().filter((p) => p.approved)) {
      if (hour >= c.diaryHour) this.queueDiary(peer.id, false, now);
      if (this.proactiveAllowed(peer, now))
        this.store.enqueue(peer.id, 'proactive', dayAt(now, c.timeZone), {});
    }
    this.pump();
  }
}
