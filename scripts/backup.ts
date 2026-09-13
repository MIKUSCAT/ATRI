import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Store, createBackup } from '@atri/db';
const dataDir = resolve(process.env.DATA_DIR || 'data');
if (!existsSync(join(dataDir, 'atri.db'))) throw new Error('数据目录中没有数据库');
const store = new Store(join(dataDir, 'atri.db'));
try {
  const result = await createBackup(store, dataDir);
  console.log(`备份完成：${result.directory}`);
} finally {
  store.close();
}
