import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store, createBackup, restoreBackup } from '@atri/db';
import { fixture, temporary, cleanup } from './helpers.js';

test('重启区分已确认发送与发送状态未知', (t) => {
  const f = fixture(t);
  const msg = f.store.ingest('p1', 'a', '你好').message;
  f.store.enqueueChat('p1', msg.seq, 0);
  const task = f.store.claim('p1')!;
  f.store.saveReply(
    task,
    [
      { type: 'text', text: '第一句' },
      { type: 'text', text: '第二句' },
    ],
    [],
  );
  const [one, two] = f.store.pendingDeliveries('p1');
  f.store.markDelivery(one.id, 'sent');
  f.store.startDelivery(two.id);
  f.store.recover();
  assert.equal(f.store.issues().deliveries[0].status, 'uncertain');
  assert.equal(f.store.issues().deliveries[0].content, '第二句');
  assert.equal(f.store.issues().deliveries[0].address, '同学');
  assert.equal(f.store.readyPeers().length, 0);
  assert.equal(f.store.history('p1').filter((m) => m.role === 'assistant').length, 1);
});
test('数据库快照包含被引用的附件，恢复不自动重发旧消息', async (t) => {
  const f = fixture(t);
  f.store.setSetting('config', { proactiveEnabled: true, model: 'saved-model' });
  mkdirSync(join(f.directory, 'media'));
  writeFileSync(join(f.directory, 'media', 'sample.png'), 'sample');
  const msg = f.store.ingest('p1', 'a', '图片', [
    { kind: 'image', path: 'media/sample.png', mime: 'image/png' },
  ]).message;
  f.store.enqueueChat('p1', msg.seq, 0);
  const task = f.store.claim('p1')!;
  f.store.saveReply(task, [{ type: 'text', text: '看到了' }], []);
  const result = await createBackup(f.store, f.directory);
  assert.ok(result.manifest.files.some((file) => file.path === 'media/sample.png'));
  const restored = join(temporary(t), 'restored');
  restoreBackup(result.directory, restored);
  const store = new Store(join(restored, 'atri.db'));
  cleanup(t, () => store.close());
  assert.equal(store.history('p1')[0].content, '图片');
  assert.equal(store.readyPeers().length, 0);
  assert.equal(store.issues().deliveries[0].status, 'uncertain');
  assert.deepEqual(store.getSetting('config', {}), {
    proactiveEnabled: false,
    model: 'saved-model',
  });
  assert.throws(() => restoreBackup(result.directory, restored), /空的数据目录/);
});
test('备份校验拒绝被修改的数据库', async (t) => {
  const f = fixture(t),
    backup = await createBackup(f.store, f.directory);
  writeFileSync(join(backup.directory, 'atri.db'), 'invalid');
  assert.throws(() => restoreBackup(backup.directory, join(temporary(t), 'restore')), /校验失败/);
});
