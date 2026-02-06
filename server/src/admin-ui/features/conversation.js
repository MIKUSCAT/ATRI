import { api } from '../lib/api.js';
import { $ } from '../lib/dom.js';
import { runBusy, setText } from '../lib/ui.js';

function fmtTime(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return '--';
  try {
    return new Date(n).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(n);
  }
}

function fmtCursor(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return '尚未建立游标';
  return `游标：${n}（${fmtTime(n)}）`;
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(base, days) {
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeIsoDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeDateRange(fromValue, toValue) {
  let from = normalizeIsoDate(fromValue);
  let to = normalizeIsoDate(toValue);

  if (!from && !to) return { from: '', to: '' };
  if (!from) from = to;
  if (!to) to = from;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

function applyDateRange(from, to) {
  $('convDateFrom').value = String(from || '');
  $('convDateTo').value = String(to || '');
}

function setQuickRange(daysFromTodayStart, daysFromTodayEnd = daysFromTodayStart) {
  const today = new Date();
  const start = shiftDate(today, daysFromTodayStart);
  const end = shiftDate(today, daysFromTodayEnd);
  const from = toDateInputValue(start);
  const to = toDateInputValue(end);
  applyDateRange(from, to);
  $('convMode').value = 'date';
  syncModeUi();
}

function syncModeUi() {
  const mode = String($('convMode').value || 'date').trim();
  $('convDateRow').hidden = mode !== 'date';
  $('convAfterRow').hidden = mode !== 'after';
}

function setCursorHint(ts) {
  setText($('convCursor'), fmtCursor(ts));
}

function buildConversationCard(line) {
  const role = line?.role === 'atri' ? 'ATRI' : 'USER';
  const roleClass = line?.role === 'atri' ? 'conv-role--atri' : 'conv-role--user';

  const card = document.createElement('article');
  card.className = `conv-item ${line?.role === 'atri' ? 'conv-item--atri' : 'conv-item--user'}`;

  const head = document.createElement('div');
  head.className = 'conv-item-head';

  const roleEl = document.createElement('span');
  roleEl.className = `conv-role ${roleClass}`;
  roleEl.textContent = role;
  head.appendChild(roleEl);

  const timeEl = document.createElement('span');
  timeEl.className = 'conv-meta';
  timeEl.textContent = fmtTime(line?.timestamp);
  head.appendChild(timeEl);

  const date = String(line?.date || '').trim();
  if (date) {
    const dateEl = document.createElement('span');
    dateEl.className = 'conv-meta';
    dateEl.textContent = date;
    head.appendChild(dateEl);
  }

  const tz = String(line?.timeZone || '').trim();
  if (tz) {
    const tzEl = document.createElement('span');
    tzEl.className = 'conv-meta';
    tzEl.textContent = tz;
    head.appendChild(tzEl);
  }

  const replyTo = String(line?.replyTo || '').trim();
  if (replyTo) {
    const replyEl = document.createElement('span');
    replyEl.className = 'conv-meta';
    replyEl.textContent = `↩ ${replyTo.slice(0, 8)}`;
    head.appendChild(replyEl);
  }

  const attachments = Array.isArray(line?.attachments) ? line.attachments.length : 0;
  if (attachments > 0) {
    const attachEl = document.createElement('span');
    attachEl.className = 'conv-meta';
    attachEl.textContent = `附件 ${attachments}`;
    head.appendChild(attachEl);
  }

  const textEl = document.createElement('div');
  textEl.className = 'conv-text';
  textEl.textContent = String(line?.content || '').trim() || '(空内容)';

  card.appendChild(head);
  card.appendChild(textEl);
  return card;
}

function appendOut(logs, { append }) {
  const box = $('convOut');
  const list = Array.isArray(logs) ? logs : [];

  if (!append) {
    box.textContent = '';
  }

  if (!list.length) {
    if (!append) {
      const empty = document.createElement('div');
      empty.className = 'conv-empty';
      empty.textContent = '该条件下没有记录';
      box.appendChild(empty);
    }
    return;
  }

  const first = box.querySelector('.conv-empty');
  if (first) first.remove();

  const fragment = document.createDocumentFragment();
  for (const line of list) {
    fragment.appendChild(buildConversationCard(line));
  }
  box.appendChild(fragment);
  box.scrollTop = box.scrollHeight;
}

function setAfterFromLogs(logs) {
  const arr = Array.isArray(logs) ? logs : [];
  const last = arr.length ? arr[arr.length - 1] : null;
  const ts = last && typeof last.timestamp === 'number' ? last.timestamp : null;
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
    $('convAfter').value = String(ts);
    setCursorHint(ts);
  }
}

async function pullOnce({ append }) {
  setText($('convMsg'), '');
  const userId = String($('convUserId').value || '').trim();
  if (!userId) {
    setText($('convMsg'), '请先填 userId');
    return;
  }

  const mode = String($('convMode').value || 'date').trim() || 'date';
  const afterInput = Number(String($('convAfter').value || '0').trim() || '0');
  const after = Number.isFinite(afterInput) && afterInput > 0 ? afterInput : 0;
  const limit = Number(String($('convLimit').value || '50').trim() || '50');
  const role = String($('convRole').value || '').trim();

  const qs = new URLSearchParams();
  qs.set('userId', userId);
  if (Number.isFinite(limit) && limit > 0) qs.set('limit', String(limit));
  if (role) qs.set('role', role);

  if (mode === 'date') {
    const range = normalizeDateRange($('convDateFrom').value, $('convDateTo').value);
    if (!range.from || !range.to) {
      setText($('convMsg'), '请先选择日期');
      return;
    }
    applyDateRange(range.from, range.to);
    qs.set('dateFrom', range.from);
    qs.set('dateTo', range.to);

    if (append && after > 0) {
      qs.set('after', String(after));
    } else if (!append) {
      $('convAfter').value = '0';
    }
  } else if (after > 0) {
    qs.set('after', String(after));
  }

  const data = await api(`/admin/api/conversation/pull?${qs.toString()}`);
  const logs = Array.isArray(data?.logs) ? data.logs : [];
  appendOut(logs, { append });
  setAfterFromLogs(logs);
  if (mode === 'date') {
    const range = normalizeDateRange($('convDateFrom').value, $('convDateTo').value);
    const scope = range.from === range.to ? range.from : `${range.from} ~ ${range.to}`;
    setText($('convMsg'), logs.length ? `日期 ${scope} 拉到 ${logs.length} 条` : `日期 ${scope} 没有新消息`);
  } else {
    setText($('convMsg'), logs.length ? `拉到 ${logs.length} 条` : '没有新消息');
  }
}

export function initConversationHandlers() {
  const today = toDateInputValue(new Date());
  applyDateRange(today, today);
  $('convMode').value = 'date';
  $('convAfter').value = '0';
  setCursorHint(0);
  syncModeUi();

  $('convPullBtn')?.addEventListener('click', () => {
    runBusy($('convPullBtn'), () => pullOnce({ append: false }), '拉取中...');
  });

  $('convNextBtn')?.addEventListener('click', () => {
    runBusy($('convNextBtn'), () => pullOnce({ append: true }), '拉取中...');
  });

  $('convClearBtn')?.addEventListener('click', () => {
    $('convOut').textContent = '';
    setText($('convMsg'), '');
    $('convAfter').value = '0';
    setCursorHint(0);
  });

  $('convMode')?.addEventListener('change', () => syncModeUi());
  $('convAfter')?.addEventListener('input', () => setCursorHint($('convAfter').value));
  $('convTodayBtn')?.addEventListener('click', () => setQuickRange(0));
  $('convYesterdayBtn')?.addEventListener('click', () => setQuickRange(-1));
  $('convLast7Btn')?.addEventListener('click', () => setQuickRange(-6, 0));
}
