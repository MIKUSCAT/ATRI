import { buildILinkHeaders } from "./headers.js";
import {
  aesEcbPaddedSize,
  buildCdnDownloadUrl,
  buildCdnUploadUrl,
  decryptAes128Ecb,
  encodeAesKeyField,
  encryptAes128Ecb,
  md5Hex,
  parseAesKey,
  randomAesKey,
  randomFileKey,
} from "./crypto.js";
import { isAllowedMediaUrl, sniffMediaMime } from "./media.js";
import type {
  DownloadedMedia,
  GetConfigResponse,
  GetUpdatesResponse,
  GetUploadUrlResponse,
  ILinkClientOptions,
  InboundMediaRef,
  QrcodeResponse,
  QrcodeStatusResponse,
  SendMessageResponse,
  TypingStatus,
  UploadMediaType,
  UploadedMedia,
  WeixinItemType,
  WeixinMessage,
} from "./types.js";
import { ITEM_TYPE, UPLOAD_MEDIA_TYPE } from "./types.js";

const DEFAULT_BASE = "https://ilinkai.weixin.qq.com";
const DEFAULT_CDN = "https://novac2c.cdn.weixin.qq.com/c2c";
/** Server-side typing_ticket validity is ~24h; refresh well before that. */
const DEFAULT_TYPING_TICKET_TTL_MS = 20 * 60 * 60 * 1000;
const DEFAULT_TYPING_TICKET_MAX_ENTRIES = 5000;
const DEFAULT_MEDIA_MAX_BYTES = 12 * 1024 * 1024;

interface TypingTicketEntry {
  ticket: string;
  expiresAt: number;
}

export class ILinkError extends Error {
  constructor(
    message: string,
    public readonly ret?: number,
    public readonly errcode?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ILinkError";
  }
}

export class ILinkClient {
  private baseUrl: string;
  private botToken?: string;
  private channelVersion: string;
  private timeoutMs: number;
  private longPollTimeoutMs: number;
  private cdnBaseUrl: string;
  /** typing_ticket per WeChat peer (getconfig is one extra RTT per peer/day) */
  private typingTickets = new Map<string, TypingTicketEntry>();
  /** Collapses the burst of concurrent typing calls one reply produces */
  private typingTicketInflight = new Map<string, Promise<string | null>>();
  private typingTicketTtlMs: number;
  private typingTicketMaxEntries: number;
  private mediaMaxBytes: number;
  private mediaHostAllowlist: string[];

  constructor(opts: ILinkClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.botToken = opts.botToken;
    this.channelVersion = opts.channelVersion ?? "1.0.2";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.longPollTimeoutMs = opts.longPollTimeoutMs ?? 40_000;
    this.cdnBaseUrl = (opts.cdnBaseUrl ?? DEFAULT_CDN).replace(/\/$/, "");
    this.typingTicketTtlMs = Math.max(
      60_000,
      opts.typingTicketTtlMs ?? DEFAULT_TYPING_TICKET_TTL_MS,
    );
    this.typingTicketMaxEntries = Math.max(
      64,
      opts.typingTicketMaxEntries ?? DEFAULT_TYPING_TICKET_MAX_ENTRIES,
    );
    this.mediaMaxBytes = Math.max(
      1024,
      opts.mediaMaxBytes ?? DEFAULT_MEDIA_MAX_BYTES,
    );
    this.mediaHostAllowlist = (opts.mediaHostAllowlist ?? [])
      .map((h) => h.trim())
      .filter(Boolean);
  }

  setBotToken(token: string): void {
    this.botToken = token;
  }

