import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../apps/api/src/server.js';
import { Settings } from '../apps/api/src/config.js';
import { Stickers } from '../apps/api/src/stickers.js';
import { WeChatBridge, inboundKey } from '../apps/api/src/wechat.js';
import type { WeixinMessage } from '@atri/ilink';
import { fixture, cleanup } from './helpers.js';

const password = 'test-admin-password-only';
function server(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t),
    settings = new Settings(f.store, process.cwd(), {
      DATA_DIR: f.directory,
      ADMIN_PASSWORD: password,
      LLM_API_KEY: 'hidden-test-model-key',
      TAVILY_API_KEY: 'hidden-search-key',
      WECHAT_ALLOWED_PEERS: 'alice',
    }),
    stickers = new Stickers(process.cwd(), f.directory, f.store),
    bridge = new WeChatBridge(f.store, settings, stickers);
  const app = createServer({ store: f.store, settings, stickers, bridge, runtime: f.runtime });
  cleanup(t, async () => {
    bridge.stop();
    await app.close();
  });
  return { ...f, app, settings, bridge, headers: { authorization: 'Bearer ' + password } };
}
test('管理 API 需要登录，cookie 有保护属性，密钥和会话凭据不回显', async (t) => {
  const f = server(t);
  assert.equal((await f.app.inject('/api/config')).statusCode, 401);
  const login = await f.app.inject({ method: 'POST', url: '/api/login', payload: { password } });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers['set-cookie']);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const config = await f.app.inject({ url: '/api/config', headers: f.headers });
  assert.equal(config.statusCode, 200);
  assert.doesNotMatch(config.body, /hidden-test-model-key|hidden-search-key/);
  assert.equal(config.json().hasApiKey, true);
  f.store.ensurePeer('wechat:bot:alice', 'wechat', 'alice', 'private-token', true);
  const peers = await f.app.inject({ url: '/api/peers', headers: f.headers });
  assert.doesNotMatch(peers.body, /private-token/);
  assert.equal(
    (
      await f.app.inject({
        method: 'PUT',
        url: '/api/persona',
        headers: { ...f.headers, origin: 'https://evil.example' },
        payload: { content: 'test' },
      })
    ).statusCode,
    403,
  );
});
test('本地试聊使用真实应用队列，但与微信联系人记录隔离', async (t) => {
  const f = server(t);
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: f.headers,
    payload: { content: '你好', eventId: 'same-event' },
  });
  assert.equal(response.statusCode, 202);
  await f.runtime.drain();
  const history = await f.app.inject({
    url: '/api/peers/preview%3Adefault/history',
    headers: f.headers,
  });
  assert.equal(history.json().length, 2);
  await f.app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: f.headers,
    payload: { content: '你好', eventId: 'same-event' },
  });
  await f.runtime.drain();
  assert.equal(f.model.calls.length, 1);
  assert.equal(f.store.history('p1').length, 0);
});

