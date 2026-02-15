import { api } from '../lib/api.js';
import { $ } from '../lib/dom.js';
import { runBusy, setText } from '../lib/ui.js';

function setToolsOut(text) {
  $('toolsOut').textContent = String(text || '');
}

async function testDb() {
  setText($('toolsMsg'), '');
  setToolsOut('');
  const data = await api('/admin/api/tools/db');
  setText($('toolsMsg'), 'DB OK');
  setToolsOut(JSON.stringify(data, null, 2));
}

async function testOpenaiModels() {
  setText($('toolsMsg'), '');
  setToolsOut('');
  const data = await api('/admin/api/tools/openai-models');
  setText($('toolsMsg'), '聊天上游 OK');
  setToolsOut(JSON.stringify(data, null, 2));
}

async function testDiary() {
  setText($('toolsMsg'), '');
  setToolsOut('');
  const data = await api('/admin/api/tools/diary');
  setText($('toolsMsg'), '日记上游 OK');
  setToolsOut(JSON.stringify(data, null, 2));
}

async function testEmbeddings() {
  setText($('toolsMsg'), '');
  setToolsOut('');
  const data = await api('/admin/api/tools/embeddings', {
    method: 'POST',
    body: JSON.stringify({ text: 'hello' })
  });
  setText($('toolsMsg'), 'Embeddings OK');
  setToolsOut(JSON.stringify(data, null, 2));
}

export function initToolsHandlers() {
  $('testDbBtn').addEventListener('click', () => {
    runBusy($('testDbBtn'), () => testDb().catch(e => setText($('toolsMsg'), String(e?.message || e))), '测试中...');
  });
  $('testOpenaiBtn').addEventListener('click', () => {
    runBusy($('testOpenaiBtn'), () => testOpenaiModels().catch(e => setText($('toolsMsg'), String(e?.message || e))), '测试中...');
  });
  $('testDiaryBtn').addEventListener('click', () => {
    runBusy($('testDiaryBtn'), () => testDiary().catch(e => setText($('toolsMsg'), String(e?.message || e))), '测试中...');
  });
  $('testEmbeddingsBtn').addEventListener('click', () => {
    runBusy($('testEmbeddingsBtn'), () => testEmbeddings().catch(e => setText($('toolsMsg'), String(e?.message || e))), '测试中...');
  });
}
