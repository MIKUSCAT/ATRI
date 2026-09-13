import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export interface WebResult {
  title: string;
  snippet: string;
  url: string;
  fetchedAt: string;
  publishedAt: string | null;
}
export interface WebTools {
  search(query: string, freshness?: string, signal?: AbortSignal): Promise<WebResult[]>;
  open(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; content: string; fetchedAt: string }>;
}
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{0,3}:/i.test(address) &&
    !address.toLowerCase().startsWith('2001:db8:')
  );
}
export async function fetchPublicPage(
  rawUrl: string,
  signal?: AbortSignal,
  redirects = 0,
): Promise<{ url: string; content: string; fetchedAt: string }> {
  const url = new URL(rawUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !['', '80', '443'].includes(url.port)
  )
    throw new Error('只可读取公开 HTTP/HTTPS 网页');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error('该地址不是允许读取的公开网页');
  const address = addresses[0];
  const combined = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
    : AbortSignal.timeout(10000);
  const result = await new Promise<{ body: string; location?: string; status: number }>(
    (resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          signal: combined,
          headers: {
            'user-agent': 'ATRI/2.0 (web reader)',
            accept: 'text/html,text/plain,application/json',
            'accept-encoding': 'identity',
          },
          lookup: ((_host: unknown, options: any, callback: any) =>
            options?.all
              ? callback(null, [address])
              : callback(null, address.address, address.family)) as any,
        },
        (response) => {
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            response.resume();
            resolve({ body: '', location: response.headers.location, status: response.statusCode });
            return;
          }
          const mime = String(response.headers['content-type'] ?? '');
          if (!/text\/|application\/(json|xhtml)/i.test(mime)) {
            response.resume();
            reject(new Error('该地址没有返回可读取的文本'));
            return;
          }
          let length = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > 1024 * 1024) {
              request.destroy(new Error('网页超过读取上限'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () =>
            resolve({
              body: Buffer.concat(chunks).toString('utf8'),
              status: response.statusCode ?? 0,
            }),
          );
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      request.end();
    },
  );
  if (result.location) {
    if (redirects >= 3) throw new Error('网页重定向次数过多');
    return fetchPublicPage(new URL(result.location, url).href, signal, redirects + 1);
  }
  if (result.status < 200 || result.status >= 300)
    throw new Error(`网页读取失败（HTTP ${result.status}）`);
  const content = result.body
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12000);
  return { url: url.href, content, fetchedAt: new Date().toISOString() };
}
export class TavilyWeb implements WebTools {
  constructor(
    private readonly getKey: () => string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async search(query: string, freshness?: string, signal?: AbortSignal): Promise<WebResult[]> {
    const apiKey = this.getKey();
    if (!apiKey) throw new Error('联网搜索尚未配置，请在管理页填写搜索密钥');
    if (!query.trim() || query.length > 600) throw new Error('查询文本长度无效');
    const response = await this.fetcher('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
        ...(['d', 'w', 'm', 'y'].includes(freshness ?? '') ? { time_range: freshness } : {}),
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`联网搜索失败（HTTP ${response.status}）`);
    const json = (await response.json()) as {
      results?: { title?: string; content?: string; url?: string; published_date?: string }[];
    };
    const fetchedAt = new Date().toISOString();
    return (json.results ?? [])
      .filter((r) => /^https?:\/\//.test(r.url ?? ''))
      .slice(0, 5)
      .map((r) => ({
        title: r.title ?? '',
        snippet: (r.content ?? '').slice(0, 1500),
        url: r.url!,
        fetchedAt,
        publishedAt: r.published_date ?? null,
      }));
  }
  open(url: string, signal?: AbortSignal) {
    return fetchPublicPage(url, signal);
  }
}
