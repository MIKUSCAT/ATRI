import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from './index.js';

interface Manifest {
  format: 1;
  version: string;
  createdAt: string;
  files: { path: string; sha256: string; size: number }[];
  messages: number;
  diaries: number;
}
function hash(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function safePath(root: string, path: string) {
  const full = resolve(root, path);
  if (
    !full.startsWith(resolve(root) + sep) ||
    !/^atri\.db$|^admin-secret\.txt$|^(media|custom)\/[a-zA-Z0-9_.-]+$/.test(path)
  )
    throw new Error('备份包含无效文件路径');
  return full;
}
export async function createBackup(
  store: Store,
  dataDir: string,
): Promise<{ directory: string; manifest: Manifest }> {
  const directory = join(
    dataDir,
    'backups',
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
  );
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, 'atri.db');
  await store.backup(destination);
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  const files = new Set<string>(['atri.db']);
  try {
    for (const row of snapshot.prepare("SELECT media FROM messages WHERE status<>'deleted'").all())
      for (const item of JSON.parse(String(row.media)))
        if (typeof item.path === 'string') files.add(item.path);
    const custom = snapshot.prepare("SELECT value FROM settings WHERE key='stickers:custom'").get();
    if (custom) for (const item of JSON.parse(String(custom.value))) files.add(item.file);
    if (existsSync(join(dataDir, 'admin-secret.txt'))) files.add('admin-secret.txt');
    for (const file of files) {
      if (file === 'atri.db') continue;
      const source = safePath(dataDir, file),
        target = safePath(directory, file);
      if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink())
        throw new Error('备份源不是普通文件');
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    const manifest: Manifest = {
      format: 1,
      version: '2.0.0',
      createdAt: new Date().toISOString(),
      files: [...files].map((path) => ({
        path,
        sha256: hash(safePath(directory, path)),
        size: lstatSync(safePath(directory, path)).size,
      })),
      messages: Number(
        snapshot.prepare("SELECT count(*) AS n FROM messages WHERE status<>'deleted'").get()!.n,
      ),
      diaries: Number(
        snapshot.prepare("SELECT count(*) AS n FROM diary_sections WHERE status='active'").get()!.n,
      ),
    };
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      mode: 0o600,
    });
    return { directory, manifest };
  } finally {
    snapshot.close();
  }
}
export function restoreBackup(backupDir: string, dataDir: string) {
  const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8')) as Manifest;
  if (
    manifest.format !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.some((f) => f.path === 'atri.db')
  )
    throw new Error('备份格式无效');
  if (existsSync(dataDir) && readdirSync(dataDir).length)
    throw new Error('请停止服务，并恢复到一个空的数据目录');
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (seen.has(file.path)) throw new Error('备份含重复文件');
    seen.add(file.path);
    const source = safePath(backupDir, file.path);
    if (
      !lstatSync(source).isFile() ||
      lstatSync(source).isSymbolicLink() ||
      hash(source) !== file.sha256
    )
      throw new Error('备份文件校验失败');
    safePath(dataDir, file.path);
  }
  mkdirSync(dataDir, { recursive: true });
  for (const file of manifest.files) {
    const target = safePath(dataDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(safePath(backupDir, file.path), target);
  }
  const store = new Store(join(dataDir, 'atri.db'));
  try {
    store.transaction(() => {
      store.sql.exec(
        "UPDATE tasks SET state='failed',error='从备份恢复，请确认是否重试此历史任务' WHERE state IN ('queued','running'); UPDATE outbox SET status='uncertain',error='从备份恢复，请先确认微信是否收到' WHERE status IN ('pending','sending'); UPDATE messages SET status='uncertain' WHERE id IN (SELECT id FROM outbox WHERE status='uncertain');",
      );
      const config = store.getSetting<Record<string, unknown>>('config', {});
      store.setSetting('config', { ...config, proactiveEnabled: false });
    });
  } finally {
    store.close();
  }
  return manifest;
}
