import { api } from '../lib/api.js';
import { $ } from '../lib/dom.js';
import { runBusy, setTagState, setText } from '../lib/ui.js';

function fmtTs(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts || '');
  }
}

function clearSecretsInputs() {
  for (const id of ['openaiApiKey', 'embeddingsApiKey', 'diaryApiKey', 'tavilyApiKey']) {
    const el = $(id);
    el.value = '';
  }
}

function resetClearCheckboxes() {
  for (const key of ['openai', 'embeddings', 'diary', 'tavily']) {
    const id = `clear${key[0].toUpperCase() + key.slice(1)}ApiKey`;
    const el = document.getElementById(id);
    if (el) el.checked = false;
  }
}

function getEffectiveDiaryFormat() {
  const chat = String($('chatApiFormat')?.value || 'openai').trim() || 'openai';
  const diaryRaw = String($('diaryApiFormat')?.value || '').trim();
  const diary = diaryRaw || chat;
  return { chat, diary };
}

function parseOptionalInt(raw, fallback = null) {
  const text = String(raw ?? '').trim();
  if (!text) return fallback;
  const n = Number(text);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function validateProactiveConfig(config) {
  const channel = String(config.proactiveNotificationChannel || 'none').trim().toLowerCase();
  const target = String(config.proactiveNotificationTarget || '').trim();
  if ((channel === 'email' || channel === 'wechat_work') && !target) {
    throw new Error('主动消息通知渠道为 email 或企业微信时，通知目标不能为空');
  }
}

function applyUpstreamHints() {
  const { chat, diary } = getEffectiveDiaryFormat();

  const urlHint =
    chat === 'anthropic'
      ? 'https://api.anthropic.com'
      : chat === 'gemini'
        ? 'https://generativelanguage.googleapis.com'
        : 'https://api.openai.com';
  $('openaiApiUrl').placeholder = urlHint;

  const modelHint =
    chat === 'anthropic'
      ? 'claude-3-5-sonnet-20241022'
      : chat === 'gemini'
        ? 'gemini-1.5-pro'
        : 'gpt-4o';
  $('defaultChatModel').placeholder = modelHint;

  const diaryModelHint =
    diary === 'anthropic'
      ? 'claude-3-5-sonnet-20241022'
      : diary === 'gemini'
        ? 'gemini-1.5-pro'
        : 'gpt-4o-mini';
  $('diaryModel').placeholder = diaryModelHint;
}

export async function loadConfig() {
  const data = await api('/admin/api/config');
  const c = data.stored?.config || {};

  setText(
    $('configMeta'),
    `已保存更新时间：${data.stored?.updatedAt ? fmtTs(data.stored.updatedAt) : '（无）'}；加密键：${
      data.stored?.encryption?.configured ? '已配置' : '未配置'
    }`
  );

  $('chatApiFormat').value = c.chatApiFormat || data.effective?.chatApiFormat || 'openai';

  $('openaiApiUrl').value = c.openaiApiUrl || data.effective?.openaiApiUrl || '';
  $('defaultChatModel').value = c.defaultChatModel || data.effective?.defaultChatModel || '';

  $('embeddingsApiUrl').value = c.embeddingsApiUrl || data.effective?.embeddingsApiUrl || '';
  $('embeddingsModel').value = c.embeddingsModel || data.effective?.embeddingsModel || '';

  $('diaryApiFormat').value = c.diaryApiFormat || '';
  $('diaryApiUrl').value = c.diaryApiUrl || data.effective?.diaryApiUrl || '';
  $('diaryModel').value = c.diaryModel || data.effective?.diaryModel || '';

  $('agentTemperature').value = c.agentTemperature ?? data.effective?.agentTemperature ?? '';
  $('agentMaxTokens').value = c.agentMaxTokens ?? data.effective?.agentMaxTokens ?? '';
  $('agentTimeoutMs').value = c.agentTimeoutMs ? Math.round(c.agentTimeoutMs / 1000) : (data.effective?.agentTimeoutMs ? Math.round(data.effective.agentTimeoutMs / 1000) : '');
  $('diaryTemperature').value = c.diaryTemperature ?? data.effective?.diaryTemperature ?? '';
  $('diaryMaxTokens').value = c.diaryMaxTokens ?? data.effective?.diaryMaxTokens ?? '';
  $('profileTemperature').value = c.profileTemperature ?? data.effective?.profileTemperature ?? '';
  $('proactiveEnabled').value = String(c.proactiveEnabled ?? data.effective?.proactiveEnabled ?? false);
  $('proactiveIntervalMinutes').value = c.proactiveIntervalMinutes ?? data.effective?.proactiveIntervalMinutes ?? '';
  $('proactiveTimeZone').value = c.proactiveTimeZone || data.effective?.proactiveTimeZone || 'Asia/Shanghai';
  $('proactiveQuietStartHour').value = c.proactiveQuietStartHour ?? data.effective?.proactiveQuietStartHour ?? '';
  $('proactiveQuietEndHour').value = c.proactiveQuietEndHour ?? data.effective?.proactiveQuietEndHour ?? '';
  $('proactiveMaxDaily').value = c.proactiveMaxDaily ?? data.effective?.proactiveMaxDaily ?? '';
  $('proactiveCooldownHours').value = c.proactiveCooldownHours ?? data.effective?.proactiveCooldownHours ?? '';
  $('proactiveIntimacyThreshold').value = c.proactiveIntimacyThreshold ?? data.effective?.proactiveIntimacyThreshold ?? '';
  $('proactiveRecentActiveMinutes').value = c.proactiveRecentActiveMinutes ?? data.effective?.proactiveRecentActiveMinutes ?? '';
  $('proactiveNotificationChannel').value = c.proactiveNotificationChannel || data.effective?.proactiveNotificationChannel || 'none';
  $('proactiveNotificationTarget').value = c.proactiveNotificationTarget || data.effective?.proactiveNotificationTarget || '';

  const flags = data.stored?.secrets || {};
  setTagState($('openaiKeyFlag'), flags.openaiApiKey);
  setTagState($('embeddingsKeyFlag'), flags.embeddingsApiKey);
  setTagState($('diaryKeyFlag'), flags.diaryApiKey);
  setTagState($('tavilyKeyFlag'), flags.tavilyApiKey);

  resetClearCheckboxes();
  clearSecretsInputs();
  applyUpstreamHints();
}

function buildSavePayload() {
  const config = {
    chatApiFormat: $('chatApiFormat').value,
    openaiApiUrl: $('openaiApiUrl').value,
    defaultChatModel: $('defaultChatModel').value,
    embeddingsApiUrl: $('embeddingsApiUrl').value,
    embeddingsModel: $('embeddingsModel').value,
    diaryApiFormat: $('diaryApiFormat').value,
    diaryApiUrl: $('diaryApiUrl').value,
    diaryModel: $('diaryModel').value,
    agentTemperature: $('agentTemperature').value,
    agentMaxTokens: $('agentMaxTokens').value,
    agentTimeoutMs: (() => {
      const v = parseInt($('agentTimeoutMs').value, 10);
      return isNaN(v) ? undefined : v * 1000;
    })(),
    diaryTemperature: $('diaryTemperature').value,
    diaryMaxTokens: $('diaryMaxTokens').value,
    profileTemperature: $('profileTemperature').value,
    proactiveEnabled: $('proactiveEnabled').value === 'true',
    proactiveIntervalMinutes: parseOptionalInt($('proactiveIntervalMinutes').value, ''),
    proactiveTimeZone: $('proactiveTimeZone').value,
    proactiveQuietStartHour: parseOptionalInt($('proactiveQuietStartHour').value, ''),
    proactiveQuietEndHour: parseOptionalInt($('proactiveQuietEndHour').value, ''),
    proactiveMaxDaily: parseOptionalInt($('proactiveMaxDaily').value, ''),
    proactiveCooldownHours: parseOptionalInt($('proactiveCooldownHours').value, ''),
    proactiveIntimacyThreshold: parseOptionalInt($('proactiveIntimacyThreshold').value, ''),
    proactiveRecentActiveMinutes: parseOptionalInt($('proactiveRecentActiveMinutes').value, ''),
    proactiveNotificationChannel: $('proactiveNotificationChannel').value,
    proactiveNotificationTarget: $('proactiveNotificationTarget').value
  };

  validateProactiveConfig(config);

  const secrets = {};

  const s1 = $('openaiApiKey').value;
  const s2 = $('embeddingsApiKey').value;
  const s3 = $('diaryApiKey').value;
  const s4 = $('tavilyApiKey').value;
  if (s1) secrets.openaiApiKey = s1;
  if (s2) secrets.embeddingsApiKey = s2;
  if (s3) secrets.diaryApiKey = s3;
  if (s4) secrets.tavilyApiKey = s4;

  if ($('clearOpenaiApiKey').checked) secrets.openaiApiKey = null;
  if ($('clearEmbeddingsApiKey').checked) secrets.embeddingsApiKey = null;
  if ($('clearDiaryApiKey').checked) secrets.diaryApiKey = null;
  if ($('clearTavilyApiKey').checked) secrets.tavilyApiKey = null;

  return { config, secrets };
}

export async function saveConfig() {
  setText($('configMsg'), '');
  await api('/admin/api/config', {
    method: 'POST',
    body: JSON.stringify(buildSavePayload())
  });
  setText($('configMsg'), '已保存');
  await loadConfig();
}

export async function resetConfig() {
  if (!confirm('确定清空运行时配置？清空后会回退到 .env 配置。')) return;
  await api('/admin/api/config/reset', { method: 'POST', body: '{}' });
  setText($('configMsg'), '已清空');
  await loadConfig();
}

export function initConfigHandlers() {
  $('saveConfigBtn').addEventListener('click', () => {
    runBusy($('saveConfigBtn'), () => saveConfig().catch(e => setText($('configMsg'), String(e?.message || e))), '保存中...');
  });
  $('resetConfigBtn').addEventListener('click', () => {
    runBusy($('resetConfigBtn'), () => resetConfig().catch(e => setText($('configMsg'), String(e?.message || e))), '重置中...');
  });

  $('chatApiFormat')?.addEventListener('change', applyUpstreamHints);
  $('diaryApiFormat')?.addEventListener('change', applyUpstreamHints);

  $('fetchModelsBtn')?.addEventListener('click', () => {
    runBusy($('fetchModelsBtn'), () => fetchModelsForAdmin(), '拉取中...');
  });

  $('modelSelect')?.addEventListener('change', () => {
    const selected = $('modelSelect').value;
    if (selected) {
      $('defaultChatModel').value = selected;
    }
  });
}

async function fetchModelsForAdmin() {
  const selectEl = $('modelSelect');
  try {
    const data = await api('/admin/api/tools/fetch-models');
    const models = data?.models || [];
    selectEl.innerHTML = '<option value="">-- 选择模型 --</option>';
    if (models.length === 0) {
      selectEl.innerHTML = '<option value="">无可用模型</option>';
      if (data?.warning) {
        setText($('configMsg'), '提示：' + (data.warning === 'anthropic_no_models_endpoint' ? 'Anthropic 不提供模型列表接口，请手动输入' : data.warning));
      }
    } else {
      const currentModel = $('defaultChatModel').value;
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label || m.id;
        if (m.id === currentModel) opt.selected = true;
        selectEl.appendChild(opt);
      }
    }
    selectEl.style.display = '';
  } catch (e) {
    setText($('configMsg'), '拉取模型列表失败：' + String(e?.message || e));
  }
}
