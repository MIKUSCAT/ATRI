import { sanitizeIdSegment } from './sanitize';

export function generateVectorId(prefix: string, userId: string, raw?: string): string {
  const userPart = sanitizeIdSegment(userId, 12, 'user');
  const uniquePart = sanitizeIdSegment(raw ?? crypto.randomUUID(), 36, 'mem');
  let id = `${prefix}:${userPart}:${uniquePart}`;
  if (id.length > 64) {
    id = id.slice(0, 64);
  }
  return id;
}
