import { Env, CHAT_MODEL } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { callUpstreamChat } from './llm-service';
import { getEffectiveRuntimeSettings } from './runtime-settings';
import { buildSystemPromptFor } from '../utils/prompt-builder';
import {
  promoteStrongMemoryCandidates,
  saveMemoryCandidates,
  MemoryCandidateInput
} from './memory-candidate-service';
import { updateSelfModelWithNightlyReflection } from './self-model-service';
import { updateIntimacyState, updateStatusState } from './data-service';

let ensured = false;
let ensuring: Promise<void> | null = null;

async function ensureNightlyRunsTable(env: Env) {
  if (ensured) return;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    await env.ATRI_DB.prepare(
      `CREATE TABLE IF NOT EXISTS nightly_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      )`
    ).run();
    await env.ATRI_DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_nightly_runs_user_date
        ON nightly_runs(user_id, date, stage)`
    ).run();
    ensured = true;
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

export async function runNightlyMindForUser(env: Env, params: {
  userId: string;
  userName: string;
  date: string;
  diaryContent: string;
  transcript?: string;
}) {
  const started = Date.now();
  const runId = await startNightlyStage(env, params.userId, params.date, 'mind');
  try {
    // 1. 从今天对话流提炼新的 memory candidates（白天已经不做了）
    const distilled = await distillNightlyMemoryCandidates(env, params).catch((err) => {
      console.warn('[ATRI] nightly memory distill failed', { userId: params.userId, err });
      return { written: 0 };
    });

    // 2. 把强候选（包括白天残留的 + 今晚新写的）promote 到 fact_memories
    const candidateResult = await promoteStrongMemoryCandidates(env, params.userId, params.date);

    // 3. 推导今天的最终状态 + 亲密度变化
    const stateResult = await consolidateNightlyState(env, params).catch((err) => {
      console.warn('[ATRI] nightly state consolidate failed', { userId: params.userId, err });
      return null;
    });

    // 4. 更新 self_model（保持原有）
    const selfModel = await updateSelfModelWithNightlyReflection(env, {
      userId: params.userId,
      userName: params.userName,
      date: params.date,
      diaryContent: params.diaryContent,
      transcript: params.transcript
    });

    const details = {
      memoryDistilled: distilled.written,
      memoryCandidates: candidateResult,
      stateConsolidation: stateResult,
      selfModelUpdatedAt: selfModel.updatedAt || Date.now(),
      durationMs: Date.now() - started
    };
    await completeNightlyStage(env, runId, params.userId, JSON.stringify(details));
    console.log('[ATRI] Nightly mind completed', { userId: params.userId, date: params.date, ...details });
    return details;
  } catch (err) {
    await failNightlyStage(env, runId, params.userId, serializeError(err));
    console.warn('[ATRI] Nightly mind failed', { userId: params.userId, date: params.date, err });
    throw err;
  }
}

/**
 * 夜间从今天对话流 + 日记内容提炼可能值得长期记住的 fact 候选。
 */
async function distillNightlyMemoryCandidates(env: Env, params: {
  userId: string;
  userName: string;
  date: string;
  diaryContent: string;
  transcript?: string;
}): Promise<{ written: number }> {
  const settings = await getEffectiveRuntimeSettings(env);
  const apiUrl = String(settings.diaryApiUrl || settings.openaiApiUrl || '').trim();
  const apiKey = String(settings.diaryApiKey || settings.openaiApiKey || '').trim();
  const model = String(settings.diaryModel || settings.defaultChatModel || CHAT_MODEL).trim();
  if (!apiUrl || !apiKey || !model) return { written: 0 };

  const transcript = sanitizeText(String(params.transcript || '')).trim();
  const diary = sanitizeText(String(params.diaryContent || '')).trim();
  if (!transcript && !diary) return { written: 0 };

  const system = buildSystemPromptFor('nightly_memory', settings);
  const user = [
    `日期：${params.date}`,
    `对方：${params.userName || '这个人'}`,
    '',
    diary ? `【今天的日记】\n${diary}` : '',
    transcript ? `\n【今天的对话】\n${transcript.slice(0, 8000)}` : '',
    '',
    '请按格式输出今天值得长期记住的候选。'
  ].filter(Boolean).join('\n');

  const result = await callUpstreamChat(env, {
    format: settings.diaryApiFormat || settings.chatApiFormat,
    apiUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.6,
    maxTokens: 1500,
    timeoutMs: 90000,
    trace: { scope: 'nightly-memory', userId: params.userId }
  });

  const raw = typeof result.message?.content === 'string'
    ? result.message.content
    : String(result.message?.content || '');
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') return { written: 0 };

  const candidatesRaw = Array.isArray((parsed as any).candidates) ? (parsed as any).candidates : [];
  const candidates: MemoryCandidateInput[] = [];
  for (const c of candidatesRaw) {
    if (!c || typeof c !== 'object') continue;
    const content = sanitizeText(String((c as any).content || '')).trim();
    if (!content || content.length < 4) continue;
    candidates.push({
      type: String((c as any).type || 'fact_candidate').trim(),
      content,
      importance: clampNumber((c as any).importance, 1, 10, 6),
      confidence: clampNumber((c as any).confidence, 0.1, 1, 0.7),
      note: sanitizeText(String((c as any).note || '')).trim()
    });
  }

  if (!candidates.length) return { written: 0 };

  const saved = await saveMemoryCandidates(env, {
    userId: params.userId,
    candidates: candidates.slice(0, 5)
  });
  return { written: saved.count };
}

/**
 * 夜间推导今天的最终状态 + 亲密度变化，写回 user_states。
 */
async function consolidateNightlyState(env: Env, params: {
  userId: string;
  userName: string;
  date: string;
  diaryContent: string;
  transcript?: string;
}): Promise<{ statusLabel?: string; pillColor?: string; intimacyDelta?: number } | null> {
  const settings = await getEffectiveRuntimeSettings(env);
  const apiUrl = String(settings.diaryApiUrl || settings.openaiApiUrl || '').trim();
  const apiKey = String(settings.diaryApiKey || settings.openaiApiKey || '').trim();
  const model = String(settings.diaryModel || settings.defaultChatModel || CHAT_MODEL).trim();
  if (!apiUrl || !apiKey || !model) return null;

  const transcript = sanitizeText(String(params.transcript || '')).trim();
  const diary = sanitizeText(String(params.diaryContent || '')).trim();
  if (!transcript && !diary) return null;

  const system = buildSystemPromptFor('nightly_state', settings);
  const user = [
    `日期：${params.date}`,
    `对方：${params.userName || '这个人'}`,
    '',
    diary ? `【今天的日记】\n${diary}` : '',
    transcript ? `\n【今天的对话节选】\n${transcript.slice(0, 6000)}` : '',
    '',
    '请按格式输出今天结尾的状态。'
  ].filter(Boolean).join('\n');

  const result = await callUpstreamChat(env, {
    format: settings.diaryApiFormat || settings.chatApiFormat,
    apiUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.7,
    maxTokens: 600,
    timeoutMs: 60000,
    trace: { scope: 'nightly-state', userId: params.userId }
  });

  const raw = typeof result.message?.content === 'string'
    ? result.message.content
    : String(result.message?.content || '');
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  const statusLabel = sanitizeText(String((parsed as any).statusLabel || '')).trim();
  const pillColor = normalizeHex((parsed as any).pillColor || (parsed as any).pill_color);
  const textColor = normalizeHex((parsed as any).textColor || (parsed as any).text_color);
  const intimacyDeltaRaw = Number((parsed as any).intimacyDelta ?? (parsed as any).intimacy_delta ?? 0);
  const intimacyDelta = Number.isFinite(intimacyDeltaRaw)
    ? Math.max(-10, Math.min(10, Math.trunc(intimacyDeltaRaw)))
    : 0;

  if (statusLabel || pillColor || textColor) {
    try {
      await updateStatusState(env, {
        userId: params.userId,
        label: statusLabel || undefined,
        pillColor: pillColor || undefined,
        textColor: textColor || undefined
      });
    } catch (err) {
      console.warn('[ATRI] nightly status update failed', { userId: params.userId, err });
    }
  }

  if (intimacyDelta !== 0) {
    try {
      await updateIntimacyState(env, {
        userId: params.userId,
        delta: intimacyDelta,
        reason: `nightly_state(${params.date})`
      });
    } catch (err) {
      console.warn('[ATRI] nightly intimacy update failed', { userId: params.userId, err });
    }
  }

  return {
    statusLabel: statusLabel || undefined,
    pillColor: pillColor || undefined,
    intimacyDelta
  };
}

function extractJson(raw: string) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    let jsonText = text;
    if (jsonText.startsWith('```json')) jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    else if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    return JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeHex(value: unknown) {
  const text = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : '';
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function startNightlyStage(env: Env, userId: string, date: string, stage: string) {
  await ensureNightlyRunsTable(env);
  const id = crypto.randomUUID();
  await env.ATRI_DB.prepare(
    `INSERT INTO nightly_runs (id, user_id, date, stage, status, details, started_at, completed_at)
     VALUES (?, ?, ?, ?, 'started', NULL, ?, NULL)`
  ).bind(id, userId, date, stage, Date.now()).run();
  return id;
}

async function completeNightlyStage(env: Env, id: string, userId: string, details: string) {
  await env.ATRI_DB.prepare(
    `UPDATE nightly_runs SET status = 'completed', details = ?, completed_at = ? WHERE id = ? AND user_id = ?`
  ).bind(details.slice(0, 4000), Date.now(), id, userId).run();
}

async function failNightlyStage(env: Env, id: string, userId: string, details: string) {
  await env.ATRI_DB.prepare(
    `UPDATE nightly_runs SET status = 'failed', details = ?, completed_at = ? WHERE id = ? AND user_id = ?`
  ).bind(details.slice(0, 4000), Date.now(), id, userId).run();
}

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return JSON.stringify({ name: err.name, message: err.message, stack: err.stack });
  }
  return JSON.stringify({ message: String(err) });
}
