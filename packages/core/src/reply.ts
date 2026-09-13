import type { MemoryUpdate, ReplyPart } from '@atri/db';
export interface Sticker {
  slug: string;
  description: string;
  tags: string[];
  file: string;
}
export interface ParsedReply {
  parts: ReplyPart[];
  memories: MemoryUpdate[];
  descriptions: { messageId: string; description: string }[];
}
export function parseJson(text: string): any {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{'),
      end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('模型输出不是有效 JSON');
  }
}
export function parseMemories(value: unknown): MemoryUpdate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).flatMap((v) => {
    if (
      !v ||
      typeof v.content !== 'string' ||
      !Array.isArray(v.sources) ||
      !['stated', 'interpretation'].includes(v.kind)
    )
      return [];
    return [
      {
        content: v.content.slice(0, 800),
        kind: v.kind,
        sources: v.sources.filter((s: unknown) => typeof s === 'string').slice(0, 20),
        supersedes: Array.isArray(v.supersedes)
          ? v.supersedes.filter((s: unknown) => typeof s === 'string').slice(0, 12)
          : [],
      },
    ];
  });
}
export function parseReply(text: string, stickers: Sticker[], allowSkip = false): ParsedReply {
  let raw: any;
  try {
    raw = parseJson(text);
  } catch {
    if (!/[{}]|```|"messages"/.test(text) && text.trim())
      return {
        parts: [{ type: 'text', text: text.trim().slice(0, 6000) }],
        memories: [],
        descriptions: [],
      };
    throw new Error('回复格式无效');
  }
  if (!Array.isArray(raw.messages)) throw new Error('回复缺少 messages 数组');
  const parts: ReplyPart[] = raw.messages.slice(0, 6).flatMap((m: unknown) => {
    if (typeof m === 'string' && m.trim()) return [{ type: 'text', text: m.trim().slice(0, 6000) }];
    if (m && typeof m === 'object' && 'type' in m && m.type === 'sticker' && 'slug' in m) {
      const sticker = stickers.find((s) => s.slug === m.slug);
      if (sticker)
        return [{ type: 'sticker', slug: sticker.slug, description: sticker.description }];
    }
    return [];
  });
  if (!parts.length && !(allowSkip && raw.messages.length === 0))
    throw new Error('回复没有有效内容');
  const descriptions = Array.isArray(raw.imageDescriptions)
    ? raw.imageDescriptions
        .filter((d: any) => typeof d?.messageId === 'string' && typeof d?.description === 'string')
        .slice(0, 4)
        .map((d: any) => ({ messageId: d.messageId, description: d.description.slice(0, 800) }))
    : [];
  return { parts, memories: parseMemories(raw.memoryUpdates), descriptions };
}
