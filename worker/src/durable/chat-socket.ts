import { CHAT_MODEL, AttachmentPayload, Env } from '../types';
import { normalizeAttachmentList } from '../utils/attachments';
import { sanitizeText } from '../utils/sanitize';
import { runAgentChat } from '../services/agent-service';
import { fetchConversationLogsAfter, saveConversationLog, saveUserModelPreference, isConversationLogDeleted } from '../services/data-service';
import { ChatSocketReplyPayload } from '../services/chat-socket';

type ChatSocketRequest = {
  type?: string;
  userId?: string;
  content?: string;
  logId?: string;
  platform?: string;
  userName?: string;
  clientTimeIso?: string;
  modelKey?: string;
  imageUrl?: string;
  attachments?: AttachmentPayload[];
  timeZone?: string;
  after?: number;
};

type ConnectionState = {
  userId: string;
  waiting: boolean;
  after: number;
};

type MoodPayload = { p: number; a: number; d: number };

export class ChatSocket {
  private connections = new Map<WebSocket, ConnectionState>();

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/notify') {
      return this.handleNotify(request);
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.acceptConnection(server, url.searchParams.get('userId') || '');
    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptConnection(socket: WebSocket, userId: string) {
    socket.accept();
    this.connections.set(socket, { userId, waiting: false, after: 0 });

    socket.addEventListener('message', (event) => {
      this.handleMessage(socket, event).catch((error) => {
        this.sendError(socket, error instanceof Error ? error.message : 'invalid_request');
      });
    });
    socket.addEventListener('close', () => {
      this.connections.delete(socket);
    });
    socket.addEventListener('error', () => {
      this.connections.delete(socket);
    });
  }

