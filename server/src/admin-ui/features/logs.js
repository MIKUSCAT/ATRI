import { api } from '../lib/api.js';
import { $ } from '../lib/dom.js';
import { copyToClipboard, setText } from '../lib/ui.js';

const LOGS_FILTER_KEY = 'atri_admin_logs_filters_v2';

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

function fmtDayLabel(ts) {
  try {
    return new Date(ts).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    });
  } catch {
    return '未知日期';
  }
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

function appendHighlightedText(el, text, keyword) {
  const value = String(text || '');
  if (!keyword) {
    el.textContent = value;
    return;
  }

  const needle = keyword.toLowerCase();
  const haystack = value.toLowerCase();
  let cursor = 0;

  while (cursor < value.length) {
    const hit = haystack.indexOf(needle, cursor);
    if (hit === -1) {
      el.appendChild(document.createTextNode(value.slice(cursor)));
      break;
    }

    if (hit > cursor) {
      el.appendChild(document.createTextNode(value.slice(cursor, hit)));
    }

    const mark = document.createElement('mark');
    mark.className = 'log-highlight';
    mark.textContent = value.slice(hit, hit + needle.length);
    el.appendChild(mark);
    cursor = hit + needle.length;
  }
}

function loadFilterState() {
  try {
    const raw = localStorage.getItem(LOGS_FILTER_KEY);
    if (!raw) return { levelFilter: 'all', keywordFilter: '' };
    const parsed = JSON.parse(raw);
    const level = String(parsed?.levelFilter || 'all').toLowerCase();
    const keyword = String(parsed?.keywordFilter || '').trim();
    return {
      levelFilter: ['all', 'error', 'warn', 'info', 'debug'].includes(level) ? level : 'all',
      keywordFilter: keyword
    };
  } catch {
    return { levelFilter: 'all', keywordFilter: '' };
  }
}

function saveFilterState(levelFilter, keywordFilter) {
  try {
    localStorage.setItem(
      LOGS_FILTER_KEY,
      JSON.stringify({
        levelFilter,
        keywordFilter: String(keywordFilter || '')
      })
    );
  } catch {
    // ignore
  }
}

function buildLogRow(item, keyword) {
  const level = normalizeLevel(item?.level);
  const row = document.createElement('article');
  row.className = `log-row log-row--${level}`;
  row.tabIndex = 0;

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
  appendHighlightedText(msgEl, String(item?.message || '').trim() || '(无消息)', keyword);

  row.appendChild(head);
  row.appendChild(msgEl);

  if (item?.meta != null) {
    const details = document.createElement('details');
    details.className = 'log-row-meta';

    const summary = document.createElement('summary');
    summary.textContent = '详情';

    const pre = document.createElement('pre');
    appendHighlightedText(pre, safeMetaText(item.meta), keyword);
    if (keyword && makeSearchText(item).includes(keyword)) {
      details.open = true;
    }

    details.appendChild(summary);
    details.appendChild(pre);
    row.appendChild(details);
  }

  return row;
}

