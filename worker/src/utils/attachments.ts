import {
  ATTACHMENT_TYPES,
  AttachmentPayload,
  AttachmentType,
  ContentPart
} from '../types';
import { sanitizeText } from './sanitize';

export function prepareImageAttachment(imageUrl?: string | null): string | null {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return null;
  }
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  console.warn('[ATRI] 不支持的图片地址格式，需为 data: 或 http(s)');
  return null;
}

export function normalizeAttachmentType(raw: any): AttachmentType {
  const text = typeof raw === 'string' ? raw.toLowerCase() : '';
  return (ATTACHMENT_TYPES as readonly string[]).includes(text)
    ? (text as AttachmentType)
    : 'document';
}

export function normalizeAttachment(raw: any): AttachmentPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const type = normalizeAttachmentType(raw.type);
  const url = typeof raw.url === 'string' ? raw.url : '';
  if (!url) {
    return null;
  }
  return {
    type,
    url,
    mime: typeof raw.mime === 'string' ? raw.mime : undefined,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    sizeBytes: typeof raw.sizeBytes === 'number' ? raw.sizeBytes : undefined
  };
}

export function normalizeAttachmentList(raw: any): AttachmentPayload[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map(normalizeAttachment)
    .filter((item): item is AttachmentPayload => Boolean(item));
}

export function buildHistoryContentParts(
  rawContent: unknown,
  attachments: AttachmentPayload[]
): ContentPart[] {
  const parts: ContentPart[] = [];
  const base = typeof rawContent === 'string'
    ? rawContent
    : rawContent != null
      ? String(rawContent)
      : '';
  const sanitized = sanitizeText(base);
  if (sanitized) {
    parts.push({ type: 'text', text: sanitized });
  }
  for (const attachment of attachments) {
    if (attachment.type === 'image') {
      const prepared = prepareImageAttachment(attachment.url);
      if (prepared) {
        parts.push({ type: 'image_url', image_url: { url: prepared } });
      }
    } else {
      parts.push({
        type: 'text',
        text: `历史附件 ${attachment.name || '未命名'}：${attachment.url}`
      });
    }
  }
  return parts;
}

export function buildUserContentParts(params: {
  content: string;
  inlineImage?: string | null;
  imageAttachments: AttachmentPayload[];
  documentAttachments: AttachmentPayload[];
}): ContentPart[] {
  const parts: ContentPart[] = [];
  if (params.content) {
    const sanitized = sanitizeText(params.content);
    if (sanitized) {
      parts.push({ type: 'text', text: sanitized });
    }
  }
  const inlineImage = params.inlineImage ? prepareImageAttachment(params.inlineImage) : null;
  if (inlineImage) {
    parts.push({ type: 'image_url', image_url: { url: inlineImage } });
  }
  for (const attachment of params.imageAttachments) {
    const prepared = prepareImageAttachment(attachment.url);
    if (prepared) {
      parts.push({ type: 'image_url', image_url: { url: prepared } });
    }
  }
  for (const doc of params.documentAttachments) {
    parts.push({
      type: 'text',
      text: `用户上传的文件 ${doc.name || '未命名'}，地址：${doc.url}`
    });
  }
  return parts;
}
