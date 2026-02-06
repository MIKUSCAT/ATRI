import { api } from '../lib/api.js';
import { $ } from '../lib/dom.js';
import { setText } from '../lib/ui.js';

function fmtTs(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts || '');
  }
}

function normalizeLevel(level) {
  const value = String(level || '').trim().toLowerCase();
  if (value === 'error' || value === 'warn' || value === 'info' || value === 'debug') return value;
  return 'info';
}

function safeMetaText(meta) {
  if (meta == null) return '';
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
}

function makeSearchText(item) {
  const message = String(item?.message || '');
  const level = String(item?.level || '');
  const event = String(item?.meta?.event || '');
  const meta = safeMetaText(item?.meta || '');
  return `${message}\n${level}\n${event}\n${meta}`.toLowerCase();
}

function buildLogRow(item) {
  const level = normalizeLevel(item?.level);
  const row = document.createElement('article');
  row.className = `log-row log-row--${level}`;

  const head = document.createElement('div');
  head.className = 'log-row-head';

  const timeEl = document.createElement('span');
  timeEl.className = 'log-time';
  timeEl.textContent = fmtTs(item?.ts);

  const levelEl = document.createElement('span');
  levelEl.className = `log-level log-level--${level}`;
  levelEl.textContent = level.toUpperCase();

  head.appendChild(timeEl);
  head.appendChild(levelEl);

  const event = String(item?.meta?.event || '').trim();
  if (event) {
    const eventEl = document.createElement('span');
    eventEl.className = 'log-event';
    eventEl.textContent = event;
    head.appendChild(eventEl);
  }

  const msgEl = document.createElement('div');
  msgEl.className = 'log-row-msg';
  msgEl.textContent = String(item?.message || '').trim() || '(无消息)';

  row.appendChild(head);
  row.appendChild(msgEl);

  if (item?.meta != null) {
    const details = document.createElement('details');
    details.className = 'log-row-meta';

    const summary = document.createElement('summary');
    summary.textContent = '详情';

    const pre = document.createElement('pre');
    pre.textContent = safeMetaText(item.meta);

    details.appendChild(summary);
    details.appendChild(pre);
    row.appendChild(details);
  }

  return row;
}

export function createLogsController() {
  let streaming = false;
  let es = null;
  let logs = [];
  let levelFilter = 'all';
  let keywordFilter = '';
  let followScroll = true;

  function getFilteredLogs() {
    return (logs || []).filter((item) => {
      const level = normalizeLevel(item?.level);
      if (levelFilter !== 'all' && level !== levelFilter) return false;
      if (!keywordFilter) return true;
      return makeSearchText(item).includes(keywordFilter);
    });
  }

  function updateStatus(filteredCount) {
    const streamText = streaming ? '实时中' : '已停止实时';
    const followText = followScroll ? '自动跟随' : '暂停滚动';
    setText($('logsMsg'), `共 ${logs.length} 条，显示 ${filteredCount} 条（${streamText}，${followText}）`);
  }

  function render() {
    const filtered = getFilteredLogs();
    const box = $('logsBox');
    box.textContent = '';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'log-empty';
      empty.textContent = '没有匹配日志';
      box.appendChild(empty);
      updateStatus(0);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of filtered) {
      fragment.appendChild(buildLogRow(item));
    }
    box.appendChild(fragment);

    if (followScroll) {
      box.scrollTop = box.scrollHeight;
    }
    updateStatus(filtered.length);
  }

  async function load() {
    const data = await api('/admin/api/logs');
    logs = data.items || [];
    render();
  }

  function start() {
    if (streaming) return;
    streaming = true;
    setText($('toggleStreamBtn'), '停止实时');
    es = new EventSource('/admin/api/logs/stream');

    es.addEventListener('snapshot', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        logs = data.items || [];
        render();
      } catch {
        // ignore
      }
    });

    es.addEventListener('log', (ev) => {
      try {
        const item = JSON.parse(ev.data);
        logs.push(item);
        if (logs.length > 1000) logs = logs.slice(-1000);
        render();
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      setText($('logsMsg'), '实时连接波动，正在自动重连...');
    };
    render();
  }

  function stop() {
    if (!streaming) return;
    streaming = false;
    setText($('toggleStreamBtn'), '开始实时');
    try {
      es && es.close();
    } catch {
      // ignore
    }
    es = null;
    render();
  }

  function toggle() {
    if (streaming) stop();
    else start();
  }

  function setLevelFilter(value) {
    levelFilter = String(value || 'all').trim().toLowerCase() || 'all';
    render();
  }

  function setKeywordFilter(value) {
    keywordFilter = String(value || '').trim().toLowerCase();
    render();
  }

  function toggleFollowScroll() {
    followScroll = !followScroll;
    setText($('logsPauseBtn'), followScroll ? '暂停滚动' : '恢复滚动');
    if (followScroll) {
      const box = $('logsBox');
      box.scrollTop = box.scrollHeight;
    }
    render();
  }

  function clearLocalLogs() {
    logs = [];
    render();
  }

  return {
    load,
    start,
    stop,
    toggle,
    setLevelFilter,
    setKeywordFilter,
    toggleFollowScroll,
    clearLocalLogs
  };
}

export function initLogsHandlers(controller) {
  $('refreshLogsBtn').addEventListener('click', () => controller.load().catch(e => setText($('logsMsg'), String(e?.message || e))));
  $('toggleStreamBtn').addEventListener('click', () => controller.toggle());
  $('logsLevelFilter').addEventListener('change', (e) => controller.setLevelFilter(e?.target?.value || 'all'));
  $('logsKeyword').addEventListener('input', (e) => controller.setKeywordFilter(e?.target?.value || ''));
  $('logsPauseBtn').addEventListener('click', () => controller.toggleFollowScroll());
  $('logsClearBtn').addEventListener('click', () => controller.clearLocalLogs());
}