  getBotToken(): string | undefined {
    return this.botToken;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, "");
  }

  setCdnBaseUrl(url: string): void {
    this.cdnBaseUrl = url.replace(/\/$/, "");
  }

  getCdnBaseUrl(): string {
    return this.cdnBaseUrl;
  }

  /** GET login QR (bot_type=3). */
  async getBotQrcode(botType = 3): Promise<QrcodeResponse> {
    const url = `${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=${botType}`;
    return this.getJson<QrcodeResponse>(url, false, this.timeoutMs);
  }

  /**
   * Poll QR scan status. Server may long-hold this request — use a long timeout
   * and treat AbortError as "still waiting" by retrying at call site.
   */
  async getQrcodeStatus(qrcode: string): Promise<QrcodeStatusResponse> {
    const url = `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    // Status endpoint often holds ~35–60s; 30s default was causing AbortError
    return this.getJson<QrcodeStatusResponse>(url, false, 90_000);
  }

  /**
   * Long-poll inbound messages.
   * Pass previous get_updates_buf (empty string on first call).
   */
  async getUpdates(getUpdatesBuf: string): Promise<GetUpdatesResponse> {
    this.requireToken();
    return this.postJson<GetUpdatesResponse>(
      "/ilink/bot/getupdates",
      {
        get_updates_buf: getUpdatesBuf,
        base_info: { channel_version: this.channelVersion },
      },
      this.longPollTimeoutMs,
    );
  }

  /** Send text reply; context_token from inbound message is required. */
  async sendText(params: {
    toUserId: string;
    text: string;
    contextToken: string;
    clientId?: string;
  }): Promise<SendMessageResponse> {
    this.requireToken();
    const clientId =
      params.clientId ??
      `wechat-ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return this.postJson<SendMessageResponse>("/ilink/bot/sendmessage", {
      msg: {
        from_user_id: "",
        to_user_id: params.toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: params.contextToken,
        item_list: [{ type: 1, text_item: { text: params.text } }],
      },
    });
  }

  /**
   * Fetch the per-user `typing_ticket` that sendtyping requires.
   * Ticket validity is ~24h, so this is roughly one call per peer per day.
   */
  async getConfig(params: {
    toUserId: string;
    contextToken: string;
  }): Promise<GetConfigResponse> {
    this.requireToken();
    return this.postJson<GetConfigResponse>("/ilink/bot/getconfig", {
      ilink_user_id: params.toUserId,
      // Older captures name the same field to_user_id. Both are sent because
      // the server ignores unknown keys — sendImage already relies on that with
      // its extra top-level base_info — and this way either naming works.
      to_user_id: params.toUserId,
      context_token: params.contextToken,
      base_info: { channel_version: this.channelVersion },
    });
  }

  /** Cached ticket for a peer, or null when absent/expired. Never hits network. */
  getCachedTypingTicket(toUserId: string): string | null {
    const hit = this.typingTickets.get(toUserId);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.typingTickets.delete(toUserId);
      return null;
    }
    return hit.ticket;
  }

  invalidateTypingTicket(toUserId: string): void {
    this.typingTickets.delete(toUserId);
  }

  /**
   * Resolve a typing ticket, cache-first.
   *
   * Returns null instead of throwing when getconfig fails: the indicator is
   * cosmetic and must never take down a reply. sendTyping then falls back to
   * the ticket-less body shape.
   */
  async getTypingTicket(params: {
    toUserId: string;
    contextToken: string;
    force?: boolean;
  }): Promise<string | null> {
    const key = params.toUserId;
    if (!params.force) {
      const cached = this.getCachedTypingTicket(key);
      if (cached) return cached;
      const inflight = this.typingTicketInflight.get(key);
      if (inflight) return inflight;
    }

    const pending = (async (): Promise<string | null> => {
      try {
        const res = await this.getConfig({
          toUserId: params.toUserId,
          contextToken: params.contextToken,
        });
        const ticket =
          typeof res.typing_ticket === "string" ? res.typing_ticket.trim() : "";
        if (!ticket) return null;
        this.rememberTypingTicket(key, ticket);
        return ticket;
      } catch {
        return null;
      }
    })();

    this.typingTicketInflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.typingTicketInflight.get(key) === pending) {
        this.typingTicketInflight.delete(key);
      }
    }
  }

  /**
   * Show ("对方正在输入中", status 1) or clear (status 2) the typing indicator.
   *
   * Two-step protocol: getconfig issues a per-user ticket, sendtyping carries it
   * plus the status. Status defaults to 1 so existing call sites keep working.
   * Stop calls never fetch a ticket — if none is cached we never started, so
   * paying a getconfig round trip just to stop would be wasted latency.
   */
  async sendTyping(params: {
    toUserId: string;
    contextToken: string;
    /** 1 = start (default), 2 = stop */
    status?: TypingStatus;
    /** Pre-resolved ticket; omit to use the per-peer cache */
    typingTicket?: string;
  }): Promise<unknown> {
    this.requireToken();
    const status: TypingStatus = params.status ?? 1;
    const explicit = params.typingTicket?.trim();

    let ticket: string | null = explicit ?? null;
    if (!ticket) {
      ticket =
        status === 2
          ? this.getCachedTypingTicket(params.toUserId)
          : await this.getTypingTicket({
              toUserId: params.toUserId,
              contextToken: params.contextToken,
            });
    }
    const fromCache = !explicit && Boolean(ticket);

    try {
      return await this.postTyping(
        params.toUserId,
        params.contextToken,
        status,
        ticket,
      );
    } catch (err) {
      // A cached ticket can be revoked or expire early server-side. One forced
      // refresh and retry, then rethrow — callers treat typing as best effort.
      if (!fromCache) throw err;
      this.invalidateTypingTicket(params.toUserId);
      const fresh = await this.getTypingTicket({
        toUserId: params.toUserId,
        contextToken: params.contextToken,
        force: true,
      });
      if (!fresh || fresh === ticket) throw err;
      return this.postTyping(
        params.toUserId,
        params.contextToken,
        status,
        fresh,
      );
    }
  }

  /** Show the "对方正在输入中" indicator. */
  async startTyping(params: {
    toUserId: string;
    contextToken: string;
    typingTicket?: string;
  }): Promise<unknown> {
    return this.sendTyping({ ...params, status: 1 });
  }

  /** Clear the indicator (call once the reply has been sent). */
  async stopTyping(params: {
    toUserId: string;
    contextToken: string;
    typingTicket?: string;
  }): Promise<unknown> {
    return this.sendTyping({ ...params, status: 2 });
  }

  private postTyping(
    toUserId: string,
    contextToken: string,
    status: TypingStatus,
    ticket: string | null,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      ilink_user_id: toUserId,
      to_user_id: toUserId,
      context_token: contextToken,
      status,
    };
    if (ticket) body.typing_ticket = ticket;
    return this.postJson("/ilink/bot/sendtyping", body);
  }

  private rememberTypingTicket(toUserId: string, ticket: string): void {
    const now = Date.now();
    if (this.typingTickets.size >= this.typingTicketMaxEntries) {
      for (const [k, v] of this.typingTickets) {
        if (v.expiresAt <= now) this.typingTickets.delete(k);
      }
      // Still full: drop oldest insertions. Map preserves insertion order and
      // this method always deletes before setting, so order is recency order.
      let toDrop = this.typingTickets.size - this.typingTicketMaxEntries + 1;
      if (toDrop > 0) {
        for (const k of this.typingTickets.keys()) {
          this.typingTickets.delete(k);
          if (--toDrop <= 0) break;
        }
      }
    }
    this.typingTickets.delete(toUserId);
    this.typingTickets.set(toUserId, {
      ticket,
      expiresAt: now + this.typingTicketTtlMs,
    });
  }

  /**
   * Request CDN upload credentials for a media blob.
   * media_type: 1=image, 2=video, 3=file, 4=voice
   */
  async getUploadUrl(params: {
    filekey: string;
    mediaType: UploadMediaType;
    toUserId: string;
    rawSize: number;
    rawFileMd5: string;
    fileSize: number;
    aesKeyHex: string;
    noNeedThumb?: boolean;
  }): Promise<GetUploadUrlResponse> {
    this.requireToken();
    return this.postJson<GetUploadUrlResponse>("/ilink/bot/getuploadurl", {
      filekey: params.filekey,
      media_type: params.mediaType,
      to_user_id: params.toUserId,
      rawsize: params.rawSize,
      rawfilemd5: params.rawFileMd5,
      filesize: params.fileSize,
      aeskey: params.aesKeyHex,
      no_need_thumb: params.noNeedThumb !== false,
      base_info: { channel_version: this.channelVersion },
    });
  }

  /**
   * Encrypt plaintext and POST to WeChat CDN.
   * Returns download `encrypt_query_param` from response header `x-encrypted-param`.
   */
  async uploadEncryptedToCdn(params: {
    plaintext: Buffer;
    aesKey: Buffer;
    filekey: string;
    uploadFullUrl?: string;
    uploadParam?: string;
  }): Promise<string> {
    const ciphertext = encryptAes128Ecb(params.plaintext, params.aesKey);
    let url: string | undefined;
    if (params.uploadFullUrl?.trim()) {
      url = params.uploadFullUrl.trim();
    } else if (params.uploadParam) {
      url = buildCdnUploadUrl(
        this.cdnBaseUrl,
        params.uploadParam,
        params.filekey,
      );
    }
    if (!url) {
      throw new ILinkError(
        "CDN upload URL missing (need upload_full_url or upload_param)",
      );
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const msg =
          res.headers.get("x-error-message") ||
          (await res.text().catch(() => "")) ||
          `HTTP ${res.status}`;
        throw new ILinkError(`CDN upload failed: ${msg}`, undefined, res.status);
      }
      const dl = res.headers.get("x-encrypted-param");
      if (!dl) {
        throw new ILinkError("CDN upload response missing x-encrypted-param");
      }
      return dl;
    } catch (err) {
      if (err instanceof ILinkError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ILinkError(
          `CDN upload timed out after ${this.timeoutMs}ms`,
          undefined,
          undefined,
          { aborted: true },
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Upload raw bytes to WeChat CDN (image by default). */
  async uploadMedia(params: {
    toUserId: string;
    data: Buffer;
    mediaType?: UploadMediaType;
  }): Promise<UploadedMedia> {
    const mediaType = params.mediaType ?? 1;
    const plaintext = params.data;
    const rawSize = plaintext.length;
    const rawFileMd5 = md5Hex(plaintext);
    const fileSize = aesEcbPaddedSize(rawSize);
    const filekey = randomFileKey();
    const aesKey = randomAesKey();

    const upload = await this.getUploadUrl({
      filekey,
      mediaType,
      toUserId: params.toUserId,
      rawSize,
      rawFileMd5,
      fileSize,
      aesKeyHex: aesKey.toString("hex"),
    });

    const downloadEncryptedQueryParam = await this.uploadEncryptedToCdn({
      plaintext,
      aesKey,
      filekey,
      uploadFullUrl: upload.upload_full_url,
      uploadParam: upload.upload_param,
    });

    return {
      filekey,
      downloadEncryptedQueryParam,
      aesKey,
      rawSize,
      cipherSize: fileSize,
    };
  }

  /**
   * Upload image bytes to WeChat CDN and send as IMAGE message.
   * context_token from inbound message is required.
   */
  async sendImage(params: {
    toUserId: string;
    contextToken: string;
    image: Buffer;
    clientId?: string;
  }): Promise<SendMessageResponse> {
    this.requireToken();
    if (!params.image?.length) {
      throw new ILinkError("image buffer is empty");
    }

    const uploaded = await this.uploadMedia({
      toUserId: params.toUserId,
      data: params.image,
      mediaType: 1,
    });

    const clientId =
      params.clientId ??
      `wechat-ai-img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return this.postJson<SendMessageResponse>("/ilink/bot/sendmessage", {
      msg: {
        from_user_id: "",
        to_user_id: params.toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: params.contextToken,
        item_list: [
          {
            type: 2,
            image_item: {
              media: {
                encrypt_query_param: uploaded.downloadEncryptedQueryParam,
                aes_key: encodeAesKeyField(uploaded.aesKey),
                encrypt_type: 1,
              },
              mid_size: uploaded.cipherSize,
            },
          },
        ],
      },
      base_info: { channel_version: this.channelVersion },
    });
  }

  /**
   * Upload bytes and send them as a non-image media message.
   *
   * `sendImage` is the verified reference shape for this envelope. Only `image`
   * (item type 2) has been exercised against the live server; `voice` (item
   * type 3) is confirmed on the *inbound* path only, and video/file item types
   * are inferred — hence `itemType` / `itemField` are explicit parameters so ops
   * can correct them without a code change once real captures exist.
   */
  async sendMedia(params: {
    toUserId: string;
    contextToken: string;
    data: Buffer;
    /** getuploadurl media_type — see UPLOAD_MEDIA_TYPE */
    mediaType: UploadMediaType;
    /** item_list entry type number — see ITEM_TYPE */
    itemType: WeixinItemType;
    /** item_list entry field name, e.g. "voice_item" */
    itemField: string;
    /** Extra fields merged into the item object (duration, file_name, …) */
    itemExtra?: Record<string, unknown>;
    clientId?: string;
  }): Promise<SendMessageResponse> {
    this.requireToken();
    if (!params.data?.length) {
      throw new ILinkError(`${params.itemField} buffer is empty`);
    }
    if (params.data.length > this.mediaMaxBytes) {
      throw new ILinkError(
        `media too large: ${params.data.length} > ${this.mediaMaxBytes} bytes`,
      );
    }

    const uploaded = await this.uploadMedia({
      toUserId: params.toUserId,
      data: params.data,
      mediaType: params.mediaType,
    });

    const clientId =
      params.clientId ??
      `wechat-ai-${params.itemField}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

    return this.postJson<SendMessageResponse>("/ilink/bot/sendmessage", {
      msg: {
        from_user_id: "",
        to_user_id: params.toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: params.contextToken,
        item_list: [
          {
            type: params.itemType,
            [params.itemField]: {
              media: {
                encrypt_query_param: uploaded.downloadEncryptedQueryParam,
                aes_key: encodeAesKeyField(uploaded.aesKey),
                encrypt_type: 1,
              },
              mid_size: uploaded.cipherSize,
              ...(params.itemExtra ?? {}),
            },
          },
        ],
      },
      base_info: { channel_version: this.channelVersion },
    });
  }

  /**
   * Send a voice message. WeChat plays SILK/AMR; other containers may be
   * rejected by the client even when the upload succeeds.
   */
  async sendVoice(params: {
    toUserId: string;
    contextToken: string;
    voice: Buffer;
    /** Playback length in ms, when known — shown on the bubble */
    durationMs?: number;
    itemType?: WeixinItemType;
    clientId?: string;
  }): Promise<SendMessageResponse> {
    const itemExtra: Record<string, unknown> = {};
    if (typeof params.durationMs === "number" && params.durationMs > 0) {
      const ms = Math.round(params.durationMs);
      itemExtra.duration_ms = ms;
      itemExtra.voice_length = ms;
    }
    return this.sendMedia({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      data: params.voice,
      mediaType: UPLOAD_MEDIA_TYPE.voice,
      itemType: params.itemType ?? ITEM_TYPE.voice,
      itemField: "voice_item",
      itemExtra,
      clientId: params.clientId,
    });
  }

  /** Send a video. Item type 4 is inferred — override `itemType` if captures differ. */
  async sendVideo(params: {
    toUserId: string;
    contextToken: string;
    video: Buffer;
    durationMs?: number;
    itemType?: WeixinItemType;
    clientId?: string;
  }): Promise<SendMessageResponse> {
    const itemExtra: Record<string, unknown> = {};
    if (typeof params.durationMs === "number" && params.durationMs > 0) {
      itemExtra.duration_ms = Math.round(params.durationMs);
    }
    return this.sendMedia({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      data: params.video,
      mediaType: UPLOAD_MEDIA_TYPE.video,
      itemType: params.itemType ?? ITEM_TYPE.video,
      itemField: "video_item",
      itemExtra,
      clientId: params.clientId,
    });
  }

  /** Send a file. Item type 5 is inferred — override `itemType` if captures differ. */
  async sendFile(params: {
    toUserId: string;
    contextToken: string;
    file: Buffer;
    fileName: string;
    itemType?: WeixinItemType;
    clientId?: string;
  }): Promise<SendMessageResponse> {
    const name = params.fileName?.trim();
    if (!name) throw new ILinkError("fileName is required for sendFile");
    return this.sendMedia({
      toUserId: params.toUserId,
      contextToken: params.contextToken,
      data: params.file,
      mediaType: UPLOAD_MEDIA_TYPE.file,
      itemType: params.itemType ?? ITEM_TYPE.file,
      itemField: "file_item",
      itemExtra: { file_name: name, file_size: params.file.length },
      clientId: params.clientId,
    });
  }

  /**
   * Download and decrypt one inbound attachment from the WeChat CDN.
   *
   * The body is read with a running byte cap rather than `arrayBuffer()`, since
   * Content-Length is advisory and buffering first would defeat the limit.
   */
  async downloadMedia(
    ref: InboundMediaRef,
    opts: { maxBytes?: number } = {},
  ): Promise<DownloadedMedia> {
    const maxBytes = Math.max(1024, opts.maxBytes ?? this.mediaMaxBytes);
    if (ref.cipherSize && ref.cipherSize > maxBytes) {
      throw new ILinkError(
        `media too large: ${ref.cipherSize} > ${maxBytes} bytes`,
      );
    }

    // `full_url` comes off an inbound message, so it is only honoured when it
    // points at the CDN. Otherwise rebuild from our own base — see
    // isAllowedMediaUrl for why an unchecked fetch here would be an SSRF.
    const fullUrlOk =
      Boolean(ref.fullUrl) &&
      isAllowedMediaUrl(ref.fullUrl!, {
        cdnBaseUrl: this.cdnBaseUrl,
        extraHosts: this.mediaHostAllowlist,
      });
    if (ref.fullUrl && !fullUrlOk && !ref.encryptQueryParam) {
      throw new ILinkError(
        `media full_url host not allowed: ${ILinkClient.hostOf(ref.fullUrl)}`,
      );
    }
    const url = fullUrlOk
      ? ref.fullUrl!
      : ref.encryptQueryParam
        ? buildCdnDownloadUrl(this.cdnBaseUrl, ref.encryptQueryParam)
        : undefined;
    if (!url) {
      throw new ILinkError(
        "media ref has neither full_url nor encrypt_query_param",
      );
    }

    const raw = await this.fetchBounded(url, maxBytes);

    let data = raw;
    if (ref.aesKey && ref.encryptType !== 0) {
      try {
        data = decryptAes128Ecb(raw, parseAesKey(ref.aesKey));
      } catch (err) {
        // Some payloads carry a vestigial aes_key over plaintext bytes. Accept
        // the undecrypted body only when it actually sniffs as media.
        if (!sniffMediaMime(raw)) {
          throw new ILinkError(
            `media decrypt failed: ${(err as Error).message}`,
          );
        }
        data = raw;
      }
    }

    return {
      kind: ref.kind,
      data,
      mime: sniffMediaMime(data),
      fileName: ref.fileName,
    };
  }

  private async fetchBounded(url: string, maxBytes: number): Promise<Buffer> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { method: "GET", signal: ctrl.signal });
      if (!res.ok) {
        throw new ILinkError(
          `CDN download failed: HTTP ${res.status}`,
          undefined,
          res.status,
        );
      }
      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new ILinkError(
          `media too large: ${declared} > ${maxBytes} bytes`,
        );
      }

      const body = res.body;
      if (!body) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > maxBytes) {
          throw new ILinkError(
            `media too large: ${buf.length} > ${maxBytes} bytes`,
          );
        }
        return buf;
      }

      const reader = body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new ILinkError(`media too large: exceeded ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (err instanceof ILinkError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ILinkError(
          `CDN download timed out after ${this.timeoutMs}ms`,
          undefined,
          undefined,
          { aborted: true },
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Host only, for an error message that must not echo a full attacker URL. */
  private static hostOf(raw: string): string {
    try {
      return new URL(raw).hostname || "(none)";
    } catch {
      return "(unparseable)";
    }
  }

  private requireToken(): void {
    if (!this.botToken) {
      throw new ILinkError("bot_token is required; complete QR login first");
    }
  }

  private async getJson<T>(
    url: string,
    auth: boolean,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: buildILinkHeaders(auth ? this.botToken : undefined),
        signal: ctrl.signal,
      });
      const body = (await res.json()) as T & {
        ret?: number;
        errcode?: number;
        errmsg?: string;
      };
      if (!res.ok) {
        throw new ILinkError(
          `HTTP ${res.status}`,
          body.ret,
          body.errcode,
          body,
        );
      }
      return body;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ILinkError(
          `request timed out after ${timeoutMs}ms`,
          undefined,
          undefined,
          { aborted: true },
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: buildILinkHeaders(this.botToken),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = (await res.json()) as T & {
        ret?: number;
        errcode?: number;
        errmsg?: string;
      };
      if (!res.ok) {
        throw new ILinkError(
          `HTTP ${res.status}`,
          data.ret,
          data.errcode,
          data,
        );
      }
      // Session expired often surfaces as ret/errcode -14
      if (data.ret !== undefined && data.ret !== 0) {
        throw new ILinkError(
          data.errmsg ?? `iLink ret=${data.ret}`,
          data.ret,
          data.errcode,
          data,
        );
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface ExtractTextOptions {
  /**
   * Use the transcript WeChat/iLink produced for a voice message (default true).
   *
   * When false a voice note yields no text and is handled as unreadable media
   * instead — the operator switch for deployments that would rather not act on
   * WeChat's own speech-to-text.
   */
  includeVoiceTranscript?: boolean;
}

/** Extract plain text from a Weixin message (text + voice ASR if present). */
export function extractText(
  msg: WeixinMessage,
  opts: ExtractTextOptions = {},
): string | null {
  const includeVoice = opts.includeVoiceTranscript !== false;
  const items = msg.item_list ?? [];
  const parts: string[] = [];
  for (const item of items) {
    if (item.type === 1 && item.text_item?.text) {
      parts.push(item.text_item.text);
      continue;
    }
    // Voice: some payloads include transcribed text under voice/audio items
    if (item.type === 3) {
      if (!includeVoice) continue;
      const voice = item as {
        voice_item?: { text?: string; voice_text?: string };
        text_item?: { text?: string };
      };
      const t =
        voice.voice_item?.text ||
        voice.voice_item?.voice_text ||
        voice.text_item?.text;
      if (t) parts.push(t);
    }
  }
  return parts.length ? parts.join("\n") : null;
}

/** True when message has only non-text media without usable transcript. */
export function isMediaOnlyWithoutText(
  msg: WeixinMessage,
  opts: ExtractTextOptions = {},
): boolean {
  return !extractText(msg, opts) && (msg.item_list?.length ?? 0) > 0;
}

/** User inbound messages are typically message_type === 1. */
export function isUserInbound(msg: WeixinMessage): boolean {
  return msg.message_type === 1;
}
