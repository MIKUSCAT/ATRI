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

function fmtLog(line) {
  const role = line.role === 'atri' ? 'ATRI' : 'USER';
  const replyTo = line.replyTo ? ` ↩ ${String(line.replyTo).slice(0, 8)}` : '';
  const text = String(line.content || '').replace(/\s+/g, ' ').trim();
  return `[${fmtTime(line.timestamp)}] ${role}${replyTo}: ${text}`;
}

function appendOut(lines) {
  const box = $('convOut');
  const prev = String(box.textContent || '');
  const next = (Array.isArray(lines) ? lines : []).filter(Boolean).join('\n');
  box.textContent = prev && next ? `${prev}\n${next}` : (prev || next);
}

function setAfterFromLogs(logs) {
  const arr = Array.isArray(logs) ? logs : [];
  const last = arr.length ? arr[arr.length - 1] : null;
  const ts = last && typeof last.timestamp === 'number' ? last.timestamp : null;
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
    $('convAfter').value = String(ts);
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
  if (!append) $('convOut').textContent = '';

  appendOut(logs.map(fmtLog));
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
  });

  $('convMode')?.addEventListener('change', () => syncModeUi());
  $('convTodayBtn')?.addEventListener('click', () => setQuickRange(0));
  $('convYesterdayBtn')?.addEventListener('click', () => setQuickRange(-1));
  $('convLast7Btn')?.addEventListener('click', () => setQuickRange(-6, 0));
}
