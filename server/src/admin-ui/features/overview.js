import { api } from '../lib/api.js';
import { $ } from '../lib/dom.js';
import { copyToClipboard, runBusy, setText } from '../lib/ui.js';

let latestImagePageUrl = 'https://github.com/users/mikuscat/packages?repo_name=ATRI';

function fmtList(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map((item) => String(item || '').trim()).filter(Boolean);
}

function fmtTs(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '';
  }
}

function shortDigest(digest) {
  const text = String(digest || '').trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) return '';
  return `${text.slice(0, 19)}…${text.slice(-8)}`;
}

function setUpdateStatus(text, tone = 'idle') {
  const el = $('overviewUpdateStatus');
  if (!el) return;
  el.classList.remove(
    'update-status--idle',
    'update-status--info',
    'update-status--ok',
    'update-status--warn',
    'update-status--error'
  );
  const mapped = ['idle', 'info', 'ok', 'warn', 'error'].includes(tone) ? tone : 'idle';
  el.classList.add(`update-status--${mapped}`);
  setText(el, String(text || ''));
}

function buildImagePageUrl(image) {
  const raw = String(image || '').trim().replace(/^https?:\/\//i, '');
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  if (parts.length >= 3 && parts[0].toLowerCase() === 'ghcr.io') {
    const owner = parts[1];
    const packageName = parts.slice(2).join('/');
    if (owner && packageName) {
      return `https://github.com/users/${encodeURIComponent(owner)}/packages/container/package/${encodeURIComponent(packageName)}`;
    }
  }
  return `https://${raw}`;
}

function renderUpdateResult(result) {
  const status = String(result?.status || '').trim();
  const image = String(result?.image || '').trim();
  const tag = String(result?.tag || '').trim();
  const remoteDigest = shortDigest(result?.remoteDigest);
  const currentDigest = shortDigest(result?.currentDigest);
  const previousDigest = shortDigest(result?.previousRemoteDigest);
  const changedFromDigest = shortDigest(result?.changedFromDigest);
  const checkedAt = fmtTs(result?.checkedAt);
  const modifiedAt = fmtTs(result?.remoteLastModifiedAt);
  const changedAt = fmtTs(result?.changedAt);
  const comparisonMode = String(result?.comparisonMode || '').trim();
  const details = String(result?.details || '').trim();

  if (status === 'up_to_date') {
    setUpdateStatus('当前实例已是最新镜像', 'ok');
  } else if (status === 'update_available') {
    setUpdateStatus('检测到新镜像：当前实例落后', 'warn');
  } else if (status === 'remote_changed') {
    setUpdateStatus('检测到远端镜像有更新（历史追踪）', 'warn');
  } else if (status === 'remote_changed_recent') {
    setUpdateStatus('近期检测到远端镜像更新（历史追踪）', 'warn');
  } else if (status === 'remote_unchanged') {
    setUpdateStatus('远端镜像暂无新变化（历史追踪）', 'ok');
  } else if (status === 'tracking_started') {
    setUpdateStatus('已开始追踪远端镜像，后续会自动提示变化', 'info');
  } else if (status === 'misconfigured') {
    setUpdateStatus('镜像检查配置无效', 'error');
  } else if (status === 'check_failed') {
    setUpdateStatus('镜像检查失败', 'error');
  } else {
    setUpdateStatus('状态未知', 'info');
  }

  const lines = [];
  if (image) lines.push(`镜像：${image}${tag ? `:${tag}` : ''}`);
  if (comparisonMode === 'history') lines.push('比较方式：历史追踪（免配置）');
  if (comparisonMode === 'exact') lines.push('比较方式：精确对比（当前实例 digest）');
  if (remoteDigest) lines.push(`远端：${remoteDigest}`);
  if (currentDigest) lines.push(`当前：${currentDigest}`);
  if (previousDigest) lines.push(`上次远端：${previousDigest}`);
  if (changedFromDigest) lines.push(`上次变化来源：${changedFromDigest}`);
  if (changedAt) lines.push(`上次变化时间：${changedAt}`);
  if (modifiedAt) lines.push(`远端时间：${modifiedAt}`);
  if (checkedAt) lines.push(`检查时间：${checkedAt}`);
  if (details) lines.push(`详情：${details}`);
  setText($('overviewUpdateMeta'), lines.join('\n') || '（无）');

  latestImagePageUrl = buildImagePageUrl(image) || latestImagePageUrl;
}

async function refreshInfo() {
  setText($('overviewMsg'), '');
  const data = await api('/admin/api/info');

  const origin = String(data?.origin || '').trim() || location.origin;
  $('overviewBaseUrl').value = origin;

  const adminPublic = Boolean(data?.admin?.public);
  setText($('overviewMode'), adminPublic ? '公网模式（已开启）' : '本机模式（仅本机/隧道）');

  const allowedOrigins = fmtList(data?.admin?.allowedOrigins);
  setText($('overviewOrigins'), allowedOrigins.length ? allowedOrigins.join('\n') : '（空）');

  const commit = String(data?.build?.commitSha || '').trim();
  const node = String(data?.build?.node || '').trim();
  const buildInfoParts = [
    commit ? `commit：${commit}` : null,
    node ? `node：${node}` : null
  ].filter(Boolean);
  setText($('overviewBuildInfo'), buildInfoParts.join('；') || '（平台未提供构建信息）');
}

async function checkUpdate() {
  setText($('overviewMsg'), '');
  const data = await api('/admin/api/update-check');
  renderUpdateResult(data || {});
}

export async function loadOverviewInfo() {
  try {
    await refreshInfo();
    await checkUpdate();
  } catch (e) {
    $('overviewBaseUrl').value = location.origin;
    setText($('overviewMode'), '（获取失败）');
    setText($('overviewOrigins'), '（获取失败）');
    setText($('overviewBuildInfo'), '（获取失败）');
    setUpdateStatus('（获取失败）', 'error');
    setText($('overviewUpdateMeta'), '（获取失败）');
    setText($('overviewMsg'), String(e?.message || e));
  }
}

export function initOverviewHandlers() {
  $('copyOverviewBaseUrlBtn')?.addEventListener('click', () => {
    runBusy(
      $('copyOverviewBaseUrlBtn'),
      async () => {
        const ok = await copyToClipboard(String($('overviewBaseUrl').value || '').trim());
        setText($('overviewMsg'), ok ? '已复制' : '复制失败');
      },
      '复制中...'
    );
  });

  $('refreshOverviewBtn')?.addEventListener('click', () => {
    runBusy($('refreshOverviewBtn'), () => loadOverviewInfo(), '刷新中...');
  });

  $('checkUpdateBtn')?.addEventListener('click', () => {
    runBusy(
      $('checkUpdateBtn'),
      () => checkUpdate().catch(e => setText($('overviewMsg'), String(e?.message || e))),
      '检查中...'
    );
  });

  $('openImagePageBtn')?.addEventListener('click', () => {
    const target = String(latestImagePageUrl || '').trim();
    if (!target) {
      setText($('overviewMsg'), '暂无可打开的镜像地址');
      return;
    }
    window.open(target, '_blank', 'noopener,noreferrer');
  });
}
