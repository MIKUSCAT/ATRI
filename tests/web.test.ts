import test from 'node:test';
import assert from 'node:assert/strict';
import { TavilyWeb, fetchPublicPage, isPublicAddress, parseReply } from '@atri/core';

test('实时搜索保留 URL、抓取时间与可获得的发布时间', async () => {
  let body: any;
  const web = new TavilyWeb(() => 'test-key', (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({
      results: [
        {
          title: '官方通知',
          content: '更新',
          url: 'https://example.com/news',
          published_date: '2026-09-12',
        },
        { title: '另一个结果', content: '正文', url: 'https://example.com/other' },
      ],
    });
  }) as typeof fetch);
  const result = await web.search('最新通知', 'd');
  assert.equal(body.time_range, 'd');
  assert.equal(result[0].url, 'https://example.com/news');
  assert.equal(result[0].publishedAt, '2026-09-12');
  assert.equal(result[1].publishedAt, null);
  assert.ok(Date.parse(result[0].fetchedAt));
});
test('网页读取拒绝本机、私网和非 HTTP 资源', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.2',
    '172.16.1.1',
    '192.168.1.2',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fd00::1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  await assert.rejects(fetchPublicPage('http://127.0.0.1/test'), /公开网页/);
  await assert.rejects(fetchPublicPage('file:///etc/passwd'), /HTTP/);
  await assert.rejects(fetchPublicPage('https://user:password@example.com'), /HTTP/);
});
test('无效表情不会以协议文字发送，格式修复仅留给异常路径', () => {
  const reply = parseReply(
    '{"messages":["你好",{"type":"sticker","slug":"missing"}],"memoryUpdates":[]}',
    [],
  );
  assert.deepEqual(reply.parts, [{ type: 'text', text: '你好' }]);
  assert.throws(() => parseReply('{"messages":broken}', []));
  assert.equal(parseReply('自然的短回复', []).parts[0].text, '自然的短回复');
  assert.deepEqual(parseReply('{"messages":[],"memoryUpdates":[]}', [], true).parts, []);
  assert.throws(() => parseReply('{"messages":[],"memoryUpdates":[]}', []));
});
