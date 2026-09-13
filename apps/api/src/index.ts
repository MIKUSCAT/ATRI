import { resolve, join } from 'node:path';
import { Store } from '@atri/db';
import { HttpModel } from '@atri/llm';
import { Runtime, TavilyWeb } from '@atri/core';
import { Settings } from './config.js';
import { Stickers } from './stickers.js';
import { WeChatBridge } from './wechat.js';
import { createServer } from './server.js';

const root = resolve(process.env.APP_ROOT || process.cwd());
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const store = new Store(join(dataDir, 'atri.db'));
const settings = new Settings(store, root);
const stickers = new Stickers(root, dataDir, store);
const bridge = new WeChatBridge(store, settings, stickers, (message) => console.warn(message));
const runtime = new Runtime({
  store,
  config: () => settings.runtime(),
  model: () => new HttpModel(settings.model()),
  prompt: (name) => settings.prompt(name),
  stickers: () => stickers.list(),
  web: new TavilyWeb(() => settings.config().tavilyKey),
  timeZone: () => settings.config().timeZone,
  contextTokens: () => settings.runtime().contextTokens,
  turnTimeoutMs: () => settings.runtime().turnTimeoutMs,
  images: (message) => bridge.images(message),
  transport: bridge,
  log: (message, details) => console.warn(message, details),
});
const app = createServer({ store, settings, stickers, bridge, runtime });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  bridge.stop();
  await runtime.stop();
  await app.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
const address = await app.listen({ host: settings.host, port: settings.port });
runtime.start();
bridge.start(runtime);
console.log(`ATRI 已启动：${address}`);
if (!process.env.ADMIN_PASSWORD)
  console.log(`首次管理密码保存在 ${join(dataDir, 'admin-secret.txt')}，请在服务器上读取。`);
