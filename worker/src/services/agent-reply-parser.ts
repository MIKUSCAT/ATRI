import { sanitizeText, stripVisibleThinking } from '../utils/sanitize';

export type ParsedReply = {
  reply: string;
  status: {
    label: string;
    pillColor: string;
    textColor: string;
    reason: string | null;
  } | null;
  rememberFacts: Array<{
    content: string;
    type?: string;
    importance?: number;
    confidence?: number;
  }>;
  forgetFacts: Array<{ factId?: string; content?: string }>;
};

export function parseStructuredReply(rawText: string): ParsedReply {
  const originalText = String(rawText || '').trim();
  const text = stripVisibleThinking(originalText).trim();
  const empty = emptyParsed();
  if (!text) return empty;

  const direct = tryParse(text);
  if (direct) return sanitizeParsed(direct, text);

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const fenced = tryParse(fenceMatch[1]);
    if (fenced) return sanitizeParsed(fenced, text);
  }

  const braceExtracted = extractFirstJsonObject(text);
  if (braceExtracted) {
    const fromBrace = tryParse(braceExtracted);
    if (fromBrace) return sanitizeParsed(fromBrace, text);
  }

  const loose = parseLooseStructuredReply(text);
  if (loose) return sanitizeParsed(loose, text);

  console.warn('[ATRI] structured_reply_parse_failed', { sample: text.slice(0, 200) });
  const fallback = sanitizeText(text).trim();
  if (looksLikeBrokenStructuredReply(fallback)) return empty;
  return { ...empty, reply: fallback.slice(0, 4000) };
}

function tryParse(text: string): any | null {
  try { return JSON.parse(text); } catch { return null; }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseLooseStructuredReply(text: string): any | null {
  const jsonish = extractJsonishText(text);
  if (!jsonish) return null;

  const reply = extractLooseStringField(jsonish, 'reply', ['status', 'rememberFacts', 'forgetFacts']);
  if (reply == null || !reply.trim()) return null;

  const out: any = { reply };

  const statusText = extractLooseJsonValueField(jsonish, 'status');
  if (statusText) {
    const status = tryParse(statusText) ?? parseLooseStatusObject(statusText);
    if (status !== null) out.status = status;
  }

  const rememberFactsText = extractLooseJsonValueField(jsonish, 'rememberFacts');
  if (rememberFactsText) {
    const rememberFacts = tryParse(rememberFactsText);
    if (Array.isArray(rememberFacts)) out.rememberFacts = rememberFacts;
  }

  const forgetFactsText = extractLooseJsonValueField(jsonish, 'forgetFacts');
  if (forgetFactsText) {
    const forgetFacts = tryParse(forgetFactsText);
    if (Array.isArray(forgetFacts)) out.forgetFacts = forgetFacts;
  }

  return out;
}

function extractJsonishText(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenceMatch ? fenceMatch[1] : text;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  return source.slice(start, end + 1);
}

function extractLooseStringField(text: string, field: string, nextFields: string[]): string | null {
  const key = new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*"`, 'i');
  const match = key.exec(text);
  if (!match || match.index < 0) return null;

  const valueStart = match.index + match[0].length;
  let valueEnd = -1;

  for (const next of nextFields) {
    const delimiter = new RegExp(`"\\s*,\\s*"${escapeRegExp(next)}"\\s*:`, 'ig');
    delimiter.lastIndex = valueStart;
    const found = delimiter.exec(text);
    if (found && (valueEnd < 0 || found.index < valueEnd)) {
      valueEnd = found.index;
    }
  }

  if (valueEnd < 0) {
    valueEnd = findLooseStringEndBeforeObjectEnd(text, valueStart);
  }

  if (valueEnd < valueStart) return null;
  return decodeLooseJsonString(text.slice(valueStart, valueEnd));
}

function findLooseStringEndBeforeObjectEnd(text: string, start: number): number {
  for (let i = text.length - 1; i >= start; i--) {
    const c = text[i];
    if (c === '"' && !isEscaped(text, i)) return i;
    if (c === '}') continue;
    if (/\s/.test(c)) continue;
  }
  return -1;
}

function extractLooseJsonValueField(text: string, field: string): string | null {
  const key = new RegExp(`"${escapeRegExp(field)}"\\s*:`, 'i');
  const match = key.exec(text);
  if (!match || match.index < 0) return null;

  let start = match.index + match[0].length;
  while (start < text.length && /\s/.test(text[start])) start++;
  if (text.slice(start, start + 4).toLowerCase() === 'null') return 'null';

  const first = text[start];
  if (first === '{' || first === '[') {
    const end = findBalancedEnd(text, start, first, first === '{' ? '}' : ']');
    return end >= start ? text.slice(start, end + 1) : null;
  }

  if (first === '"') {
    const end = findStrictStringEnd(text, start + 1);
    return end > start ? text.slice(start, end + 1) : null;
  }

  const primitive = text.slice(start).match(/^(true|false|null|-?\d+(?:\.\d+)?)/i);
  return primitive ? primitive[0] : null;
}

function parseLooseStatusObject(text: string): any | null {
  const source = String(text || '').trim();
  if (!source.startsWith('{')) return null;

  const label = extractLooseStringField(source, 'label', ['pillColor', 'pill_color', 'textColor', 'text_color', 'reason']);
  const pillColor =
    extractLooseStringField(source, 'pillColor', ['textColor', 'text_color', 'reason'])
    ?? extractLooseStringField(source, 'pill_color', ['textColor', 'text_color', 'reason']);
  const textColor =
    extractLooseStringField(source, 'textColor', ['reason'])
    ?? extractLooseStringField(source, 'text_color', ['reason']);
  const reason = extractLooseStringField(source, 'reason', []);

  if (label == null && pillColor == null && textColor == null && reason == null) return null;
  return { label, pillColor, textColor, reason };
}

function findBalancedEnd(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findStrictStringEnd(text: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    if (text[i] === '"' && !isEscaped(text, i)) return i;
  }
  return -1;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashCount++;
  return slashCount % 2 === 1;
}

function decodeLooseJsonString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\' || i + 1 >= raw.length) {
      out += c;
      continue;
    }
    const next = raw[++i];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === '"' || next === '\\' || next === '/') out += next;
    else out += next;
  }
  return out;
}