export function createLogsController() {
  const initialFilter = loadFilterState();
  let streaming = false;
  let es = null;
  let logs = [];
  let levelFilter = initialFilter.levelFilter;
  let keywordFilter = initialFilter.keywordFilter;
  let followScroll = true;

  function getFilteredLogs() {
    const keywordNeedle = String(keywordFilter || '').trim().toLowerCase();
    return (logs || []).filter((item) => {
      const level = normalizeLevel(item?.level);
      if (levelFilter !== 'all' && level !== levelFilter) return false;
      if (!keywordNeedle) return true;
      return makeSearchText(item).includes(keywordNeedle);
    });
  }

  function getLevelCounts(items) {
    const counts = { error: 0, warn: 0, info: 0, debug: 0 };
    for (const item of Array.isArray(items) ? items : []) {
      counts[normalizeLevel(item?.level)] += 1;
    }
    return counts;
  }

  function updateStatus(filteredCount, counts) {
    const streamText = streaming ? '实时中' : '已停止实时';
    const followText = followScroll ? '自动跟随' : '暂停滚动';
    setText(
      $('logsMsg'),
      `共 ${logs.length} 条，显示 ${filteredCount} 条（E:${counts.error} W:${counts.warn} I:${counts.info} D:${counts.debug}；${streamText}，${followText}）`
    );
  }

  function groupLogsByDay(items) {
    const groups = [];
    const map = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const key = fmtDayLabel(item?.ts);
      if (!map.has(key)) {
        const group = { key, items: [] };
        map.set(key, group);
        groups.push(group);
      }
      map.get(key).items.push(item);
    }
    return groups;
  }

  function render() {
    const filtered = getFilteredLogs();
    const counts = getLevelCounts(filtered);
    const box = $('logsBox');
    box.textContent = '';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'log-empty';
      empty.textContent = '没有匹配日志';
      box.appendChild(empty);
      updateStatus(0, counts);
      return;
    }

    const fragment = document.createDocumentFragment();
    const groups = groupLogsByDay(filtered);
    for (const group of groups) {
      const details = document.createElement('details');
      details.className = 'log-group';
      details.open = true;

      const summary = document.createElement('summary');
      summary.className = 'log-group-summary';
      summary.textContent = `${group.key}（${group.items.length}）`;

      const body = document.createElement('div');
      body.className = 'log-group-body';
      for (const item of group.items) {
        body.appendChild(buildLogRow(item, String(keywordFilter || '').trim().toLowerCase()));
      }

      details.appendChild(summary);
      details.appendChild(body);
      fragment.appendChild(details);
    }
    box.appendChild(fragment);

    if (followScroll) {
      box.scrollTop = box.scrollHeight;
    }
    updateStatus(filtered.length, counts);
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
    saveFilterState(levelFilter, keywordFilter);
    render();
  }

  function setKeywordFilter(value) {
    keywordFilter = String(value || '').trim();
    saveFilterState(levelFilter, keywordFilter);
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

  async function copyVisible() {
    const filtered = getFilteredLogs();
    if (!filtered.length) {
      setText($('logsMsg'), '当前没有可复制的日志');
      return;
    }
    const lines = filtered.map((it) => {
      const lvl = normalizeLevel(it?.level).toUpperCase();
      const message = String(it?.message || '');
      const meta = safeMetaText(it?.meta);
      return `[${fmtTs(it?.ts)}] [${lvl}] ${message}${meta ? `\n${meta}` : ''}`;
    });
    const ok = await copyToClipboard(lines.join('\n\n'));
    setText($('logsMsg'), ok ? `已复制 ${filtered.length} 条日志` : '复制失败');
  }

  function exportVisible() {
    const filtered = getFilteredLogs();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atri-logs-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setText($('logsMsg'), `已导出 ${filtered.length} 条日志`);
  }

  return {
    load,
    start,
    stop,
    toggle,
    setLevelFilter,
    setKeywordFilter,
    toggleFollowScroll,
    clearLocalLogs,
    copyVisible,
    exportVisible,
    getLevelFilter: () => levelFilter,
    getKeywordFilter: () => keywordFilter
  };
}

export function initLogsHandlers(controller) {
  $('logsLevelFilter').value = controller.getLevelFilter();
  $('logsKeyword').value = controller.getKeywordFilter();
  $('refreshLogsBtn').addEventListener('click', () => controller.load().catch(e => setText($('logsMsg'), String(e?.message || e))));
  $('toggleStreamBtn').addEventListener('click', () => controller.toggle());
  $('logsLevelFilter').addEventListener('change', (e) => controller.setLevelFilter(e?.target?.value || 'all'));
  $('logsKeyword').addEventListener('input', (e) => controller.setKeywordFilter(e?.target?.value || ''));
  $('logsPauseBtn').addEventListener('click', () => controller.toggleFollowScroll());
  $('logsClearBtn').addEventListener('click', () => controller.clearLocalLogs());
  $('logsCopyBtn').addEventListener('click', () => controller.copyVisible().catch(e => setText($('logsMsg'), String(e?.message || e))));
  $('logsExportBtn').addEventListener('click', () => controller.exportVisible());
}