  private async handleMessage(socket: WebSocket, event: MessageEvent) {
    const raw = typeof event.data === 'string' ? event.data : null;
    if (!raw) {
      this.sendError(socket, 'invalid_payload');
      return;
    }

    let payload: ChatSocketRequest;
    try {
      payload = JSON.parse(raw) as ChatSocketRequest;
    } catch {
      this.sendError(socket, 'invalid_json');
      return;
    }

    const type = (payload.type || '').toLowerCase();
    if (type === 'wait') {
      await this.handleWait(socket, payload);
      return;
    }
    if (type === 'send') {
      await this.handleSend(socket, payload);
      return;
    }
    if (type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    this.sendError(socket, 'unknown_type');
  }

  private async handleSend(socket: WebSocket, payload: ChatSocketRequest) {
    const connectionUserId = (this.connections.get(socket)?.userId || '').trim();
    const userId = (payload.userId || connectionUserId).trim();
    if (!userId) {
      this.sendError(socket, 'missing_user');
      return;
    }
    if (connectionUserId && payload.userId && connectionUserId !== userId) {
      this.sendError(socket, 'user_mismatch');
      return;
    }

    const content = String(payload.content || '');
    const imageUrl = typeof payload.imageUrl === 'string' ? payload.imageUrl.trim() : '';
    const attachments = Array.isArray(payload.attachments)
      ? normalizeAttachmentList(payload.attachments)
      : [];
    const cleanedContent = content.trim();
    const hasImage = Boolean(imageUrl) || attachments.some(att => att.type === 'image');
    if (!cleanedContent && !hasImage) {
      this.sendError(socket, 'empty_content');
      return;
    }

    const messageText = sanitizeText(cleanedContent);
    if (!messageText && !hasImage) {
      this.sendError(socket, 'empty_content');
      return;
    }

    if (payload.modelKey) {
      try {
        await saveUserModelPreference(this.env, userId, payload.modelKey);
      } catch (error) {
        console.warn('[ATRI] save user model preference failed', { userId, error });
      }
    }

    const result = await runAgentChat(this.env, {
      userId,
      platform: payload.platform || 'android',
      userName: payload.userName,
      clientTimeIso: payload.clientTimeIso,
      messageText,
      attachments,
      inlineImage: imageUrl || undefined,
      model: resolveModelKey(payload.modelKey),
      logId: payload.logId
    });

    const replyTo = typeof payload.logId === 'string' ? payload.logId.trim() : undefined;
    const replyLogId = crypto.randomUUID();
    const replyTimestamp = Date.now();
    const moodPayload = result.mood ? JSON.stringify(result.mood) : undefined;
    const shouldSkip = replyTo
      ? await isConversationLogDeleted(this.env, userId, replyTo)
      : false;

    if (!shouldSkip) {
      try {
        await saveConversationLog(this.env, {
          id: replyLogId,
          userId,
          role: 'atri',
          content: result.reply,
          attachments: [],
          mood: moodPayload,
          replyTo,
          timestamp: replyTimestamp,
          userName: payload.userName,
          timeZone: payload.timeZone
        });
      } catch (error) {
        console.warn('[ATRI] reply log failed', { userId, error });
      }
    }

    const replyPayload: ChatSocketReplyPayload = {
      type: 'reply',
      userId,
      reply: result.reply,
      mood: result.mood,
      action: result.action,
      intimacy: result.intimacy,
      replyLogId,
      replyTimestamp,
      replyTo
    };

    try {
      socket.send(JSON.stringify(replyPayload));
    } catch (error) {
      console.warn('[ATRI] reply socket send failed', { userId, error });
    }
    try {
      socket.close(1000, 'done');
    } catch (error) {
      console.warn('[ATRI] reply socket close failed', { userId, error });
    }

    if (!shouldSkip) {
      this.broadcastReply(replyPayload, socket);
    }
  }

  private async handleWait(socket: WebSocket, payload: ChatSocketRequest) {
    const connectionUserId = (this.connections.get(socket)?.userId || '').trim();
    const userId = (payload.userId || connectionUserId).trim();
    if (!userId) {
      this.sendError(socket, 'missing_user');
      return;
    }
    if (connectionUserId && payload.userId && connectionUserId !== userId) {
      this.sendError(socket, 'user_mismatch');
      return;
    }

    const after = Number.isFinite(payload.after) ? Number(payload.after) : 0;
    const logs = await fetchConversationLogsAfter(this.env, {
      userId,
      after,
      limit: 1,
      roles: ['atri']
    });

    if (logs.length > 0) {
      const log = logs[0];
      const replyPayload: ChatSocketReplyPayload = {
        type: 'reply',
        userId,
        reply: log.content,
        mood: parseMoodPayload(log.mood),
        replyLogId: log.id,
        replyTimestamp: log.timestamp,
        replyTo: log.replyTo
      };
      try {
        socket.send(JSON.stringify(replyPayload));
      } catch (error) {
        console.warn('[ATRI] wait socket send failed', { userId, error });
      }
      try {
        socket.close(1000, 'done');
      } catch (error) {
        console.warn('[ATRI] wait socket close failed', { userId, error });
      }
      return;
    }

    const state = this.connections.get(socket);
    if (state) {
      state.waiting = true;
      state.after = after;
    }
  }

  private async handleNotify(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let payload: ChatSocketReplyPayload | null = null;
    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid payload', { status: 400 });
    }

    if (!payload || typeof payload.reply !== 'string' || !payload.reply.trim()) {
      return new Response('Invalid payload', { status: 400 });
    }

    const replyPayload: ChatSocketReplyPayload = {
      type: 'reply',
      userId: String(payload.userId || '').trim(),
      reply: payload.reply,
      mood: payload.mood,
      action: payload.action,
      intimacy: payload.intimacy,
      replyLogId: payload.replyLogId,
      replyTimestamp: payload.replyTimestamp
    };

    const delivered = this.broadcastReply(replyPayload);
    return new Response(JSON.stringify({ delivered }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private broadcastReply(payload: ChatSocketReplyPayload, origin?: WebSocket) {
    const replyTimestamp = typeof payload.replyTimestamp === 'number' ? payload.replyTimestamp : 0;
    let delivered = 0;
    for (const [socket, state] of this.connections.entries()) {
      if (socket === origin) continue;
      if (!state.waiting) continue;
      if (replyTimestamp && replyTimestamp <= state.after) continue;
      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        console.warn('[ATRI] broadcast socket send failed', { error });
      }
      try {
        socket.close(1000, 'done');
      } catch (error) {
        console.warn('[ATRI] broadcast socket close failed', { error });
      }
      this.connections.delete(socket);
      delivered += 1;
    }
    return delivered;
  }

  private sendError(socket: WebSocket, message: string) {
    const payload = { type: 'error', message };
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // Ignore send failures for closed sockets
    }
    socket.close(1011, message);
  }
}

function resolveModelKey(modelKey?: string | null): string {
  if (typeof modelKey === 'string' && modelKey.trim().length > 0) {
    return modelKey.trim();
  }
  return CHAT_MODEL;
}

function parseMoodPayload(raw?: string | null): MoodPayload | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<MoodPayload>;
    if (typeof parsed.p === 'number' && typeof parsed.a === 'number' && typeof parsed.d === 'number') {
      return { p: parsed.p, a: parsed.a, d: parsed.d };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
