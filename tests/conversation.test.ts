import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryError } from '@atri/core';
import { estimateRequestTokens } from '@atri/llm';
import { FakeModel, completion, fixture, userSources } from './helpers.js';

test('已保存普通消息读取记忆，一次生成；重投不重复生成', async (t) => {
  const model = new FakeModel((messages) =>
    completion({ messages: ['我记得你更喜欢茶。'], memoryUpdates: [] }),
  );
  const f = fixture(t, model);
  const source = f.store.ingest('p1', 'old', '我喜欢茶，不喜欢咖啡').message;
  f.store.addMemory(
    'p1',
    { content: '喜欢喝茶', kind: 'stated', sources: [source.id] },
    f.store.peer('p1')!.version,
  );
  f.runtime.accept('p1', 'new', '你还记得我爱喝什么吗？');
  await f.runtime.drain();
  assert.equal(model.calls.length, 1);
  assert.match(model.calls[0].messages[0].content, /喜欢喝茶/);
  assert.equal(f.delivered.length, 1);
  f.runtime.accept('p1', 'new', '你还记得我爱喝什么吗？');
  await f.runtime.drain();
  assert.equal(model.calls.length, 1);
  assert.equal(f.store.history('p1').filter((m) => m.role === 'user').length, 2);
});
test('保存输入与聊天任务属于一个事务', (t) => {
  const f = fixture(t);
  f.store.enqueueChat = () => {
    throw new Error('模拟任务表写入失败');
  };
  assert.throws(() => f.runtime.accept('p1', 'event', '你好'), /写入失败/);
  assert.equal(f.store.history('p1').length, 0);
  assert.equal(f.store.peer('p1')!.version, 0);
});
test('新消息使尚未发送的旧草稿失效，按最新上下文重答', async (t) => {
  let started!: () => void, release!: () => void;
  const began = new Promise<void>((r) => (started = r)),
    gate = new Promise<void>((r) => (release = r));
  let count = 0;
  const model = new FakeModel(async () => {
    if (++count === 1) {
      started();
      await gate;
    }
    return completion({ messages: [count === 1 ? '周五加油' : '那就是周六。'], memoryUpdates: [] });
  });
  const f = fixture(t, model);
  f.runtime.accept('p1', 'a', '周五面试');
  await began;
  f.runtime.accept('p1', 'b', '说错了，是周六');
  release();
  await f.runtime.drain();
  assert.equal(f.delivered.length, 1);
  assert.equal(f.delivered[0].part.text, '那就是周六。');
  assert.match(model.calls[1].messages.map((m) => m.content).join('\n'), /说错了，是周六/);
});
test('部分发送失败后恢复既有气泡，不重新生成或重发成功气泡', async (t) => {
  const model = new FakeModel(() =>
    completion({
      messages: ['第一句', { type: 'sticker', slug: 'happy' }, '最后一句'],
      memoryUpdates: [],
    }),
  );
  const f = fixture(t, model);
  const sent: string[] = [];
  let fail = true;
  f.runtime.options.transport.send = async (_peer, part, id) => {
    if (part.type === 'sticker' && fail) {
      fail = false;
      throw new DeliveryError('明确发送失败', true);
    }
    sent.push(id);
  };
  f.runtime.accept('p1', 'a', '今天挺开心');
  await f.runtime.drain();
  assert.equal(sent.length, 1);
  assert.equal(model.calls.length, 1);
  const issue = f.store.issues().deliveries[0];
  assert.equal(issue.status, 'failed');
  f.store.markDelivery(String(issue.id), 'pending');
  await f.runtime.drain();
  assert.equal(sent.length, 3);
  assert.equal(new Set(sent).size, 3);
  assert.equal(model.calls.length, 1);
});
test('查询工具按需调用，来源和时间传回同一模型', async (t) => {
  const model = new FakeModel((messages) =>
    messages.some((m) => m.role === 'tool')
      ? completion({ messages: ['刚查到今天晴天：https://example.com/weather'], memoryUpdates: [] })
      : completion('', [
          { id: 'call-1', name: 'web_search', arguments: { query: '今天的天气', freshness: 'd' } },
        ]),
  );
  const f = fixture(t, model);
  f.runtime.accept('p1', 'a', '今天的天气怎么样');
  await f.runtime.drain();
  assert.equal(model.calls.length, 2);
  const result = model.calls[1].messages.find((m) => m.role === 'tool')!;
  assert.equal(result.callId, 'call-1');
  assert.match(result.content, /fetchedAt/);
  assert.match(result.content, /example.com/);
});
test('工具循环有界；没有永远运行的 agent 循环', async (t) => {
  const model = new FakeModel((_m, tools) =>
    tools.length
      ? completion('', [{ id: 'call', name: 'search_memory', arguments: { query: '过去' } }])
      : completion({ messages: ['目前没有找到那段经历。'], memoryUpdates: [] }),
  );
  const f = fixture(t, model);
  f.runtime.accept('p1', 'a', '记得过去的事吗');
  await f.runtime.drain();
  assert.equal(model.calls.length, 3);
  assert.equal(model.calls.at(-1)!.tools.length, 0);
});
test('明确偏好从回复写入，可供后续上下文使用', async (t) => {
  const model = new FakeModel((messages) =>
    completion({
      messages: ['好，我先听你说完。'],
      memoryUpdates: [
        {
          content: '倾诉时希望先倾听，再按需给建议',
          kind: 'stated',
          sources: userSources(messages).slice(-1),
        },
      ],
    }),
  );
  const f = fixture(t, model);
  f.runtime.accept('p1', 'a', '我吐槽时先听我说完');
  await f.runtime.drain();
  assert.equal(f.store.memories('p1').length, 1);
  assert.match(f.store.memories('p1')[0].content, /先倾听/);
});
test('较新的成功回应覆盖旧的失败任务，避免再次回复过时内容', async (t) => {
  let fail = true;
  const f = fixture(
    t,
    new FakeModel(() => {
      if (fail) throw new Error('模型离线');
      return completion({ messages: ['按新消息继续'], memoryUpdates: [] });
    }),
  );
  f.runtime.accept('p1', 'old', '旧问题');
  await f.runtime.drain();
  assert.equal(f.store.issues().tasks.length, 1);
  fail = false;
  f.runtime.accept('p1', 'new', '新的问题');
  await f.runtime.drain();
  assert.equal(f.store.issues().tasks.length, 0);
  assert.equal(f.delivered.length, 1);
});
test('输入状态接口很慢时不阻塞实际回复', async (t) => {
  const f = fixture(t);
  let finish!: () => void;
  const gate = new Promise<void>((r) => (finish = r));
  f.runtime.options.transport.typing = async (_peer, active) => {
    if (active) await gate;
  };
  f.runtime.accept('p1', 'a', '你好');
  await f.runtime.drain(500);
  assert.equal(f.delivered.length, 1);
  finish();
});

