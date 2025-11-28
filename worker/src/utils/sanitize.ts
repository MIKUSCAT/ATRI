const TIMESTAMP_PREFIX_PATTERN = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+ATRI\]\s*/gm;
const GENERIC_BRACKET_PREFIX_PATTERN = /^\[[^\]]+\]\s*/gm;

export function sanitizeText(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(TIMESTAMP_PREFIX_PATTERN, '')
    .replace(GENERIC_BRACKET_PREFIX_PATTERN, '')
    .trim();
}
