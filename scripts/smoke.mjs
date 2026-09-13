import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'atri-smoke-'));
const password = 'smoke-test-password-only';
let calls = 0,
  child,
  logs = '',
  lastRequest;
const upstream = createServer(async (request, response) => {
  try {
    let data = '';
    for await (const chunk of request) data += chunk;
    const body = JSON.parse(data);
    lastRequest = body;
    calls++;
    const sourceText = body.messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    const sources = [...new Set([...sourceText.matchAll(/\[来源 ([^\s|]+) \|/g)].map((m) => m[1]))];
    const diary = body.messages[0].content.includes('"sections"');
    const result = diary
      ? {
          sections: [{ content: '今天听他说起喜欢的茶，我认真记住了。', sources }],
          memoryUpdates: [],
        }
      : {
          messages: ['我记住啦，你喜欢喝茶。'],
          memoryUpdates: [{ content: '喜欢喝茶', kind: 'stated', sources: sources.slice(-1) }],
        };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(result) } }],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      }),
    );
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
try {
  const modelPort = upstream.address().port;
  child = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_ROOT: process.cwd(),
      DATA_DIR: directory,
      HOST: '127.0.0.1',
      PORT: '0',
      ADMIN_PASSWORD: password,
      LLM_BASE_URL: `http://127.0.0.1:${modelPort}`,
      LLM_API_KEY: 'smoke-only',
      LLM_MODEL: 'fixture-model',
      LLM_FORMAT: 'openai',
      LLM_VISION: 'false',
      TAVILY_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('服务启动超时：' + logs)), 15000);
    const receive = (chunk) => {
      logs += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(logs);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', (chunk) => (logs += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`服务提前退出 ${code}: ${logs}`));
    });
  });
  async function api(path, method = 'GET', body) {
    const response = await fetch(base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + password,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  }
  async function task(id) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const result = await api('/api/tasks/' + encodeURIComponent(id));
      if (result.state === 'done') return;
      if (['failed', 'superseded'].includes(result.state)) throw new Error(JSON.stringify(result));
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('任务未完成');
  }
  assert.equal((await fetch(base + '/healthz')).status, 200);
  const page = await fetch(base + '/');
  assert.match(await page.text(), /日记与对话/);
  assert.equal((await fetch(base + '/api/config')).status, 401);
  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  const saved = await api('/api/config', 'PUT', {
    contextWindowTokens: 32768,
    inputBudgetTokens: 18000,
    maxOutputTokens: 1024,
    temperature: 0.4,
    requestTimeoutSeconds: 30,
    turnTimeoutSeconds: 60,
  });
  assert.equal(saved.maxOutputTokens, 1024);
  assert.equal((await api('/api/config')).inputBudgetTokens, 18000);
  for (const file of ['/atri.webp', '/avatar.webp']) {
    const asset = await fetch(base + file);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'image/webp');
  }
  const chat = await api('/api/chat', 'POST', { content: '我喜欢喝茶', eventId: 'smoke-message' });
  await task(chat.taskId);
  const history = await api('/api/peers/preview%3Adefault/history');
  assert.equal(history.length, 2);
  assert.equal(history[1].role, 'assistant');
  assert.equal(calls, 1);
  assert.equal(lastRequest.max_tokens, 1024);
  assert.equal(lastRequest.temperature, 0.4);
  await api('/api/chat', 'POST', { content: '我喜欢喝茶', eventId: 'smoke-message' });
  assert.equal(calls, 1);
  const memories = await api('/api/peers/preview%3Adefault/memories');
  assert.equal(memories.length, 1);
  const diary = await api('/api/peers/preview%3Adefault/diary', 'POST');
  await task(diary.taskId);
  assert.equal(lastRequest.max_tokens, 1024);
  assert.equal((await api('/api/peers/preview%3Adefault/diaries')).length, 1);
  assert.equal((await api('/api/status')).recentUsage.length, 2);
  const backup = await api('/api/backup', 'POST');
  assert.equal(backup.messages, 2);
  console.log(
    'Smoke passed: built server, login, artwork, live model settings, durable chat, dedup, memory, diary, usage, backup.',
  );
  if (process.argv.includes('--serve')) {
    console.log(`UI test preview: ${base}`);
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        process.removeListener('SIGINT', done);
        process.removeListener('SIGTERM', done);
        resolve();
      };
      const timer = setTimeout(done, 20 * 60000);
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
    });
  }
} finally {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  const absolute = resolve(directory);
  if (!absolute.startsWith(resolve(tmpdir()) + sep + 'atri-smoke-'))
    throw new Error('测试清理路径无效');
  rmSync(absolute, { recursive: true, force: true });
}