test('管理页可核对旧原文，来源查询保持联系人隔离', async (t) => {
  const f = server(t);
  const own = f.store.ingest('p1', 'own', '自己的经历').message;
  f.store.ensurePeer('p2', 'preview', '另一个人', '', true);
  const other = f.store.ingest('p2', 'other', '别人的经历').message;
  const result = await f.app.inject({
    url: '/api/peers/p1/sources?ids=' + encodeURIComponent([own.id, other.id].join(',')),
    headers: f.headers,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().length, 1);
  assert.equal(result.json()[0].content, '自己的经历');
  assert.equal(result.json()[0].role, 'user');
});
test('模型配置校验是原子的，空密钥保持原值', async (t) => {
  const f = server(t);
  const valid = await f.app.inject({
    method: 'PUT',
    url: '/api/config',
    headers: f.headers,
    payload: { model: 'new-model', apiKey: '' },
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(f.settings.config().apiKey, 'hidden-test-model-key');
  const invalid = await f.app.inject({
    method: 'PUT',
    url: '/api/config',
    headers: f.headers,
    payload: { model: 'bad', timeZone: 'not/a/timezone' },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(f.settings.config().model, 'new-model');
});

test('网页调试参数写入配置，并传递给模型请求与对话运行时', async (t) => {
  const f = server(t);
  const parameters = {
    contextWindowTokens: 65536,
    inputBudgetTokens: 48000,
    maxOutputTokens: 8192,
    requestTimeoutSeconds: 90,
    turnTimeoutSeconds: 120,
    temperature: 0,
  };
  const saved = await f.app.inject({
    method: 'PUT',
    url: '/api/config',
    headers: f.headers,
    payload: parameters,
  });
  assert.equal(saved.statusCode, 200);
  const loaded = (await f.app.inject({ url: '/api/config', headers: f.headers })).json();
  for (const [key, value] of Object.entries(parameters)) assert.equal(loaded[key], value);
  const model = f.settings.model();
  assert.equal(model.contextWindowTokens, 65536);
  assert.equal(model.inputBudgetTokens, 48000);
  assert.equal(model.maxTokens, 8192);
  assert.equal(model.temperature, 0);
  assert.equal(model.timeoutMs, 90000);
  assert.equal(f.settings.runtime().contextTokens, 48000);
  assert.equal(f.settings.runtime().turnTimeoutMs, 120000);
  assert.equal(f.store.getSetting<any>('config', {}).maxOutputTokens, 8192);

  const reset = await f.app.inject({
    method: 'PUT',
    url: '/api/config',
    headers: f.headers,
    payload: { temperature: null },
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().temperature, null);
  assert.equal(Object.hasOwn(f.settings.model(), 'temperature'), false);
});

test('窗口不足、超时顺序和非法数值不会部分覆盖已保存的参数', async (t) => {
  const f = server(t);
  const before = f.settings.publicConfig();
  const invalid = [
    { contextWindowTokens: 8192 },
    { inputBudgetTokens: 64000, maxOutputTokens: 3000 },
    { requestTimeoutSeconds: 120, turnTimeoutSeconds: 60 },
    { maxOutputTokens: 128 },
    { inputBudgetTokens: '48000' },
    { requestTimeoutSeconds: 45.5 },
    { contextWindowTokens: null },
    { temperature: 2.5 },
    { format: 'anthropic', temperature: 1.2 },
  ];
  for (const payload of invalid) {
    const result = await f.app.inject({
      method: 'PUT',
      url: '/api/config',
      headers: f.headers,
      payload: { model: 'must-not-be-saved', ...payload },
    });
    assert.equal(result.statusCode, 400, JSON.stringify(payload));
    assert.deepEqual(f.settings.publicConfig(), before);
  }
});

test('调试页显示模型实际返回的 token 用量，且不会暴露密钥', async (t) => {
  const f = server(t);
  await f.app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: f.headers,
    payload: { content: '你好', eventId: 'usage-check' },
  });
  await f.runtime.drain();
  const response = await f.app.inject({ url: '/api/status', headers: f.headers });
  assert.equal(response.statusCode, 200);
  const recent = response.json().recentUsage;
  assert.equal(recent.length, 1);
  assert.equal(recent[0].purpose, 'chat');
  assert.equal(recent[0].input_tokens, 20);
  assert.equal(recent[0].output_tokens, 10);
  assert.ok(recent[0].duration_ms >= 0);
  assert.doesNotMatch(response.body, /hidden-test-model-key|hidden-search-key/);
});
test('微信重投忽略变化的 context_token，真正的新消息保留', async (t) => {
  const f = server(t);
  f.bridge.start(f.runtime);
  const message: WeixinMessage = {
    from_user_id: 'alice',
    to_user_id: 'bot',
    message_type: 1,
    context_token: 'ctx1',
    create_time_ms: 1700000000000,
    item_list: [{ type: 1, text_item: { text: '你好' } }],
  };
  const retry = { ...message, context_token: 'ctx2' };
  assert.equal(inboundKey(message, 'cursor1', 0), inboundKey(retry, 'cursor2', 1));
  assert.notEqual(
    inboundKey(message, '', 0),
    inboundKey({ ...message, create_time_ms: 1700000000001 }, '', 0),
  );
  f.bridge.receive('bot', message, 'cursor1', 0);
  f.bridge.receive('bot', retry, 'cursor2', 1);
  await f.runtime.drain();
  assert.equal(f.model.calls.length, 1);
  assert.equal(f.store.peer('wechat:bot:alice')!.context_token, 'ctx2');
});
test('内置图片可获取，未经允许的联系人不会自动回复', async (t) => {
  const f = server(t);
  const image = await f.app.inject({ url: '/api/stickers/happy/image', headers: f.headers });
  assert.equal(image.statusCode, 200);
  assert.match(String(image.headers['content-type']), /image\/png/);
  f.bridge.start(f.runtime);
  f.bridge.receive(
    'bot',
    {
      from_user_id: 'stranger',
      to_user_id: 'bot',
      message_type: 1,
      context_token: 'ctx',
      create_time_ms: 1700000000000,
      item_list: [{ type: 1, text_item: { text: '你好' } }],
    },
    'cursor',
    0,
  );
  await f.runtime.drain();
  assert.equal(f.model.calls.length, 0);
  assert.equal(f.store.peer('wechat:bot:stranger')!.approved, 0);
});
test('扫码登录保存账号会话，重复点击不会启动多次登录', async (t) => {
  const f = server(t);
  let qrCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    if (String(url).includes('get_bot_qrcode')) {
      qrCalls++;
      return Response.json({ qrcode: 'test-qr', qrcode_url: 'https://example.com/qr' });
    }
    if (String(url).includes('get_qrcode_status'))
      return Response.json({
        status: 'confirmed',
        bot_token: 'fixture-token',
        account_id: 'fixture-account',
        baseurl: 'https://ilinkai.weixin.qq.com',
      });
    throw new Error('意外网络请求');
  });
  f.bridge.login();
  f.bridge.login();
  for (let i = 0; i < 100 && f.bridge.status().status !== '已连接'; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(qrCalls, 1);
  assert.equal(f.bridge.status().status, '已连接');
  assert.equal(f.store.getSetting<any>('wechat:session', {}).accountId, 'fixture-account');
  assert.doesNotMatch(JSON.stringify(f.bridge.status()), /fixture-token/);
});
