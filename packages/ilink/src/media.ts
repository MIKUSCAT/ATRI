import type {
  CDNMedia,
  FileItem,
  ImageItem,
  InboundMediaRef,
  MediaKind,
  MessageItem,
  VideoItem,
  VoiceItem,
  WeixinMessage,
} from "./types.js";
import { ITEM_TYPE } from "./types.js";

/**
 * Identify decrypted media from its magic bytes.
 *
 * This is identification, not validation — the upload-side gate for
 * user-submitted images lives in apps/api sticker-security.ts and is
 * deliberately much stricter. Here we only need to know what we just pulled off
 * the WeChat CDN so we can decide whether a vision model can read it.
 */
export function sniffMediaMime(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null;

  const startsWith = (bytes: number[], offset = 0): boolean => {
    if (buf.length < offset + bytes.length) return false;
    for (let i = 0; i < bytes.length; i++) {
      if (buf[offset + i] !== bytes[i]) return false;
    }
    return true;
  };
  const ascii = (offset: number, len: number): string =>
    buf.length >= offset + len
      ? buf.subarray(offset, offset + len).toString("latin1")
      : "";

  // ── Images ──
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF") {
    const form = ascii(8, 4);
    if (form === "WEBP") return "image/webp";
    if (form === "WAVE") return "audio/wav";
  }
  if (ascii(0, 2) === "BM") return "image/bmp";

  // ── Audio ──
  // WeChat voice is SILK, sometimes with a single leading byte before the tag.
  if (ascii(0, 6) === "#!SILK") return "audio/silk";
  if (ascii(1, 6) === "#!SILK") return "audio/silk";
  if (ascii(0, 5) === "#!AMR") return "audio/amr";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  // MPEG audio frame sync (11 set bits)
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }

  // ── ISO-BMFF container: brand decides audio vs video ──
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
    return "video/mp4";
  }

  // ── Other video / documents ──
  if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) return "application/zip";

  return null;
}

/** Mimes an OpenAI-compatible vision model can accept as an image_url data URI. */
const VISION_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function isVisionMime(mime: string | null | undefined): boolean {
  return Boolean(mime && VISION_MIMES.has(mime));
}

/** Pull the CDN coordinates off a media-bearing item, whichever shape it uses. */
function readMedia(
  item: ImageItem | VoiceItem | VideoItem | FileItem | undefined,
): {
  media?: CDNMedia;
  aesKey?: string;
  fullUrl?: string;
  cipherSize?: number;
} {
  if (!item) return {};
  const media = item.media;
  return {
    media,
    // media.aes_key is the modern field; item-level `aeskey` is the older shape
    // and some payloads only carry that one.
    aesKey: media?.aes_key ?? item.aeskey,
    fullUrl: media?.full_url ?? item.url,
    cipherSize: item.mid_size,
  };
}

function refFromItem(
  item: MessageItem,
  index: number,
  kind: MediaKind,
): InboundMediaRef | null {
  const sub =
    kind === "image"
      ? item.image_item
      : kind === "voice"
        ? item.voice_item
        : kind === "video"
          ? item.video_item
          : item.file_item;
  const { media, aesKey, fullUrl, cipherSize } = readMedia(sub);
  const encryptQueryParam = media?.encrypt_query_param;
  // Nothing to fetch: neither an absolute URL nor CDN coordinates.
  if (!encryptQueryParam && !fullUrl) return null;

  const transcript =
    kind === "voice"
      ? (item.voice_item?.text || item.voice_item?.voice_text || "").trim() ||
        undefined
      : undefined;

  return {
    kind,
    index,
    encryptQueryParam,
    aesKey,
    encryptType: media?.encrypt_type,
    fullUrl,
    cipherSize:
      typeof cipherSize === "number" && cipherSize > 0 ? cipherSize : undefined,
    fileName:
      kind === "file" ? item.file_item?.file_name?.trim() || undefined : undefined,
    transcript,
  };
}

const ALL_KINDS: readonly MediaKind[] = ["image", "voice", "video", "file"];

const KIND_BY_ITEM_TYPE = new Map<number, MediaKind>([
  [ITEM_TYPE.image, "image"],
  [ITEM_TYPE.voice, "voice"],
  [ITEM_TYPE.video, "video"],
  [ITEM_TYPE.file, "file"],
]);

/**
 * Every downloadable attachment on an inbound message, in item order.
 *
 * The kind the item type claims is tried first, then the remaining kinds. Item
 * types 4/5 are inferred, so a mis-numbered item that clearly carries a media
 * sub-object must not be dropped on the type number alone. Each kind reads a
 * distinct `*_item` field, so probing cannot mislabel a well-formed item.
 */
export function extractMediaRefs(msg: WeixinMessage): InboundMediaRef[] {
  const out: InboundMediaRef[] = [];
  const items = msg.item_list ?? [];
  items.forEach((item, index) => {
    if (!item || item.type === ITEM_TYPE.text) return;
    const claimed = KIND_BY_ITEM_TYPE.get(item.type);
    const order = claimed
      ? [claimed, ...ALL_KINDS.filter((k) => k !== claimed)]
      : ALL_KINDS;
    for (const kind of order) {
      const ref = refFromItem(item, index, kind);
      if (ref) {
        out.push(ref);
        return;
      }
    }
  });
  return out;
}

/**
 * Hosts an inbound `full_url` may point at, beyond the configured CDN base.
 *
 * Inbound items arrive from getupdates, so `image_item.url` / `media.full_url`
 * are attacker-influenced in principle. Fetching them unchecked would be a
 * server-side request forgery primitive against whatever this box can reach
 * (Redis, cloud metadata, sibling nodes) — and because a fetched image is handed
 * to a vision model whose description goes back to the sender, it would not even
 * be blind. The chatflow http node and the HF tools gateway already gate
 * outbound URLs this way; this keeps the media path consistent with them.
 */
const WECHAT_CDN_SUFFIXES = [".weixin.qq.com", ".qq.com"];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
]);

/** Literal private / loopback / link-local addresses, without a DNS lookup. */
function isPrivateHostLiteral(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(h) || h.endsWith(".local")) return true;
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc")) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * Whether an inbound `full_url` is safe to fetch.
 *
 * Accepts http(s) only, no embedded credentials, and only the configured CDN
 * host, a WeChat/QQ CDN subdomain, or an explicit extra host. Anything else
 * falls back to rebuilding the URL from our own CDN base, which is always safe.
 */
export function isAllowedMediaUrl(
  rawUrl: string,
  opts: { cdnBaseUrl?: string; extraHosts?: readonly string[] } = {},
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (!host || isPrivateHostLiteral(host)) return false;

  let cdnHost = "";
  if (opts.cdnBaseUrl) {
    try {
      cdnHost = new URL(opts.cdnBaseUrl).hostname.toLowerCase();
    } catch {
      /* ignore a malformed configured base */
    }
  }
  if (cdnHost && host === cdnHost) return true;
  if (WECHAT_CDN_SUFFIXES.some((s) => host.endsWith(s))) return true;
  return (opts.extraHosts ?? []).some((h) => host === h.trim().toLowerCase());
}

/** Human-facing label for a media kind (used in fallback replies / history). */
export function mediaKindLabel(kind: MediaKind): string {
  switch (kind) {
    case "image":
      return "图片";
    case "voice":
      return "语音";
    case "video":
      return "视频";
    case "file":
      return "文件";
  }
}
