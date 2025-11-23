const TIMESTAMP_PREFIX_PATTERN = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+ATRI\]\s*/gm;
const GENERIC_BRACKET_PREFIX_PATTERN = /^\[[^\]]+\]\s*/gm;

export function sanitizeText(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(TIMESTAMP_PREFIX_PATTERN, '')
    .replace(GENERIC_BRACKET_PREFIX_PATTERN, '')
    .trim();
}

export function sanitizeIdSegment(
  value: string | undefined,
  maxLength: number,
  fallback: string
): string {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .trim();
  if (!cleaned) {
    return fallback.slice(0, maxLength);
  }
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return cleaned.slice(-maxLength);
}

export function clampImportance(value?: number): number {
  const num = Number(value ?? 5);
  if (Number.isNaN(num)) {
    return 5;
  }
  return Math.min(10, Math.max(1, Math.round(num)));
}

export function normalizeCategory(value?: string): string {
  const text = String(value || '').toLowerCase();
  if (text.includes('偏') || text.includes('pref')) return '偏好';
  if (text.includes('计') || text.includes('plan')) return '计划';
  if (text.includes('情') || text.includes('emo')) return '情绪';
  if (text.includes('关') || text.includes('relation')) return '关系';
  return '其他';
}
