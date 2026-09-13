/** iLink Bot message item types (community reverse-engineering + plugin behavior). */
export type WeixinItemType = 1 | 2 | 3 | 4 | 5;

/**
 * Message item type numbers.
 *
 * 1 (text) and 2 (image) are confirmed — both are constructed on the outbound
 * path against the live server. 3 (voice) is confirmed inbound only: getupdates
 * delivers voice as `{ type: 3, voice_item: {...} }` (see extractText and
 * extract-text.test.ts). 4 and 5 are **inferred** and have never been observed;
 * `ITEM_TYPE.video` / `ITEM_TYPE.file` are the send-side guess and can be
 * overridden per call (see ILinkClient.sendMedia).
 */
export const ITEM_TYPE = {
  text: 1,
  image: 2,
  voice: 3,
  video: 4,
  file: 5,
} as const satisfies Record<string, WeixinItemType>;

/** getuploadurl media_type */
export type UploadMediaType = 1 | 2 | 3 | 4; // IMG | VID | FILE | VOICE

/** getuploadurl media_type by kind (confirmed by the getuploadurl contract). */
export const UPLOAD_MEDIA_TYPE = {
  image: 1,
  video: 2,
  file: 3,
  voice: 4,
} as const satisfies Record<string, UploadMediaType>;

export interface TextItem {
  text?: string;
}

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

/**
 * Voice item. `text` / `voice_text` carry the transcript iLink produced on its
 * side — when present we use it and never touch the audio, which matters
 * because WeChat voice bytes are SILK/AMR and no OpenAI-compatible ASR endpoint
 * accepts those containers.
 */
export interface VoiceItem {
  media?: CDNMedia;
  aeskey?: string;
  url?: string;
  text?: string;
  voice_text?: string;
  mid_size?: number;
  voice_size?: number;
  voice_length?: number;
  duration_ms?: number;
}

export interface VideoItem {
  media?: CDNMedia;
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  duration_ms?: number;
}

export interface FileItem {
  media?: CDNMedia;
  aeskey?: string;
  url?: string;
  file_name?: string;
  file_size?: number;
  mid_size?: number;
}

export interface MessageItem {
  type: WeixinItemType;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  video_item?: VideoItem;
  file_item?: FileItem;
  // other media fields optional
  [key: string]: unknown;
}

/** Media kinds we can pull off an inbound message. */
export type MediaKind = "image" | "voice" | "video" | "file";

/**
 * One downloadable attachment on an inbound message.
 * `encryptQueryParam` + `aesKey` are what the WeChat CDN needs; `fullUrl` wins
 * when the item already carries an absolute URL.
 */
export interface InboundMediaRef {
  kind: MediaKind;
  /** Index in the original `item_list` (stable id within one message) */
  index: number;
  encryptQueryParam?: string;
  aesKey?: string;
  encryptType?: number;
  fullUrl?: string;
  /** Ciphertext size hint from the item (mid_size); used to reject early */
  cipherSize?: number;
  fileName?: string;
  /** iLink-side transcript (voice only) */
  transcript?: string;
}

/** Decrypted inbound media plus the mime we sniffed from the bytes. */
export interface DownloadedMedia {
  kind: MediaKind;
  data: Buffer;
  /** Sniffed from magic bytes; null when unrecognized */
  mime: string | null;
  fileName?: string;
}

export interface WeixinMessage {
  from_user_id?: string;
  to_user_id?: string;
  message_type?: number;
  message_state?: number;
  context_token?: string;
  item_list?: MessageItem[];
  create_time_ms?: number;
  group_id?: string;
  [key: string]: unknown;
}

export interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  [key: string]: unknown;
}

export interface GetUploadUrlResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  /** Preferred: full pre-signed upload URL */
  upload_full_url?: string;
  /** Fallback: encrypted param for CDN base + /upload */
  upload_param?: string;
  [key: string]: unknown;
}

/**
 * `1` starts the "对方正在输入中" indicator, `2` clears it.
 * The server also expires it on its own, but an explicit stop is what makes the
 * indicator disappear the moment the reply lands instead of lingering.
 */
export type TypingStatus = 1 | 2;

/**
 * `/ilink/bot/getconfig` — issues the `typing_ticket` required by sendtyping.
 * The ticket is per WeChat user and stays valid ~24h.
 */
export interface GetConfigResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  typing_ticket?: string;
  [key: string]: unknown;
}

export interface QrcodeResponse {
  qrcode?: string;
  qrcode_img_content?: string;
  qrcode_url?: string;
  ret?: number;
  errmsg?: string;
  [key: string]: unknown;
}

export interface QrcodeStatusResponse {
  status?: string;
  bot_token?: string;
  baseurl?: string;
  account_id?: string;
  ilink_bot_id?: string;
  ret?: number;
  errmsg?: string;
  [key: string]: unknown;
}

export interface ILinkClientOptions {
  /** Default https://ilinkai.weixin.qq.com */
  baseUrl?: string;
  /** Bot token after QR login */
  botToken?: string;
  /** channel_version sent in base_info */
  channelVersion?: string;
  /** fetch timeout for non-long-poll requests (ms) */
  timeoutMs?: number;
  /** long-poll timeout (ms); server holds ~35s */
  longPollTimeoutMs?: number;
  /**
   * WeChat media CDN base (fallback when getuploadurl omits upload_full_url).
   * Default https://novac2c.cdn.weixin.qq.com/c2c
   */
  cdnBaseUrl?: string;
  /**
   * How long a cached `typing_ticket` is reused. Server-side validity is ~24h;
   * default 20h leaves headroom so we refresh before the server expires it.
   */
  typingTicketTtlMs?: number;
  /**
   * Cap on cached typing tickets (one per WeChat peer). A worker can lease
   * hundreds of bots with many peers each, so the map is bounded like
   * rate-limit.ts rather than left to grow.
   */
  typingTicketMaxEntries?: number;
  /** Hard cap for a single inbound media download (default 12MB). */
  mediaMaxBytes?: number;
  /**
   * Extra hosts an inbound `full_url` may point at, on top of the CDN base and
   * WeChat/QQ CDN subdomains. Inbound URLs are attacker-influenced, so anything
   * outside this set is ignored in favour of rebuilding from `cdnBaseUrl`.
   */
  mediaHostAllowlist?: string[];
}

export interface UploadedMedia {
  filekey: string;
  downloadEncryptedQueryParam: string;
  aesKey: Buffer;
  rawSize: number;
  cipherSize: number;
}
