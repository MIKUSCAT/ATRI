const TIMESTAMP_PREFIX_PATTERN = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+ATRI\]\s*/gm;
const GENERIC_BRACKET_PREFIX_PATTERN = /^\[[^\]]+\]\s*/gm;
const CHAT_TIME_PREFIX_PATTERN = /^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/gm;
const CHAT_TIME_PREFIX_PLAIN_PATTERN = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[-—–:|]\s*)?/gm;
const CHAT_TIME_PREFIX_PAREN_PATTERN = /^\s*[（(]\d{1,2}:\d{2}(?::\d{2})?[)）]\s*/gm;
const CHAT_TIME_PREFIX_BRACKET_CN_PATTERN = /^\s*【\d{1,2}:\d{2}(?::\d{2})?】\s*/gm;
const DATE_TIME_PREFIX_BRACKET_PATTERN =
  /^\s*\[\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\]\s*/gm;
const DATE_TIME_PREFIX_PLAIN_PATTERN =
  /^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:[-—–:|]\s*)?/gm;
const DATE_TIME_PREFIX_CN_PATTERN =
  /^\s*\d{4}年\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*(?:[-—–:|]\s*)?/gm;
const ISO_TIMESTAMP_BRACKET_PATTERN =
  /^\s*\[\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})(?:\s+[^\]]+)?\]\s*/gm;

export function sanitizeText(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(TIMESTAMP_PREFIX_PATTERN, '')
    .replace(GENERIC_BRACKET_PREFIX_PATTERN, '')
    .trim();
}

export function sanitizeAssistantReply(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(TIMESTAMP_PREFIX_PATTERN, '')
    .replace(ISO_TIMESTAMP_BRACKET_PATTERN, '')
    .replace(DATE_TIME_PREFIX_BRACKET_PATTERN, '')
    .replace(DATE_TIME_PREFIX_PLAIN_PATTERN, '')
    .replace(DATE_TIME_PREFIX_CN_PATTERN, '')
    .replace(CHAT_TIME_PREFIX_PATTERN, '')
    .replace(CHAT_TIME_PREFIX_PAREN_PATTERN, '')
    .replace(CHAT_TIME_PREFIX_BRACKET_CN_PATTERN, '')
    .replace(CHAT_TIME_PREFIX_PLAIN_PATTERN, '')
    .trim();
}