function looksLikeBrokenStructuredReply(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  return trimmed.startsWith('{')
    || trimmed.startsWith('```')
    || /"reply"\s*:/.test(trimmed)
    || /<\s*(?:thinking|think)\b/i.test(trimmed);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeParsed(raw: any, fallbackText: string): ParsedReply {
  const out = emptyParsed();
  if (!raw || typeof raw !== 'object') {
    out.reply = sanitizeText(fallbackText).trim().slice(0, 4000);
    return out;
  }

  out.reply = sanitizeText(stripVisibleThinking(typeof raw.reply === 'string' ? raw.reply : '')).trim().slice(0, 4000);

  const s = raw.status;
  if (s && typeof s === 'object') {
    const label = String(s.label ?? '').trim();
    const pill = String(s.pillColor ?? s.pill_color ?? '').trim();
    const textColor = String(s.textColor ?? s.text_color ?? '').trim();
    if (label && isHexColor(pill)) {
      out.status = {
        label: label.slice(0, 40),
        pillColor: pill.slice(0, 16),
        textColor: isHexColor(textColor) ? textColor.slice(0, 16) : '#FFFFFF',
        reason: typeof s.reason === 'string' && s.reason.trim() ? s.reason.trim().slice(0, 200) : null
      };
    }
  }

  if (Array.isArray(raw.rememberFacts)) {
    for (const f of raw.rememberFacts) {
      if (!f || typeof f !== 'object') continue;
      const content = sanitizeText(String(f.content ?? '')).trim();
      if (!content) continue;
      out.rememberFacts.push({
        content: content.slice(0, 200),
        type: normalizeFactType(f.type),
        importance: clampInt(f.importance, 1, 10, 5),
        confidence: clampFloat(f.confidence, 0, 1, 0.7)
      });
    }
  }

  if (Array.isArray(raw.forgetFacts)) {
    for (const f of raw.forgetFacts) {
      if (!f || typeof f !== 'object') continue;
      const factId = String(f.factId ?? f.fact_id ?? '').trim();
      const content = sanitizeText(String(f.content ?? f.text ?? '')).trim();
      if (factId || content) out.forgetFacts.push({ factId: factId || undefined, content: content || undefined });
    }
  }

  return out;
}

function emptyParsed(): ParsedReply {
  return { reply: '', status: null, rememberFacts: [], forgetFacts: [] };
}

function isHexColor(v: string): boolean {
  return /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3}([0-9A-Fa-f]{2})?)?$/.test(String(v || '').trim());
}

function normalizeFactType(v: unknown): string | undefined {
  const allowed = ['profile', 'preference', 'taboo', 'promise', 'relationship', 'habit', 'important', 'other'];
  const t = String(v ?? '').trim().toLowerCase();
  return allowed.includes(t) ? t : undefined;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function clampFloat(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
