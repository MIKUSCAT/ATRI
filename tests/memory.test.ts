import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, FakeModel, completion } from './helpers.js';

test('来源隔离、重复来源幂等，明确纠正替代旧记忆', (t) => {
  const f = fixture(t);
  f.store.ensurePeer('p2', 'preview', '其他人', '', true);
  const old = f.store.ingest('p1', 'old', '我周五面试').message;
  const privateMessage = f.store.ingest('p2', 'private', '私人信息').message;
  f.store.addMemory(
    'p1',
    { content: '周五面试', kind: 'stated', sources: [old.id] },
    f.store.peer('p1')!.version,
  );
  f.store.addMemory(
    'p1',
    { content: '周五面试', kind: 'stated', sources: [old.id] },
    f.store.peer('p1')!.version,
  );
  f.store.addMemory(
    'p1',
    { content: '越界记录', kind: 'stated', sources: [privateMessage.id] },
    f.store.peer('p1')!.version,
  );
  assert.equal(f.store.memories('p1').length, 1);
  assert.equal(f.store.sources('p1', [privateMessage.id]).length, 0);
  const memory = f.store.memories('p1')[0];
  f.store.correctMemory('p1', memory.id, '周六面试');
  assert.deepEqual(
    f.store.memories('p1').map((m) => m.content),
    ['周六面试'],
  );
  assert.ok(!f.store.search('p1', '面试').some((h) => h.id === memory.id));
});
test('较早开始的日记任务不能覆盖后来的明确纠正', (t) => {
  const f = fixture(t);
  const source = f.store.ingest('p1', 'a', '周五面试').message;
  f.store.addMemory(
    'p1',
    { content: '周五面试', kind: 'stated', sources: [source.id] },
    f.store.peer('p1')!.version,
  );
  const old = f.store.memories('p1')[0];
  f.store.enqueue('p1', 'diary', 'day', { through: source.seq });
  const task = f.store.claim('p1')!;
  f.store.correctMemory('p1', old.id, '周六面试');
  f.store.saveDiary(
    task,
    '2026-09-12',
    [{ content: '当时说的是周五。', sources: [source.id] }],
    [
      {
        content: '还是周五面试',
        kind: 'stated',
        sources: [source.id],
        supersedes: [f.store.memories('p1')[0].id],
      },
    ],
  );
  assert.deepEqual(
    f.store.memories('p1').map((m) => m.content),
    ['周六面试'],
  );
  assert.equal(f.store.diaries('p1').length, 1);
});
test('日记增量处理，主观感受不会作为 confirmed fact，删除来源同步失效', async (t) => {
  const model = new FakeModel((messages) => {
    const source = [...messages.at(-1)!.content.matchAll(/\[来源 ([^\s|]+) \|/g)].map((m) => m[1]);
    return completion({
      sections: [{ content: '我当时以为他有点失落，这还只是我的猜测。', sources: source }],
      memoryUpdates: [],
    });
  });
  const f = fixture(t, model),
    at = Date.parse('2026-09-12T10:00:00Z');
  const message = f.store.ingest('p1', 'a', '今天很累', [], at).message;
  f.runtime.queueDiary('p1', true);
  await f.runtime.drain();
  assert.equal(f.store.diaries('p1').length, 1);
  assert.equal(f.runtime.queueDiary('p1', true), undefined);
  const diary = f.store.diaries('p1')[0];
  f.store.addMemory(
    'p1',
    { content: '他很失落', kind: 'stated', sources: [diary.id] },
    f.store.peer('p1')!.version,
  );
  assert.equal(f.store.memories('p1').length, 0);
  f.store.addMemory(
    'p1',
    { content: '我当时猜测他有些失落', kind: 'interpretation', sources: [diary.id] },
    f.store.peer('p1')!.version,
  );
  f.store.sql.prepare('UPDATE peers SET notes=? WHERE id=?').run('他今天失落', 'p1');
  f.store.forget('p1', message.id);
  assert.equal(f.store.diaries('p1').length, 0);
  assert.equal(f.store.memories('p1').length, 0);
  assert.equal(f.store.peer('p1')!.notes, '');
  assert.equal(f.store.search('p1', '失落').length, 0);
});
test('日记内容进入后续对话的召回，无独立自我模型读取路径', async (t) => {
  const f = fixture(t);
  const source = f.store.ingest('p1', 'a', '我面试时很紧张').message;
  f.store.enqueue('p1', 'diary', 'day', { through: source.seq });
  const task = f.store.claim('p1')!;
  f.store.saveDiary(
    task,
    '2026-09-12',
    [{ content: '听他讲应聘工作的面试，我想先陪他把紧张说出来。', sources: [source.id] }],
    [],
  );
  f.runtime.accept('p1', 'b', '还记得我应聘工作的事情吗');
  await f.runtime.drain();
  assert.match(f.model.calls[0].messages[0].content, /先陪他把紧张说出来/);
});
test('上下文笔记仅在需要时整理，并保留原文', async (t) => {
  const model = new FakeModel(() => completion({ notes: '当前在讨论考试准备。' }));
  const f = fixture(t, model);
  const one = f.store.ingest('p1', '1', '准备数学考试').message;
  const two = f.store.ingest('p1', '2', '更正：周六考试').message;
  f.store.enqueue('p1', 'notes', 'notes', { through: two.seq });
  await f.runtime.drain();
  assert.match(f.store.peer('p1')!.notes, /考试准备/);
  assert.equal(f.store.peer('p1')!.notes_until, two.seq);
  assert.equal(f.store.sources('p1', [one.id, two.id]).length, 2);
});
test('全文检索可以找回近期窗口之外的旧事', (t) => {
  const f = fixture(t);
  const old = f.store.ingest('p1', 'old', '我最喜欢乌龙茶', [], 1).message;
  f.store.transaction(() => {
    for (let i = 0; i < 5100; i++) f.store.ingest('p1', 'daily-' + i, '日常闲聊 ' + i, [], i + 2);
  });
  assert.ok(f.store.search('p1', '乌龙茶').some((hit) => hit.id === old.id));
});

test('召回保留说话人、认识类型和原始依据', async (t) => {
  const f = fixture(
    t,
    new FakeModel(() => completion({ messages: ['你说你喜欢茶。'], memoryUpdates: [] })),
  );
  f.runtime.accept('p1', 'tea', '我喜欢喝茶');
  await f.runtime.drain();
  const records = f.store.history('p1');
  const hits = f.store.search('p1', '茶', 6, 'message');
  assert.deepEqual(hits.map((h) => h.role).sort(), ['assistant', 'user']);
  assert.equal(f.store.sources('p1', [records[1].id])[0].role, 'assistant');
  f.store.addMemory(
    'p1',
    { content: '喝茶也许能让对方放松', kind: 'interpretation', sources: [records[0].id] },
    f.store.peer('p1')!.version,
  );
  const memory = f.store.search('p1', '喝茶', 1, 'memory')[0];
  assert.equal(memory.memory_kind, 'interpretation');
  assert.deepEqual(memory.sources, [records[0].id]);
});

test('删除来源会清理超过列表上限的全部日记与记忆', (t) => {
  const f = fixture(t);
  const source = f.store.ingest('p1', 'a', '原始经历').message;
  f.store.transaction(() => {
    for (let i = 0; i < 505; i++) {
      f.store.enqueue('p1', 'diary', 'day-' + i, { through: source.seq });
      const task = f.store.claim('p1')!;
      f.store.saveDiary(
        task,
        '2026-09-12',
        [{ content: '依赖原文的日记 ' + i, sources: [source.id] }],
        [],
      );
      f.store.addMemory(
        'p1',
        {
          content: '依赖原文的认识 ' + i,
          kind: 'interpretation',
          sources: ['diary:' + task.id + ':0'],
        },
        f.store.peer('p1')!.version,
      );
    }
  });
  f.store.forget('p1', source.id);
  assert.equal(f.store.diaries('p1').length, 0);
  assert.equal(f.store.memories('p1').length, 0);
  assert.equal(f.store.search('p1', '依赖原文').length, 0);
});

test('很多短消息超过近期窗口时也会整理笔记', async (t) => {
  const f = fixture(
    t,
    new FakeModel((_messages, tools) =>
      completion(
        tools.length
          ? { messages: ['接着聊。'], memoryUpdates: [] }
          : { notes: '我们在聊生活小事。' },
      ),
    ),
  );
  f.store.transaction(() => {
    for (let i = 0; i < 220; i++) f.store.ingest('p1', 'short-' + i, '嗯');
  });
  const old = f.store.historyAfter('p1', 0)[0];
  f.runtime.accept('p1', 'last', '继续');
  await f.runtime.drain();
  assert.ok(f.store.peer('p1')!.notes_until > 0);
  assert.match(f.store.peer('p1')!.notes, /生活小事/);
  assert.equal(f.store.sources('p1', [old.id]).length, 1);
});
