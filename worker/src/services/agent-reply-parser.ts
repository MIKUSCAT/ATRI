import { sanitizeText } from '../utils/sanitize';

export type ParsedReply = {
  reply: string;
  status: {
    label: string;
    pillColor: string;
    textColor: string;
    reason: string | null;
  } | null;
  intimacyDelta: number;
  rememberFacts: Array<{
    content: string;
    type?: string;
    importance?: number;
    confidence?: number;
  }>;
  forgetFacts: Array<{ factId?: string; content?: string }>;
};

export function parseStructuredReply(rawText: string): ParsedReply {
  const text = String(rawText || '').trim();
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

  console.warn('[ATRI] structured_reply_parse_failed', { sample: text.slice(0, 200) });
  return { ...empty, reply: sanitizeText(text).trim().slice(0, 4000) };
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

function sanitizeParsed(raw: any, fallbackText: string): ParsedReply {
  const out = emptyParsed();
  if (!raw || typeof raw !== 'object') {
    out.reply = sanitizeText(fallbackText).trim().slice(0, 4000);
    return out;
  }

  out.reply = sanitizeText(typeof raw.reply === 'string' ? raw.reply : '').trim().slice(0, 4000);

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

  const delta = Number(raw.intimacyDelta);
  if (Number.isFinite(delta)) out.intimacyDelta = Math.max(-50, Math.min(10, Math.trunc(delta)));

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
  return { reply: '', status: null, intimacyDelta: 0, rememberFacts: [], forgetFacts: [] };
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
