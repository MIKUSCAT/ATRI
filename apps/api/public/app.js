const $ = (id) => document.getElementById(id);
const textSettings = ['format', 'model', 'baseUrl', 'timeZone'];
const numberSettings = [
  'contextWindowTokens',
  'inputBudgetTokens',
  'maxOutputTokens',
  'requestTimeoutSeconds',
  'turnTimeoutSeconds',
  'diaryHour',
  'quietStart',
  'quietEnd',
  'proactiveAfterHours',
];
const formatNumber = (value) => (Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—');
const purposeName = (value) =>
  ({ chat: '对话', diary: '日记', notes: '话题整理', proactive: '主动联系' })[value] || value;
let authenticated = false,
  currentTab = 'overview',
  peers = [],
  lastTask = null,
  lastQr = '',
  noticeTimer,
  settingsVersion = 0,
  polling = false,
  chatSnapshot = '',
  journalSnapshot = '';
function show(message, error = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
  noticeTimer = setTimeout(
    () => {
      $('notice').hidden = true;
    },
    error ? 12000 : 6000,
  );
}
async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (response.status === 401) {
    authenticated = false;
    $('dashboard').hidden = true;
    $('login').hidden = false;
    $('logout').hidden = true;
    $('connection').textContent = '管理空间';
    $('connection').classList.remove('online');
  }
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, handler, classes = 'ghost small') {
  const node = el('button', label, classes);
  node.type = 'button';
  node.onclick = () => perform(handler, node);
  return node;
}
async function perform(action, node) {
  try {
    if (node) node.disabled = true;
    await action();
  } catch (error) {
    show(error.message, true);
  } finally {
    if (node) node.disabled = false;
  }
}
function empty(node, message) {
  node.replaceChildren(el('p', message, 'empty'));
}
const enc = encodeURIComponent;
async function loadPeers() {
  peers = await api('/api/peers');
  const wechatPeers = peers.filter((p) => p.channel === 'wechat');
  $('overview-peers').textContent = formatNumber(wechatPeers.filter((p) => p.approved).length);
  const target = $('peers');
  target.replaceChildren();
  if (!wechatPeers.length) empty(target, '扫码登录后，让同学发来第一条微信消息。');
  for (const peer of wechatPeers) {
    const row = el('div', undefined, 'row'),
      heading = el('div', undefined, 'row-title');
    heading.append(
      el('span', peer.address),
      button(peer.approved ? '暂停回复' : '允许使用', async () => {
        await api('/api/peers/' + enc(peer.id), 'PUT', { approved: !peer.approved });
        await loadPeers();
      }),
    );
    row.append(heading);
    target.append(row);
  }
  for (const id of ['chat-peer', 'journal-peer']) {
    const select = $(id),
      selected = select.value;
    select.replaceChildren();
    const preview = el('option', '本地试聊');
    preview.value = 'preview:default';
    select.append(preview);
    for (const peer of peers.filter((p) => p.id !== 'preview:default')) {
      const option = el('option', peer.address);
      option.value = peer.id;
      select.append(option);
    }
    if ([...select.options].some((o) => o.value === selected)) select.value = selected;
  }
}
async function status() {
  const state = await api('/api/status');
  if (!authenticated) return;
  $('connection').textContent = state.wechat.status === '已连接' ? '微信已连接' : '微信未连接';
  $('connection').classList.toggle('online', state.wechat.status === '已连接');
  $('wechat-state').textContent = state.wechat.status;
  $('overview-model').textContent = state.config.model;
  $('overview-calls').textContent = formatNumber(state.usage.reduce((sum, u) => sum + u.calls, 0));
  $('wechat-error').textContent =
    state.wechat.error || (!state.config.hasApiKey ? '请先在“调试与设置”中配置模型密钥。' : '');
  if (state.wechat.qrData) {
    if (lastQr !== state.wechat.qrData) {
      $('qr').src = state.wechat.qrData;
      lastQr = state.wechat.qrData;
    }
    $('qr').hidden = false;
  } else $('qr').hidden = true;
  const issues = $('issues');
  issues.replaceChildren();
  for (const task of state.issues.tasks) {
    const row = el('div', undefined, 'row');
    row.append(
      el('p', task.address + ' · ' + task.kind + '：' + task.error),
      button('重试任务', async () => {
        await api('/api/tasks/' + enc(task.id) + '/retry', 'POST');
        await status();
      }),
    );
    issues.append(row);
  }
  for (const delivery of state.issues.deliveries) {
    const row = el('div', undefined, 'row');
    row.append(
      el('p', delivery.address + ' · ' + new Date(delivery.created_at).toLocaleString(), 'hint'),
      el('p', delivery.content),
      el(
        'p',
        (delivery.status === 'uncertain' ? '送达情况不明' : '发送失败') + '：' + delivery.error,
      ),
    );
    const actions = el('div', undefined, 'actions');
    for (const [label, action] of [
      ['已在微信收到', 'confirmed'],
      ['重新发送', 'retry'],
      ['跳过', 'skip'],
    ])
      actions.append(
        button(label, async () => {
          if (action === 'retry' && !confirm('请先确认微信中没有收到这条消息，再重新发送。'))
            return;
          await api('/api/deliveries/' + enc(delivery.id), 'POST', { action });
          await status();
        }),
      );
    row.append(actions);
    issues.append(row);
  }
  if (!issues.childNodes.length) empty(issues, '目前没有需要处理的任务。');
  $('usage').replaceChildren(
    ...state.usage.map((u) => {
      const card = el('div', undefined, 'usage-card');
      card.append(
        el('strong', purposeName(u.purpose)),
        el('span', `${formatNumber(u.calls)} 次`, 'usage-count'),
        el(
          'p',
          `输入 ${formatNumber(u.input_tokens)} · 输出 ${formatNumber(u.output_tokens)} token\n平均 ${(u.average_ms / 1000).toFixed(2)} 秒`,
        ),
      );
      return card;
    }),
  );
  if (!state.usage.length) empty($('usage'), '开始对话后会记录模型调用与耗时。');
  $('recent-usage').replaceChildren(
    ...state.recentUsage.map((u) => {
      const row = el('div', undefined, 'recent-call');
      const heading = el('div');
      const time = el(
        'time',
        new Date(u.created_at).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
      time.dateTime = new Date(u.created_at).toISOString();
      heading.append(el('strong', purposeName(u.purpose)), time);
      row.append(
        heading,
        el(
          'p',
          `输入 ${formatNumber(u.input_tokens)} · 输出 ${formatNumber(u.output_tokens)} token`,
        ),
        el('p', `${(u.duration_ms / 1000).toFixed(2)} 秒 · ${u.address || '已删除的对话'}`),
      );
      return row;
    }),
  );
  if (!state.recentUsage.length) empty($('recent-usage'), '试聊一次后，这里会显示实际用量。');
}
async function loadSettings() {
  applySettings(await api('/api/config'));
}
function applySettings(c) {
  for (const key of [...textSettings, ...numberSettings]) $(key).value = c[key];
  $('temperature').value = c.temperature ?? '';
  for (const key of ['vision', 'proactiveEnabled']) $(key).checked = c[key];
  $('apiKey').placeholder = c.hasApiKey ? '已配置，留空保持原值' : '尚未配置';
  $('tavilyKey').placeholder = c.hasTavilyKey ? '已配置，留空保持原值' : '尚未配置';
  $('apiKey').value = '';
  $('tavilyKey').value = '';
  updateBudget();
}
function updateBudget() {
  const windowTokens = $('contextWindowTokens').valueAsNumber;
  const input = $('inputBudgetTokens').valueAsNumber;
  const output = $('maxOutputTokens').valueAsNumber;
  const used = input + output + 1024;
  const remaining = windowTokens - used;
  const complete = [windowTokens, input, output].every(Number.isFinite);
  const overBudget = complete && remaining < 0;
  $('budget-input').textContent = formatNumber(input);
  $('budget-output').textContent = formatNumber(output);
  $('budget-free').textContent = formatNumber(remaining);
  $('context-meter').max = windowTokens > 0 ? windowTokens : 1;
  $('context-meter').value = Number.isFinite(used) ? Math.max(0, used) : 0;
  $('context-meter').setAttribute(
    'aria-valuetext',
    complete
      ? `已分配 ${formatNumber(used)}，窗口 ${formatNumber(windowTokens)} token`
      : '请填写上下文参数',
  );
  $('inputBudgetTokens').setCustomValidity(
    overBudget ? '输入预算、输出上限和 1024 token 余量之和不能超过窗口。' : '',
  );
  $('turnTimeoutSeconds').setCustomValidity(
    $('turnTimeoutSeconds').valueAsNumber < $('requestTimeoutSeconds').valueAsNumber
      ? '整轮处理超时不能短于单次请求超时。'
      : '',
  );
  $('temperature').max = $('format').value === 'anthropic' ? '1' : '2';
  $('budget-note').textContent = !complete
    ? '填写窗口、输入预算和输出上限，即可查看可用空间。'
    : overBudget
      ? `超出窗口 ${formatNumber(-remaining)} token，请减少输入或输出预算。`
      : '文本和图片按估算计入预算；实际用量以模型返回值为准。';
  $('context-meter').closest('.budget-card').classList.toggle('invalid', overBudget);
}
function countPersona() {
  $('persona-count').textContent =
    `${formatNumber($('persona-content').value.length)} / 12,000 字符 · 保存后下次生成生效`;
}
async function loadChat() {
  const peer = $('chat-peer').value || 'preview:default';
  const history = await api('/api/peers/' + enc(peer) + '/history'),
    container = $('messages');
  if (peer !== ($('chat-peer').value || 'preview:default')) return;
  const snapshot = JSON.stringify([peer, history]);
  if (snapshot === chatSnapshot) return;
  chatSnapshot = snapshot;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  container.replaceChildren();
  if (!history.length) empty(container, '这里还没有对话。');
  for (const message of history) {
    const bubble = el('div', undefined, 'bubble ' + message.role);
    bubble.append(
      el(
        'div',
        (message.role === 'user' ? '对方' : '亚托莉') +
          ' · ' +
          new Date(message.created_at).toLocaleString(),
        'bubble-meta',
      ),
      el('div', message.content),
    );
    for (const media of message.media)
      if (media.description) bubble.append(el('p', media.description, 'hint'));
    bubble.append(
      button(
        '删除',
        async () => {
          if (!confirm('删除这条原文及依赖它的日记和记忆？微信中已经发送的消息仍会保留。')) return;
          await api('/api/peers/' + enc(peer) + '/records/' + enc(message.id), 'DELETE');
          await loadChat();
        },
        'ghost small danger',
      ),
    );
    container.append(bubble);
  }
  if (nearBottom) container.scrollTop = container.scrollHeight;
  $('chat-form').hidden = peer !== 'preview:default';
  $('chat-hint').textContent =
    peer === 'preview:default'
      ? '本地试聊不会发送到微信。'
      : '这里查看微信记录，直接在微信中与她交谈即可。';
}
async function loadJournal() {
  const peer = $('journal-peer').value || 'preview:default';
  const [diaries, memories] = await Promise.all([
    api('/api/peers/' + enc(peer) + '/diaries'),
    api('/api/peers/' + enc(peer) + '/memories'),
  ]);
  if (peer !== ($('journal-peer').value || 'preview:default')) return;
  const snapshot = JSON.stringify([peer, diaries, memories]);
  if (snapshot === journalSnapshot) return;
  journalSnapshot = snapshot;
  const journal = $('diaries');
  journal.replaceChildren();
  let day = '';
  for (const section of diaries) {
    const row = el('div', undefined, 'row');
    if (section.day !== day) {
      row.append(el('div', section.day, 'entry-date'));
      day = section.day;
    }
    row.append(el('div', section.content, 'entry'));
    const actions = el('div', undefined, 'actions');
    actions.append(
      button(`查看 ${section.sources.length} 条依据`, () => showSources(peer, section.sources)),
      button(
        '删除这一段',
        async () => {
          if (!confirm('删除这段日记及直接依赖它的记忆？')) return;
          await api('/api/peers/' + enc(peer) + '/records/' + enc(section.id), 'DELETE');
          await loadJournal();
        },
        'ghost small danger',
      ),
    );
    row.append(actions);
    journal.append(row);
  }
  if (!diaries.length) empty(journal, '有新的经历后，她会在设定的时间写日记。');
  const memory = $('memories');
  memory.replaceChildren();
  for (const item of memories) {
    const row = el('div', undefined, 'row');
    row.append(
      el('span', item.kind === 'stated' ? '对话中确认' : '主观理解', 'badge'),
      el('p', item.content),
    );
    const actions = el('div', undefined, 'actions');
    actions.append(
      button('查看依据', () => showSources(peer, item.sources)),
      button('更正', async () => {
        const content = prompt('把正确的信息写在这里：', item.content);
        if (!content?.trim()) return;
        await api('/api/peers/' + enc(peer) + '/memories/' + enc(item.id), 'PUT', { content });
        await loadJournal();
      }),
      button(
        '删除',
        async () => {
          if (!confirm('删除这条记忆？如果还想移除对应经历，请在对话中删除相关原文。')) return;
          await api('/api/peers/' + enc(peer) + '/records/' + enc(item.id), 'DELETE');
          await loadJournal();
        },
        'ghost small danger',
      ),
    );
    row.append(actions);
    memory.append(row);
  }
  if (!memories.length) empty(memory, '重要的偏好、约定和认识会留在这里。');
}
async function showSources(peer, ids) {
  const records = await api('/api/peers/' + enc(peer) + '/sources?ids=' + enc(ids.join(',')));
  const dialog = el('dialog');
  dialog.setAttribute('aria-label', '记忆的依据');
  dialog.append(el('h2', '记忆的依据'));
  for (const record of records) {
    const row = el('div', undefined, 'row');
    const name = record.kind === 'message' ? (record.role === 'user' ? '对方' : '亚托莉') : '日记';
    row.append(
      el('p', name + ' · ' + new Date(record.created_at).toLocaleString(), 'hint'),
      el('p', record.content, 'entry'),
    );
    if (record.sources?.length)
      row.append(button('继续查看原文', () => showSources(peer, record.sources)));
    dialog.append(row);
  }
  if (!records.length) dialog.append(el('p', '相关依据已删除或失效。'));
  dialog.append(button('关闭', () => dialog.close()));
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog);
  dialog.showModal();
}
async function loadStickers() {
  const stickers = await api('/api/stickers'),
    container = $('sticker-list');
  container.replaceChildren();
  for (const sticker of stickers) {
    const card = el('article', undefined, 'sticker-card'),
      img = document.createElement('img');
    img.src = '/api/stickers/' + enc(sticker.slug) + '/image';
    img.alt = sticker.description;
    card.append(
      img,
      el('strong', sticker.slug),
      el('p', sticker.description),
      button(sticker.disabled ? '启用' : '停用', async () => {
        await api(
          '/api/stickers/' + enc(sticker.slug) + (sticker.disabled ? '/enable' : ''),
          sticker.disabled ? 'POST' : 'DELETE',
        );
        await loadStickers();
      }),
    );
    container.append(card);
  }
}
async function enter() {
  await api('/api/config');
  authenticated = true;
  $('login').hidden = true;
  $('dashboard').hidden = false;
  $('logout').hidden = false;
  $('notice').hidden = true;
  await Promise.all([status(), loadPeers(), loadSettings()]);
  $('persona-content').value = (await api('/api/persona')).content;
  countPersona();
  await selectTab(currentTab);
}
async function selectTab(tab) {
  currentTab = tab;
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const selected = b.dataset.tab === tab;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  if (tab === 'chat') await loadChat();
  if (tab === 'journal') await loadJournal();
  if (tab === 'stickers') await loadStickers();
}
document
  .querySelectorAll('[data-tab]')
  .forEach((b) => (b.onclick = () => perform(() => selectTab(b.dataset.tab))));
