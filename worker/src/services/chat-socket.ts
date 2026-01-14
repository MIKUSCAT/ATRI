import { Env } from '../types';

export type ChatSocketReplyPayload = {
  type?: 'reply';
  userId: string;
  reply: string;
  mood?: { p: number; a: number; d: number };
  action?: string | null;
  intimacy?: number;
  replyLogId?: string;
  replyTimestamp?: number;
  replyTo?: string;
};

export async function notifyChatWaiters(env: Env, payload: ChatSocketReplyPayload) {
  if (!env.CHAT_SOCKET) return;
  try {
    const id = env.CHAT_SOCKET.idFromName(payload.userId);
    const stub = env.CHAT_SOCKET.get(id);
    await stub.fetch('https://internal/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, type: 'reply' })
    });
  } catch (error) {
    console.warn('[ATRI] notify chat socket failed', { userId: payload.userId, error });
  }
}
