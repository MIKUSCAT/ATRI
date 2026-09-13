import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  ILinkClient,
  ILinkError,
  extractText,
  extractMediaRefs,
  isUserInbound,
  isVisionMime,
  loginWithQrcode,
  type WeixinMessage,
  type InboundMediaRef,
} from '@atri/ilink';
import { DeliveryError, type Runtime, type Transport } from '@atri/core';
import type { Store, Peer, ReplyPart, Message, Media } from '@atri/db';
import type { Settings } from './config.js';
import type { Stickers } from './stickers.js';

interface Session {
  botToken: string;
  baseUrl: string;
  accountId: string;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function inboundKey(message: WeixinMessage, cursor: string, index: number): string {
  const stable = message.message_id ?? message.msg_id ?? message.id;
  if (typeof stable === 'string' || typeof stable === 'number') return `id:${stable}`;
  const refs = extractMediaRefs(message).map((r) => ({
    kind: r.kind,
    index: r.index,
    aesKey: r.aesKey,
    encryptQueryParam: r.encryptQueryParam,
    fileName: r.fileName,
  }));
  return hash(
    JSON.stringify([
      message.from_user_id,
      message.to_user_id,
      message.create_time_ms ?? `batch:${cursor}:${index}`,
      message.message_type,
      extractText(message),
      refs,
    ]),
  );
}
export class WeChatBridge implements Transport {
  private running = false;
  private runtime?: Runtime;
  private client?: ILinkClient;
  private loginController?: AbortController;
  private session?: Session;
  private state: {
    status: string;
    qrContent?: string;
    error?: string;
    lastPollAt?: number;
    accountId?: string;
  } = { status: '未登录' };
  constructor(
    private readonly store: Store,
    private readonly settings: Settings,
    private readonly stickers: Stickers,
    private readonly log: (message: string) => void = () => {},
  ) {
    const session = store.getSetting<Session | null>('wechat:session', null);
    if (session) this.useSession(session);
  }
  private useSession(session: Session) {
    this.session = session;
    this.client = new ILinkClient({
      botToken: session.botToken,
      baseUrl: session.baseUrl,
      timeoutMs: 20000,
      longPollTimeoutMs: 40000,
      mediaMaxBytes: 5 * 1024 * 1024,
    });
    this.state = { status: '已连接', accountId: session.accountId };
  }
  status() {
    return { ...this.state };
  }
  start(runtime: Runtime) {
    if (this.running) return;
    this.runtime = runtime;
    this.running = true;
    void this.poll();
  }
  stop() {
    this.running = false;
    this.loginController?.abort();
  }
  login() {
    if (this.loginController && !this.loginController.signal.aborted) return this.status();
    this.logout();
    const controller = new AbortController();
    this.loginController = controller;
    this.state = { status: '正在获取二维码' };
    void loginWithQrcode({
      client: new ILinkClient({ baseUrl: this.settings.ilinkBase() }),
      signal: controller.signal,
      onQrcode: (qr) => {
        if (!controller.signal.aborted)
          this.state = {
            status: '等待扫码',
            qrContent: qr.qrcodeUrl ?? qr.qrcodeImgContent ?? qr.qrcode,
          };
      },
      onStatus: (status) => {
        if (!controller.signal.aborted && status === 'scanned')
          this.state = { ...this.state, status: '请在微信确认登录' };
      },
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        const accountId = result.accountId || String(result.raw.ilink_bot_id ?? '');
        if (!accountId) throw new Error('微信登录响应缺少账号标识');
        const session = {
          botToken: result.botToken,
          baseUrl: result.baseUrl || this.settings.ilinkBase(),
          accountId,
        };
        this.store.setSetting('wechat:session', session);
        this.useSession(session);
        this.loginController = undefined;
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          this.state = {
            status: '登录失败',
            error: error instanceof Error ? error.message : '登录失败',
          };
          this.loginController = undefined;
        }
      });
    return this.status();
  }
  logout() {
    this.loginController?.abort();
    this.client = undefined;
    this.session = undefined;
    this.store.removeSetting('wechat:session');
    this.state = { status: '未登录' };
  }
  private async poll() {
    while (this.running) {
      const client = this.client,
        session = this.session;
      if (!client || !session) {
        await pause(1000);
        continue;
      }
      const cursorKey = `wechat:cursor:${session.accountId}`;
      const cursor = this.store.getSetting<string>(cursorKey, '');
      try {
        const result = await client.getUpdates(cursor);
        if (!this.running) return;
        if (this.session !== session) continue;
        if (result.errcode && result.errcode !== 0)
          throw new ILinkError(result.errmsg ?? '微信接口返回错误', result.ret, result.errcode);
        for (const [index, message] of (result.msgs ?? []).entries())
          this.receive(session.accountId, message, cursor, index);
        if (typeof result.get_updates_buf === 'string')
          this.store.setSetting(cursorKey, result.get_updates_buf);
        this.state = { status: '已连接', accountId: session.accountId, lastPollAt: Date.now() };
        if (!result.msgs?.length) await pause(250);
      } catch (error) {
        if (!this.running) return;
        if (this.session !== session) continue;
        if (error instanceof ILinkError && (error.ret === -14 || error.errcode === -14)) {
          this.client = undefined;
          this.session = undefined;
          this.store.removeSetting('wechat:session');
          this.state = { status: '登录已过期，请重新扫码' };
        } else {
          this.state = {
            ...this.state,
            status: '连接中断，正在重试',
            error: error instanceof Error ? error.message : '连接失败',
          };
          this.log('微信轮询暂时失败');
          await pause(3000);
        }
      }
    }
  }
  receive(accountId: string, message: WeixinMessage, cursor: string, index: number) {
    if (!isUserInbound(message) || message.group_id || !message.from_user_id) return;
    const address = message.from_user_id,
      peerId = `wechat:${accountId}:${address}`;
    this.store.ensurePeer(
      peerId,
      'wechat',
      address,
      message.context_token ?? '',
      this.settings.allowedPeers().has(address),
    );
    const refs = extractMediaRefs(message);
    const text =
      extractText(message) ||
      refs
        .map((r) =>
          r.kind === 'image'
            ? '[图片]'
            : r.kind === 'voice'
              ? '[语音，微信未提供文字转写]'
              : `[${r.kind}附件]`,
        )
        .join('\n');
    if (!text.trim()) return;
    const media: Media[] = refs.map((ref) => ({
      kind: ref.kind,
      ref,
      ...(ref.transcript ? { description: ref.transcript } : {}),
    }));
    const timestamp =
      typeof message.create_time_ms === 'number' &&
      Number.isFinite(message.create_time_ms) &&
      message.create_time_ms > 0 &&
      message.create_time_ms <= Date.now() + 300000
        ? message.create_time_ms
        : Date.now();
    this.runtime!.accept(
      peerId,
      inboundKey(message, cursor, index),
      text.slice(0, 12000),
      media,
      timestamp,
    );
  }
  async typing(peer: Peer, active: boolean) {
    if (peer.channel !== 'wechat' || !this.client || !peer.context_token) return;
    const params = { toUserId: peer.address, contextToken: peer.context_token };
    if (active) await this.client.startTyping(params);
    else await this.client.stopTyping(params);
  }
  async send(peer: Peer, part: ReplyPart, clientId: string) {
    if (peer.channel === 'preview') return;
    if (!this.client || !this.session || !peer.id.startsWith(`wechat:${this.session.accountId}:`))
      throw new DeliveryError('微信账号未连接或与会话不匹配', true);
    if (!peer.context_token)
      throw new DeliveryError('缺少微信会话凭据，请让联系人先发来消息', true);
    try {
      const params = { toUserId: peer.address, contextToken: peer.context_token, clientId };
      if (part.type === 'sticker')
        await this.client.sendImage({ ...params, image: this.stickers.bytes(part.slug!) });
      else await this.client.sendText({ ...params, text: part.text! });
    } catch (error) {
      if (error instanceof ILinkError)
        throw new DeliveryError(
          error.message,
          (error.ret !== undefined && error.ret !== 0) ||
            (error.errcode !== undefined && error.errcode !== 0) ||
            /^HTTP 4\d\d$/.test(error.message),
        );
      throw error;
    }
  }
  async images(message: Message): Promise<string[]> {
    if (!this.settings.config().vision) return [];
    const images: string[] = [],
      media = [...message.media];
    let changed = false;
    for (let i = 0; i < media.length && images.length < 2; i++) {
      const item = { ...media[i] };
      if (item.kind !== 'image') continue;
      try {
        let bytes: Buffer;
        if (item.path) {
          const path = resolve(this.settings.dataDir, item.path);
          if (!path.startsWith(resolve(this.settings.dataDir) + sep))
            throw new Error('附件路径无效');
          bytes = readFileSync(path);
        } else {
          if (!this.client || !item.ref) throw new Error('当前无法读取图片');
          const downloaded = await this.client.downloadMedia(item.ref as InboundMediaRef, {
            maxBytes: 5 * 1024 * 1024,
          });
          if (!isVisionMime(downloaded.mime)) throw new Error('不支持的图片格式');
          bytes = downloaded.data;
          item.mime = downloaded.mime!;
          item.path = `media/${message.id}-${i}.${item.mime.split('/')[1]}`;
          mkdirSync(join(this.settings.dataDir, 'media'), { recursive: true });
          writeFileSync(join(this.settings.dataDir, item.path), bytes);
          changed = true;
        }
        if (bytes.length > 5 * 1024 * 1024) throw new Error('图片过大');
        if (item.mime && isVisionMime(item.mime))
          images.push(`data:${item.mime};base64,${bytes.toString('base64')}`);
      } catch {
        if (!item.description) {
          item.description = '图片目前无法读取，尚未识别画面内容';
          changed = true;
        }
      }
      media[i] = item;
    }
    if (changed) this.store.updateMedia(message.peer_id, message.id, media);
    return images;
  }
}
function pause(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