test('有限上下文优先保留本轮原话，笔记与自动召回按预算缩减', async (t) => {
  const f = fixture(t, undefined, { contextTokens: 16000 });
  const old = f.store.ingest('p1', 'old', '从前的偏好').message;
  for (let i = 0; i < 10; i++)
    f.store.addMemory(
      'p1',
      { content: '旧偏好' + i + '资料'.repeat(300), kind: 'stated', sources: [old.id] },
      f.store.peer('p1')!.version,
    );
  f.store.sql.prepare('UPDATE peers SET notes=? WHERE id=?').run('旧话题'.repeat(1000), 'p1');
  const latest = '这是本轮要回应的话。' + '细节'.repeat(2500);
  f.runtime.accept('p1', 'latest', latest);
  await f.runtime.drain();
  assert.equal(f.store.issues().tasks.length, 0);
  const messages = f.model.calls[0].messages;
  assert.ok(messages.at(-1)!.content.includes(latest));
  assert.ok(estimateRequestTokens(messages, f.model.calls[0].tools) <= f.config.contextTokens);
});

test('当前原话本身超过预算时明确失败，保留原文且不调用模型', async (t) => {
  const f = fixture(t, undefined, { contextTokens: 8192 });
  const latest = '这段话不能被偷偷截断。' + '细节'.repeat(3000);
  f.runtime.accept('p1', 'oversized', latest);
  await f.runtime.drain();
  assert.equal(f.model.calls.length, 0);
  assert.equal(f.delivered.length, 0);
  assert.equal(f.store.history('p1')[0].content, latest);
  assert.match(String(f.store.issues().tasks[0].error), /上下文预算/);
});