document.querySelectorAll('[data-open]').forEach((b) => {
  b.onclick = () =>
    perform(async () => {
      await selectTab(b.dataset.open);
      $('tab-' + b.dataset.open).focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
});
const tablist = document.querySelector('[role="tablist"]');
const mobileNav = window.matchMedia('(max-width: 960px)');
function orientTabs() {
  tablist.setAttribute('aria-orientation', mobileNav.matches ? 'horizontal' : 'vertical');
}
orientTabs();
mobileNav.addEventListener('change', orientTabs);
tablist.onkeydown = (event) => {
  const tabs = [...tablist.querySelectorAll('[data-tab]')];
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  const previous = mobileNav.matches ? 'ArrowLeft' : 'ArrowUp';
  const next = mobileNav.matches ? 'ArrowRight' : 'ArrowDown';
  let target;
  if (event.key === previous) target = tabs[(index + tabs.length - 1) % tabs.length];
  if (event.key === next) target = tabs[(index + 1) % tabs.length];
  if (event.key === 'Home') target = tabs[0];
  if (event.key === 'End') target = tabs.at(-1);
  if (!target) return;
  event.preventDefault();
  target.focus();
  perform(() => selectTab(target.dataset.tab));
};
$('login-form').onsubmit = (e) => {
  e.preventDefault();
  perform(async () => {
    await api('/api/login', 'POST', { password: $('password').value });
    $('password').value = '';
    await enter();
  }, e.submitter);
};
$('logout').onclick = () =>
  perform(async () => {
    await api('/api/logout', 'POST');
    authenticated = false;
    $('dashboard').hidden = true;
    $('login').hidden = false;
    $('logout').hidden = true;
    $('connection').textContent = '管理空间';
    $('connection').classList.remove('online');
    $('notice').hidden = true;
    $('password').focus();
  });
$('wechat-login').onclick = () =>
  perform(async () => {
    await api('/api/wechat/login', 'POST');
    await status();
  });
$('wechat-logout').onclick = () =>
  perform(async () => {
    await api('/api/wechat/logout', 'POST');
    await status();
  });
$('backup').onclick = () =>
  perform(async () => {
    const result = await api('/api/backup', 'POST');
    show(`已备份 ${result.messages} 条消息，位置：${result.directory}`);
  }, $('backup'));
$('chat-peer').onchange = () => perform(loadChat);
$('journal-peer').onchange = () => perform(loadJournal);
$('chat-form').onsubmit = (e) => {
  e.preventDefault();
  perform(async () => {
    const result = await api('/api/chat', 'POST', {
      content: $('chat-input').value,
      eventId: crypto.randomUUID(),
    });
    lastTask = result.taskId;
    $('chat-input').value = '';
    await loadPeers();
    await loadChat();
  }, e.submitter);
};
$('write-diary').onclick = () =>
  perform(async () => {
    const result = await api('/api/peers/' + enc($('journal-peer').value) + '/diary', 'POST');
    show(result.taskId ? '已安排整理，稍后会显示新的日记。' : '目前没有尚未整理的经历。');
  });
$('persona-form').onsubmit = (e) => {
  e.preventDefault();
  perform(async () => {
    await api('/api/persona', 'PUT', { content: $('persona-content').value });
    show('人物设定已保存，下次生成时使用。');
  }, e.submitter);
};
$('persona-content').oninput = countPersona;
function settingsChanged() {
  settingsVersion++;
  $('settings-saved').textContent = '有尚未保存的修改。';
  updateBudget();
}
$('settings-form').oninput = settingsChanged;
$('settings-form').onchange = settingsChanged;
$('settings-form').onsubmit = (e) => {
  e.preventDefault();
  updateBudget();
  if (!e.target.reportValidity()) return;
  perform(async () => {
    const version = settingsVersion;
    const body = {};
    for (const key of [...textSettings, 'apiKey', 'tavilyKey']) body[key] = $(key).value;
    for (const key of numberSettings) body[key] = $(key).valueAsNumber;
    body.temperature = $('temperature').value === '' ? null : $('temperature').valueAsNumber;
    for (const key of ['vision', 'proactiveEnabled']) body[key] = $(key).checked;
    const saved = await api('/api/config', 'PUT', body);
    if (version === settingsVersion) {
      applySettings(saved);
      $('settings-saved').textContent = '已保存 · ' + new Date().toLocaleTimeString('zh-CN');
    }
    show(
      version === settingsVersion
        ? '参数已保存，下一次生成时使用。'
        : '已保存刚才提交的参数；新修改仍需保存。',
    );
    await status();
  }, e.submitter);
};
$('sticker-form').onsubmit = (e) => {
  e.preventDefault();
  perform(async () => {
    const file = $('sticker-file').files[0];
    if (!file || file.size > 3 * 1024 * 1024) throw new Error('请选择 3 MB 以内的图片');
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await api('/api/stickers', 'POST', {
      slug: $('sticker-slug').value,
      description: $('sticker-description').value,
      tags: $('sticker-tags')
        .value.split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      base64,
    });
    e.target.reset();
    await loadStickers();
    show('表情已加入目录。');
  }, e.submitter);
};
setInterval(async () => {
  if (!authenticated || document.hidden || polling) return;
  polling = true;
  try {
    await perform(async () => {
      await status();
      if (currentTab === 'overview') await loadPeers();
      if (currentTab === 'chat') {
        await loadChat();
        if (lastTask) {
          const task = await api('/api/tasks/' + enc(lastTask));
          if (task.state === 'failed') {
            show(task.error + '，可在“连接与运行”中重试。', true);
            lastTask = null;
          } else if (['done', 'superseded'].includes(task.state)) lastTask = null;
        }
      }
      if (currentTab === 'journal') await loadJournal();
    });
  } finally {
    polling = false;
  }
}, 2500);
enter().catch(() => {});
