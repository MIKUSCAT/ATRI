export function buildPublicUrl(request: Request, key: string): string {
  const url = new URL(request.url);
  url.pathname = `/media/${key}`;
  url.search = '';
  return url.toString();
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_');
}
