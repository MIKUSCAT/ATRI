import { resolve } from 'node:path';
import { restoreBackup } from '@atri/db';
if (!process.argv[2]) throw new Error('用法：node dist/restore.js <备份目录>；DATA_DIR 指向空目录');
const dataDir = resolve(process.env.DATA_DIR || 'data');
const manifest = restoreBackup(resolve(process.argv[2]), dataDir);
console.log(`已恢复 ${manifest.messages} 条消息。历史待发送项已暂停，请在管理页确认。`);
