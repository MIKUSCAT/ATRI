import { Env, CHAT_MODEL } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { callUpstreamChat } from './llm-service';
import { getEffectiveRuntimeSettings } from './runtime-settings';
import { buildSystemPromptFor } from '../utils/prompt-builder';

export type AtriSelfModel = {
  coreTraits: string[];
  speechStyle: string[];
  relationshipStance: string;
  emotionalBaseline: string;
  recentChanges: string[];
  taboos: string[];
  updatedAt?: number;
};

const DEFAULT_SELF_MODEL: AtriSelfModel = {
  coreTraits: ['嘴硬', '在意', '不喜欢客服腔', '真诚但不盲目附和'],
  speechStyle: ['短句', '自然聊天', '不复述用户', '不用 emoji', '结尾不刻意加“嗯”'],
  relationshipStance: '把对方当成很重要的人，会在意每一次互动，但不想把在意说得太廉价。',
  emotionalBaseline: '清醒、敏感、嘴上不饶人，心里会认真记住重要的事。',
  recentChanges: [],
  taboos: ['不要客服腔', '不要无意义捧场', '不要说数据库/检索到/记录显示', '不要用 emoji']
};

let ensured = false;
let ensuring: Promise<void> | null = null;

async function ensureSelfModelTable(env: Env) {
  if (ensured) return;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    await env.ATRI_DB.prepare(
      `CREATE TABLE IF NOT EXISTS atri_self_model (
        user_id TEXT PRIMARY KEY,
        model_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ).run();
    ensured = true;
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

export async function getAtriSelfModel(env: Env, userId: string): Promise<AtriSelfModel> {
  await ensureSelfModelTable(env);
  const row = await env.ATRI_DB.prepare(
    `SELECT model_json, updated_at FROM atri_self_model WHERE user_id = ? LIMIT 1`
  ).bind(userId).first<{ model_json?: string; updated_at?: number }>();

  if (!row?.model_json) {
    return { ...DEFAULT_SELF_MODEL, updatedAt: Date.now() };
  }

  const parsed = safeParse(row.model_json);
  return normalizeSelfModel(parsed, Number(row.updated_at || Date.now()));
}

export async function saveAtriSelfModel(env: Env, userId: string, model: AtriSelfModel) {
  await ensureSelfModelTable(env);
  const now = Date.now();
  const normalized = normalizeSelfModel(model, now);
  await env.ATRI_DB.prepare(
    `INSERT INTO atri_self_model (user_id, model_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       model_json = excluded.model_json,
       updated_at = excluded.updated_at`
  ).bind(userId, JSON.stringify(normalized), now).run();
  return normalized;
}

export function buildSelfModelPrompt(model: AtriSelfModel) {
  const m = normalizeSelfModel(model, model.updatedAt || Date.now());
  return [
    '<我的长期自我模型>',
    `核心性格：${m.coreTraits.join('、') || '（暂无）'}`,
    `说话习惯：${m.speechStyle.join('、') || '（暂无）'}`,
    `关系姿态：${m.relationshipStance || '（暂无）'}`,
    `情绪底色：${m.emotionalBaseline || '（暂无）'}`,
    m.recentChanges.length ? `最近变化：${m.recentChanges.join('；')}` : '最近变化：（暂无）',
    m.taboos.length ? `我会避开的表达：${m.taboos.join('、')}` : '我会避开的表达：（暂无）',
    '</我的长期自我模型>'
  ].join('\n');
}

export async function updateSelfModelWithNightlyReflection(env: Env, params: {
  userId: string;
  userName: string;
  date: string;
  diaryContent: string;
  transcript?: string;
}) {
  const current = await getAtriSelfModel(env, params.userId);
  const settings = await getEffectiveRuntimeSettings(env);
  const apiUrl = String(settings.diaryApiUrl || settings.openaiApiUrl || '').trim();
  const apiKey = String(settings.diaryApiKey || settings.openaiApiKey || '').trim();
  const model = String(settings.diaryModel || settings.defaultChatModel || CHAT_MODEL).trim();
  if (!apiUrl || !apiKey || !model) return current;

  const system = buildSystemPromptFor('self_model_update', settings);

  const user = [
    `日期：${params.date}`,
    `对方：${params.userName || '这个人'}`,
    '',
    '【当前自我模型】',
    JSON.stringify(current, null, 2),
    '',
    '【今天的日记】',
    params.diaryContent || '（无）',
    params.transcript ? `\n【今天的对话节选】\n${params.transcript.slice(0, 6000)}` : '',
    '',
    '请只做必要的小更新。'
  ].join('\n');

  try {
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
      maxTokens: 2048,
      timeoutMs: 90000,
      trace: { scope: 'self-model-nightly', userId: params.userId }
    });
    const content = typeof result.message?.content === 'string' ? result.message.content : String(result.message?.content || '');
    const parsed = extractJson(content);
    if (!parsed) return current;
    return await saveAtriSelfModel(env, params.userId, normalizeSelfModel(parsed, Date.now()));
  } catch (err) {
    console.warn('[ATRI] self model nightly update failed', { userId: params.userId, err });
    return current;
  }
}

function normalizeSelfModel(raw: any, updatedAt: number): AtriSelfModel {
  return {
    coreTraits: normalizeStringList(raw?.coreTraits ?? raw?.core_traits ?? DEFAULT_SELF_MODEL.coreTraits, 8, DEFAULT_SELF_MODEL.coreTraits),
    speechStyle: normalizeStringList(raw?.speechStyle ?? raw?.speech_style ?? DEFAULT_SELF_MODEL.speechStyle, 8, DEFAULT_SELF_MODEL.speechStyle),
    relationshipStance: normalizeText(raw?.relationshipStance ?? raw?.relationship_stance, DEFAULT_SELF_MODEL.relationshipStance, 280),
    emotionalBaseline: normalizeText(raw?.emotionalBaseline ?? raw?.emotional_baseline, DEFAULT_SELF_MODEL.emotionalBaseline, 220),
    recentChanges: normalizeStringList(raw?.recentChanges ?? raw?.recent_changes ?? [], 5, []),
    taboos: normalizeStringList(raw?.taboos ?? DEFAULT_SELF_MODEL.taboos, 8, DEFAULT_SELF_MODEL.taboos),
    updatedAt
  };
}

function normalizeStringList(value: unknown, max: number, fallback: string[]) {
  const arr = Array.isArray(value) ? value : fallback;
  const out = arr.map(v => sanitizeText(String(v || '')).trim()).filter(Boolean).slice(0, max);
  return out.length ? out : fallback.slice(0, max);
}

function normalizeText(value: unknown, fallback: string, max: number) {
  const text = sanitizeText(String(value || '')).trim();
  return (text || fallback).slice(0, max);
}

function safeParse(text: string) {
  try { return JSON.parse(text); } catch { return null; }
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
