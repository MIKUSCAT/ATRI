import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export { createBackup, restoreBackup } from './backup.js';

export type TaskKind = 'chat' | 'notes' | 'diary' | 'proactive';
export type SourceKind = 'message' | 'memory' | 'diary';
export interface Peer {
  id: string;
  channel: string;
  address: string;
  context_token: string;
  approved: number;
  version: number;
  notes: string;
  notes_until: number;
  last_user_at: number;
  last_proactive_at: number;
  created_at: number;
}
export interface Media {
  path?: string;
  mime?: string;
  description?: string;
  kind: string;
  ref?: unknown;
}
export interface Message {
  id: string;
  seq: number;
  peer_id: string;
  role: 'user' | 'assistant';
  content: string;
  media: Media[];
  status: string;
  created_at: number;
}
export interface Task {
  id: string;
  peer_id: string;
  kind: TaskKind;
  state: string;
  payload: Record<string, unknown>;
  version: number;
  attempts: number;
  run_at: number;
  error: string;
  created_at: number;
}
export interface Memory {
  id: string;
  peer_id: string;
  content: string;
  kind: 'stated' | 'interpretation';
  sources: string[];
  status: string;
  created_at: number;
}
export interface DiarySection {
  id: string;
  peer_id: string;
  day: string;
  content: string;
  sources: string[];
  created_at: number;
}
export interface MemoryUpdate {
  content: string;
  kind: 'stated' | 'interpretation';
  sources: string[];
  supersedes?: string[];
}
export interface ReplyPart {
  type: 'text' | 'sticker';
  text?: string;
  slug?: string;
  description?: string;
}
export interface Delivery {
  id: string;
  task_id: string;
  peer_id: string;
  ordinal: number;
  part: ReplyPart;
  status: string;
  attempts: number;
  error: string;
  created_at: number;
}
export interface SearchHit {
  id: string;
  kind: SourceKind;
  content: string;
  created_at: number;
  score: number;
  role?: Message['role'];
  memory_kind?: Memory['kind'];
  sources?: string[];
}
type Row = Record<string, unknown>;
const parse = <T>(value: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export class Store {
  readonly sql: DatabaseSync;
  private transactionDepth = 0;
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    if (Number(this.sql.prepare('PRAGMA user_version').get()?.user_version ?? 0) > 1) {
      this.sql.close();
      throw new Error('数据库来自更新版本，不能用当前程序打开');
    }
    this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS peers (
        id TEXT PRIMARY KEY, channel TEXT NOT NULL, address TEXT NOT NULL, context_token TEXT NOT NULL DEFAULT '',
        approved INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '', notes_until INTEGER NOT NULL DEFAULT 0,
        last_user_at INTEGER NOT NULL DEFAULT 0, last_proactive_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, peer_id TEXT NOT NULL REFERENCES peers(id),
        event_key TEXT, role TEXT NOT NULL, content TEXT NOT NULL, media TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(peer_id,event_key)
      );
      CREATE INDEX IF NOT EXISTS messages_peer ON messages(peer_id,seq);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, peer_id TEXT NOT NULL REFERENCES peers(id), kind TEXT NOT NULL, dedupe_key TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}', state TEXT NOT NULL DEFAULT 'queued', version INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, run_at INTEGER NOT NULL, error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
        UNIQUE(peer_id,kind,dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS tasks_ready ON tasks(state,run_at,peer_id);
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY REFERENCES messages(id), task_id TEXT NOT NULL REFERENCES tasks(id), peer_id TEXT NOT NULL REFERENCES peers(id),
        ordinal INTEGER NOT NULL, part TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, UNIQUE(task_id,ordinal)
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, peer_id TEXT NOT NULL REFERENCES peers(id), content TEXT NOT NULL, kind TEXT NOT NULL,
        sources TEXT NOT NULL, source_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL,
        UNIQUE(peer_id,source_hash)
      );
      CREATE TABLE IF NOT EXISTS diary_sections (
        id TEXT PRIMARY KEY, peer_id TEXT NOT NULL REFERENCES peers(id), task_id TEXT NOT NULL REFERENCES tasks(id),
        ordinal INTEGER NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL, sources TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, UNIQUE(task_id,ordinal)
      );
      CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY, peer_id TEXT, task_id TEXT, purpose TEXT, input_tokens INTEGER, output_tokens INTEGER, duration_ms INTEGER, created_at INTEGER);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(id UNINDEXED, peer_id UNINDEXED, kind UNINDEXED, content, created_at UNINDEXED, tokenize='trigram');
      PRAGMA user_version=1;
    `);
  }
  close() {
    this.sql.close();
  }
  transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn();
    this.sql.exec('BEGIN IMMEDIATE');
    this.transactionDepth = 1;
    try {
      const result = fn();
      this.sql.exec('COMMIT');
      return result;
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }
  getSetting<T>(key: string, fallback: T): T {
    return parse(
      this.sql.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value,
      fallback,
    );
  }
  setSetting(key: string, value: unknown) {
    this.sql
      .prepare(
        'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  removeSetting(key: string) {
    this.sql.prepare('DELETE FROM settings WHERE key=?').run(key);
  }
  ensurePeer(
    id: string,
    channel: string,
    address: string,
    token = '',
    approved = false,
    now = Date.now(),
  ): Peer {
    this.sql
      .prepare(
        `INSERT INTO peers(id,channel,address,context_token,approved,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET context_token=CASE WHEN excluded.context_token<>'' THEN excluded.context_token ELSE peers.context_token END`,
      )
      .run(id, channel, address, token, approved ? 1 : 0, now);
    return this.peer(id)!;
  }
  peer(id: string) {
    return this.sql.prepare('SELECT * FROM peers WHERE id=?').get(id) as unknown as
      Peer | undefined;
  }
  peers() {
    return this.sql
      .prepare('SELECT * FROM peers ORDER BY last_user_at DESC')
      .all() as unknown as Peer[];
  }
  approve(id: string, approved: boolean) {
    this.sql.prepare('UPDATE peers SET approved=? WHERE id=?').run(approved ? 1 : 0, id);
  }
  private message(row: Row): Message {
    return { ...row, media: parse(row.media, []) } as unknown as Message;
  }
  getMessage(peer: string, id: string) {
    const row = this.sql.prepare('SELECT * FROM messages WHERE peer_id=? AND id=?').get(peer, id);
    return row ? this.message(row) : undefined;
  }
  ingest(
    peer: string,
    eventKey: string,
    content: string,
    media: Media[] = [],
    timestamp = Date.now(),
  ) {
    return this.transaction(() => {
      const existing = this.sql
        .prepare('SELECT * FROM messages WHERE peer_id=? AND event_key=?')
        .get(peer, eventKey);
      if (existing) return { duplicate: true, message: this.message(existing) };
      const id = randomUUID();
      this.sql
        .prepare(
          "INSERT INTO messages(id,peer_id,event_key,role,content,media,status,created_at) VALUES(?,?,?,'user',?,?,'received',?)",
        )
        .run(id, peer, eventKey, content, JSON.stringify(media), timestamp);
      this.sql
        .prepare('UPDATE peers SET version=version+1,last_user_at=MAX(last_user_at,?) WHERE id=?')
        .run(timestamp, peer);
      this.index(id, peer, 'message', content, timestamp);
      return { duplicate: false, message: this.getMessage(peer, id)! };
    });
  }
  updateMedia(peer: string, id: string, media: Media[]) {
    const message = this.getMessage(peer, id);
    if (!message || message.status === 'deleted') return;
    this.sql
      .prepare('UPDATE messages SET media=? WHERE peer_id=? AND id=?')
      .run(JSON.stringify(media), peer, id);
    if (['received', 'sent'].includes(message.status))
      this.index(
        id,
        peer,
        'message',
        message.content +
          media
            .filter((m) => m.description)
            .map((m) => `\n[模型对${m.kind}的观察：${m.description}]`)
            .join(''),
        message.created_at,
      );
  }
  history(peer: string, limit = 40, before = Number.MAX_SAFE_INTEGER): Message[] {
    return this.sql
      .prepare(
        "SELECT * FROM messages WHERE peer_id=? AND seq<=? AND status IN ('received','sent') ORDER BY seq DESC LIMIT ?",
      )
      .all(peer, before, Math.min(500, limit))
      .reverse()
      .map((r) => this.message(r));
  }
  historyAfter(
    peer: string,
    after: number,
    before = Number.MAX_SAFE_INTEGER,
    limit = 200,
  ): Message[] {
    return this.sql
      .prepare(
        "SELECT * FROM messages WHERE peer_id=? AND seq>? AND seq<=? AND status IN ('received','sent') ORDER BY seq LIMIT ?",
      )
      .all(peer, after, before, limit)
      .map((r) => this.message(r));
  }
  enqueue(
    peer: string,
    kind: TaskKind,
    key: string,
    payload: Record<string, unknown> = {},
    runAt = Date.now(),
  ): string {
    const id = randomUUID();
    this.sql
      .prepare(
        'INSERT OR IGNORE INTO tasks(id,peer_id,kind,dedupe_key,payload,run_at,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(id, peer, kind, key, JSON.stringify(payload), runAt, Date.now());
    return String(
      this.sql
        .prepare('SELECT id FROM tasks WHERE peer_id=? AND kind=? AND dedupe_key=?')
        .get(peer, kind, key)!.id,
    );
  }
  enqueueChat(peer: string, seq: number, debounceMs: number) {
    const existing = this.sql
      .prepare(
        "SELECT id FROM tasks WHERE peer_id=? AND kind='chat' AND state='queued' ORDER BY created_at LIMIT 1",
      )
      .get(peer);
    if (existing) {
      this.sql
        .prepare('UPDATE tasks SET payload=?,run_at=? WHERE id=?')
        .run(JSON.stringify({ through: seq }), Date.now() + debounceMs, String(existing.id));
      return String(existing.id);
    }
    return this.enqueue(peer, 'chat', String(seq), { through: seq }, Date.now() + debounceMs);
  }
  private task(row: Row): Task {
    return { ...row, payload: parse(row.payload, {}) } as unknown as Task;
  }
  taskById(id: string) {
    const row = this.sql.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    return row ? this.task(row) : undefined;
  }
  readyPeers(now = Date.now()): string[] {
    return this.sql
      .prepare(
        `SELECT DISTINCT p.id FROM peers p WHERE p.approved=1 AND
      NOT EXISTS(SELECT 1 FROM outbox WHERE peer_id=p.id AND status IN ('uncertain','failed')) AND
      (EXISTS(SELECT 1 FROM tasks WHERE peer_id=p.id AND state='queued' AND run_at<=?) OR EXISTS(SELECT 1 FROM outbox WHERE peer_id=p.id AND status='pending'))`,
      )
      .all(now)
      .map((r) => String(r.id));
  }
  claim(peer: string, now = Date.now()): Task | undefined {
    return this.transaction(() => {
      const row = this.sql
        .prepare(
          `SELECT * FROM tasks WHERE peer_id=? AND state='queued' AND run_at<=? ORDER BY
        CASE kind WHEN 'chat' THEN 0 WHEN 'notes' THEN 1 WHEN 'diary' THEN 2 ELSE 3 END,created_at LIMIT 1`,
        )
        .get(peer, now);
      if (!row) return undefined;
      this.sql
        .prepare("UPDATE tasks SET state='running',version=?,attempts=attempts+1 WHERE id=?")
        .run(this.peer(peer)!.version, String(row.id));
      return this.taskById(String(row.id));
    });
  }
  finish(id: string, state = 'done', error = '') {
    this.sql
      .prepare('UPDATE tasks SET state=?,error=? WHERE id=?')
      .run(state, error.slice(0, 400), id);
  }
  retry(id: string, delay = 0) {
    this.sql
      .prepare(
        "UPDATE tasks SET state='queued',run_at=?,error='' WHERE id=? AND state NOT IN ('done','ready')",
      )
      .run(Date.now() + delay, id);
  }
  recover() {
    this.transaction(() => {
      this.sql.exec(
        "UPDATE tasks SET state='queued' WHERE state='running'; UPDATE outbox SET status='uncertain',error='进程在发送确认前退出，请确认是否送达' WHERE status='sending'; UPDATE messages SET status='uncertain' WHERE id IN (SELECT id FROM outbox WHERE status='uncertain');",
      );
    });
  }
  pendingDeliveries(peer: string): Delivery[] {
    return this.sql
      .prepare(
        "SELECT * FROM outbox WHERE peer_id=? AND status='pending' ORDER BY created_at,task_id,ordinal",
      )
      .all(peer)
      .map((r) => ({ ...r, part: parse(r.part, {}) }) as unknown as Delivery);
  }
  issues() {
    return {
      tasks: this.sql
        .prepare(
          "SELECT t.id,t.peer_id,p.address,t.kind,t.state,t.error,t.created_at FROM tasks t JOIN peers p ON p.id=t.peer_id WHERE t.state='failed' ORDER BY t.created_at DESC LIMIT 100",
        )
        .all(),
      deliveries: this.sql
        .prepare(
          "SELECT o.id,o.peer_id,p.address,o.task_id,o.status,o.error,o.created_at,m.content FROM outbox o JOIN peers p ON p.id=o.peer_id JOIN messages m ON m.id=o.id WHERE o.status IN ('uncertain','failed') ORDER BY o.created_at DESC LIMIT 100",
        )
        .all(),
    };
  }
  saveReply(task: Task, parts: ReplyPart[], updates: MemoryUpdate[], now = Date.now()): boolean {
    return this.transaction(() => {
      if (this.taskById(task.id)?.state !== 'running') return false;
      if (this.peer(task.peer_id)?.version !== task.version) {
        this.finish(task.id, 'superseded');
        return false;
      }
      for (const update of updates) this.writeMemory(task.peer_id, update, now);
      parts.forEach((part, ordinal) => {
        const id = `${task.id}:${ordinal}`;
        const content =
          part.type === 'text' ? part.text! : `[表情：${part.description ?? part.slug}]`;
        this.sql
          .prepare(
            "INSERT INTO messages(id,peer_id,role,content,status,created_at) VALUES(?,?,'assistant',?,'pending',?)",
          )
          .run(id, task.peer_id, content, now);
        this.sql
          .prepare(
            'INSERT INTO outbox(id,task_id,peer_id,ordinal,part,created_at) VALUES(?,?,?,?,?,?)',
          )
          .run(id, task.id, task.peer_id, ordinal, JSON.stringify(part), now);
      });
      this.finish(task.id, parts.length ? 'ready' : 'done');
      if (task.kind === 'chat' && typeof task.payload.through === 'number')
        this.sql
          .prepare(
            "UPDATE tasks SET state='superseded' WHERE peer_id=? AND kind='chat' AND id<>? AND state IN ('queued','failed') AND CAST(json_extract(payload,'$.through') AS INTEGER)<=?",
          )
          .run(task.peer_id, task.id, task.payload.through);
      return true;
    });
  }
  startDelivery(id: string) {
    this.sql
      .prepare(
        "UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=? AND status='pending'",
      )
      .run(id);
  }
  markDelivery(
    id: string,
    status: 'sent' | 'uncertain' | 'failed' | 'pending' | 'cancelled',
    error = '',
    now = Date.now(),
  ) {
    this.transaction(() => {
      const row = this.sql.prepare('SELECT * FROM outbox WHERE id=?').get(id);
      if (!row) throw new Error('发送记录不存在');
      this.sql
        .prepare('UPDATE outbox SET status=?,error=? WHERE id=?')
        .run(status, error.slice(0, 400), id);
      this.sql.prepare('UPDATE messages SET status=? WHERE id=?').run(status, id);
      if (status === 'sent') {
        const msg = this.getMessage(String(row.peer_id), id)!;
        this.index(id, msg.peer_id, 'message', msg.content, msg.created_at);
        if (this.taskById(String(row.task_id))?.kind === 'proactive')
          this.sql.prepare('UPDATE peers SET last_proactive_at=? WHERE id=?').run(now, msg.peer_id);
      }
      const count = Number(
        this.sql
          .prepare(
            "SELECT count(*) AS n FROM outbox WHERE task_id=? AND status NOT IN ('sent','cancelled')",
          )
          .get(String(row.task_id))!.n,
      );
      if (!count) this.finish(String(row.task_id));
    });
  }
  cancelUnsent(task: Task): boolean {
    return this.transaction(() => {
      if (
        this.sql
          .prepare(
            "SELECT 1 FROM outbox WHERE task_id=? AND status IN ('sent','sending','uncertain')",
          )
          .get(task.id)
      )
        return false;
      this.sql
        .prepare("UPDATE outbox SET status='cancelled' WHERE task_id=? AND status='pending'")
        .run(task.id);
      this.sql
        .prepare(
          "UPDATE messages SET status='cancelled' WHERE id IN (SELECT id FROM outbox WHERE task_id=?)",
        )
        .run(task.id);
      this.finish(task.id, 'superseded');
      return true;
    });
  }
  private index(id: string, peer: string, kind: SourceKind, content: string, at: number) {
    this.sql.prepare('DELETE FROM search_index WHERE id=?').run(id);
    this.sql
      .prepare('INSERT INTO search_index(id,peer_id,kind,content,created_at) VALUES(?,?,?,?,?)')
      .run(id, peer, kind, content, at);
  }
  private unindex(id: string) {
    this.sql.prepare('DELETE FROM search_index WHERE id=?').run(id);
  }
  private describeHit(hit: SearchHit): SearchHit {
    if (hit.kind === 'message') {
      // Index IDs are globally unique; access scope was checked before this lookup.
      const role = this.sql.prepare('SELECT role FROM messages WHERE id=?').get(hit.id)?.role;
      return { ...hit, role: role as Message['role'] };
    }
    const row =
      hit.kind === 'memory'
        ? this.sql.prepare('SELECT kind,sources FROM memories WHERE id=?').get(hit.id)
        : this.sql.prepare('SELECT sources FROM diary_sections WHERE id=?').get(hit.id);
    return {
      ...hit,
      sources: parse<string[]>(row?.sources, []),
      ...(hit.kind === 'memory' ? { memory_kind: row?.kind as Memory['kind'] } : {}),
    };
  }
  sources(peer: string, ids: string[]): SearchHit[] {
    const rows: SearchHit[] = [];
    for (const id of [...new Set(ids)].slice(0, 40)) {
      const row = this.sql
        .prepare('SELECT id,kind,content,created_at FROM search_index WHERE peer_id=? AND id=?')
        .get(peer, id);
      if (row)
        rows.push(
          this.describeHit({
            ...row,
            created_at: Number(row.created_at),
            score: 1,
          } as unknown as SearchHit),
        );
    }
    return rows;
  }
  memories(peer: string): Memory[] {
    return this.sql
      .prepare(
        "SELECT * FROM memories WHERE peer_id=? AND status='active' ORDER BY created_at DESC LIMIT 500",
      )
      .all(peer)
      .map((r) => ({ ...r, sources: parse(r.sources, []) }) as unknown as Memory);
  }
  private writeMemory(peer: string, update: MemoryUpdate, now: number) {
    const ids = [...new Set(update.sources)];
    const sources = this.sources(peer, ids);
    if (
      !update.content.trim() ||
      !ids.length ||
      ids.length !== sources.length ||
      sources.some((s) => s.kind === 'memory')
    )
      return;
    if (update.kind === 'stated' && sources.some((s) => s.kind === 'diary')) return;
    const sourceHash = hash(update.content.trim() + '\n' + ids.sort().join(','));
    const id = randomUUID();
    const result = this.sql
      .prepare(
        'INSERT OR IGNORE INTO memories(id,peer_id,content,kind,sources,source_hash,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        id,
        peer,
        update.content.slice(0, 800),
        update.kind,
        JSON.stringify(ids),
        sourceHash,
        now,
      );
    if (!result.changes) return;
    for (const previous of update.supersedes ?? []) {
      if (
        this.sql
          .prepare(
            "UPDATE memories SET status='superseded' WHERE peer_id=? AND id=? AND status='active'",
          )
          .run(peer, previous).changes
      )
        this.unindex(previous);
    }
    this.index(id, peer, 'memory', update.content.slice(0, 800), now);
  }
  addMemory(peer: string, update: MemoryUpdate, expectedVersion: number) {
    return this.transaction(() => {
      if (this.peer(peer)?.version !== expectedVersion) return false;
      this.writeMemory(peer, update, Date.now());
      return true;
    });
  }
  correctMemory(peer: string, id: string, content: string) {
    this.transaction(() => {
      const original = this.sql
        .prepare("SELECT id FROM memories WHERE peer_id=? AND id=? AND status='active'")
        .get(peer, id);
      if (!original) throw new Error('记忆不存在');
      const msg = this.ingest(peer, randomUUID(), `[管理页更正] ${content}`).message;
      this.writeMemory(
        peer,
        { content, kind: 'stated', sources: [msg.id], supersedes: [id] },
        Date.now(),
      );
      this.sql.prepare("UPDATE peers SET notes='',notes_until=0 WHERE id=?").run(peer);
    });
  }
  diaries(peer: string): DiarySection[] {
    return this.sql
      .prepare(
        "SELECT * FROM diary_sections WHERE peer_id=? AND status='active' ORDER BY day DESC,created_at,ordinal LIMIT 500",
      )
      .all(peer)
      .map((r) => ({ ...r, sources: parse(r.sources, []) }) as unknown as DiarySection);
  }
  saveDiary(
    task: Task,
    day: string,
    sections: { content: string; sources: string[] }[],
    updates: MemoryUpdate[],
    now = Date.now(),
  ) {
    this.transaction(() => {
      if (this.taskById(task.id)?.state !== 'running') return;
      sections.forEach((section, ordinal) => {
        const sources = this.sources(task.peer_id, section.sources);
        if (
          !section.sources.length ||
          sources.length !== new Set(section.sources).size ||
          sources.some((s) => s.kind !== 'message')
        )
          return;
        const id = `diary:${task.id}:${ordinal}`;
        this.sql
          .prepare(
            'INSERT OR IGNORE INTO diary_sections(id,peer_id,task_id,ordinal,day,content,sources,created_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .run(
            id,
            task.peer_id,
            task.id,
            ordinal,
            day,
            section.content,
            JSON.stringify(section.sources),
            now,
          );
        this.index(id, task.peer_id, 'diary', section.content, now);
      });
      if (this.peer(task.peer_id)?.version === task.version)
        for (const update of updates) this.writeMemory(task.peer_id, update, now);
      if (typeof task.payload.through === 'number')
        this.setSetting(`diary_cursor:${task.peer_id}`, task.payload.through);
      this.finish(task.id);
    });
  }
  setNotes(task: Task, notes: string, through: number) {
    this.transaction(() => {
      if (this.peer(task.peer_id)?.version === task.version)
        this.sql
          .prepare('UPDATE peers SET notes=?,notes_until=? WHERE id=?')
          .run(notes.slice(0, 4000), through, task.peer_id);
      this.finish(task.id);
    });
  }
  forget(peer: string, id: string) {
    this.transaction(() => {
      const source = this.sources(peer, [id])[0];
      if (!source) throw new Error('记录不存在');
      if (source.kind === 'message')
        this.sql
          .prepare(
            "UPDATE messages SET content='',media='[]',status='deleted' WHERE peer_id=? AND id=?",
          )
          .run(peer, id);
      if (source.kind === 'memory')
        this.sql
          .prepare("UPDATE memories SET content='',status='deleted' WHERE peer_id=? AND id=?")
          .run(peer, id);
      const invalid = new Set([id]);
      // Invalidation must cover the entire history, independent of UI list limits.
      const diaries = this.sql
        .prepare("SELECT id,sources FROM diary_sections WHERE peer_id=? AND status='active'")
        .all(peer)
        .map((r) => ({ id: String(r.id), sources: parse<string[]>(r.sources, []) }));
      for (const diary of diaries)
        if (diary.id === id || diary.sources.some((s) => invalid.has(s))) {
          invalid.add(diary.id);
          this.sql
            .prepare("UPDATE diary_sections SET content='',status='deleted' WHERE id=?")
            .run(diary.id);
        }
      const memories = this.sql
        .prepare("SELECT id,sources FROM memories WHERE peer_id=? AND status='active'")
        .all(peer)
        .map((r) => ({ id: String(r.id), sources: parse<string[]>(r.sources, []) }));
      for (const mem of memories)
        if (mem.sources.some((s) => invalid.has(s))) {
          invalid.add(mem.id);
          this.sql
            .prepare("UPDATE memories SET content='',status='deleted' WHERE id=?")
            .run(mem.id);
        }
      for (const sourceId of invalid) this.unindex(sourceId);
      this.sql
        .prepare("UPDATE peers SET notes='',notes_until=0,version=version+1 WHERE id=?")
        .run(peer);
    });
  }
  search(peer: string, query: string, limit = 6, kind?: SourceKind): SearchHit[] {
    const normalized = query.normalize('NFKC').toLowerCase();
    const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
    const terms = [
      ...new Set(
        words.flatMap((w) =>
          /\p{Script=Han}/u.test(w)
            ? [w, ...Array.from({ length: Math.max(0, w.length - 1) }, (_, i) => w.slice(i, i + 2))]
            : [w],
        ),
      ),
    ]
      .filter((t) => t.length >= 2)
      .slice(0, 48);
    if (!terms.length && normalized.trim()) terms.push(normalized.trim());
    if (!terms.length) return [];
    const rows: Row[] = [];
    const kindClause = kind ? ' AND kind=?' : '',
      kindParameters = kind ? [kind] : [];
    const longTerms = terms.filter((t) => [...t].length >= 3).slice(0, 20);
    if (longTerms.length) {
      const match = longTerms.map((t) => '"' + t.replaceAll('"', '""') + '"').join(' OR ');
      rows.push(
        ...this.sql
          .prepare(
            'SELECT id,kind,content,created_at FROM search_index WHERE peer_id=? AND search_index MATCH ?' +
              kindClause +
              ' ORDER BY rank LIMIT 150',
          )
          .all(peer, match, ...kindParameters),
      );
    }
    const likeTerms = terms.slice(0, 32).map((t) => '%' + t.replace(/[\\%_]/g, '\\$&') + '%');
    rows.push(
      ...this.sql
        .prepare(
          `SELECT id,kind,content,created_at FROM search_index WHERE peer_id=? AND (${likeTerms.map(() => "content LIKE ? ESCAPE '\\'").join(' OR ')})${kindClause} ORDER BY CAST(created_at AS INTEGER) DESC LIMIT 300`,
        )
        .all(peer, ...likeTerms, ...kindParameters),
    );
    return [...new Map(rows.map((r) => [r.id, r])).values()]
      .filter((r) => !kind || r.kind === kind)
      .map((r) => {
        const body = String(r.content).normalize('NFKC').toLowerCase();
        const score = terms.reduce((n, t) => n + (body.includes(t) ? Math.min(t.length, 8) : 0), 0);
        return {
          ...r,
          created_at: Number(r.created_at),
          score: score + (score ? (r.kind === 'memory' ? 0.5 : r.kind === 'diary' ? 0.25 : 0) : 0),
        } as unknown as SearchHit;
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.created_at - a.created_at)
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map((hit) => this.describeHit(hit));
  }
  recordUsage(
    peer: string,
    task: string,
    purpose: string,
    input: number,
    output: number,
    duration: number,
  ) {
    this.sql
      .prepare(
        'INSERT INTO usage(peer_id,task_id,purpose,input_tokens,output_tokens,duration_ms,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(peer, task, purpose, input, output, duration, Date.now());
  }
  usage() {
    return this.sql
      .prepare(
        'SELECT purpose,count(*) AS calls,sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens,round(avg(duration_ms)) AS average_ms FROM usage GROUP BY purpose',
      )
      .all();
  }
  recentUsage() {
    return this.sql
      .prepare(
        'SELECT u.purpose,u.input_tokens,u.output_tokens,u.duration_ms,u.created_at,p.address FROM usage u LEFT JOIN peers p ON p.id=u.peer_id ORDER BY u.id DESC LIMIT 12',
      )
      .all();
  }
  async backup(destination: string) {
    mkdirSync(dirname(destination), { recursive: true });
    await backup(this.sql, destination);
  }
}
