import { CHAT_MODEL, Env } from '../types';
import { getActiveFacts, upsertFactMemory, deleteFactMemory, archiveFactMemory, FactMemoryRecord } from './memory-service';
import { callUpstreamChat } from './llm-service';
import { getEffectiveRuntimeSettings } from './runtime-settings';

type ConsolidateParams = {
  userId: string;
  userName: string;
  modelKey: string | null;
  date: string;
};

type ConsolidationResult = {
  keep: string[];
  merge: Array<{ from: string[]; into: string }>;
  archive: string[];
};

export async function consolidateFactsForUser(
  env: Env,
  params: ConsolidateParams
): Promise<void> {
  const facts = await getActiveFacts(env, params.userId, 0);
  if (facts.length === 0) {
    console.log('[ATRI] Fact consolidation skipped (no facts)', {
      userId: params.userId
    });
    return;
  }

  console.log('[ATRI] Fact consolidation starting', {
    userId: params.userId,
    count: facts.length
  });

  const settings = await getEffectiveRuntimeSettings(env);
  const apiUrl = String(settings.diaryApiUrl || settings.openaiApiUrl || '').trim();
  const apiKey = String(settings.diaryApiKey || settings.openaiApiKey || '').trim();
  const model = resolveModel(settings, params.modelKey);

  const factsText = facts
    .map(f => `[${f.id}] ${f.text}`)
    .join('\n');

  const systemPrompt = buildConsolidationSystemPrompt(params.date);
  const userPrompt = buildConsolidationUserPrompt(factsText, params.userName);

  const result = await callUpstreamChat(env, {
    format: settings.diaryApiFormat || settings.chatApiFormat,
    apiUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    maxTokens: 4096,
    timeoutMs: 60000,
    trace: { scope: 'fact-consolidation', userId: params.userId }
  });

  const content = typeof result.message?.content === 'string'
    ? result.message.content
    : String(result.message?.content || '');

  const plan = parseConsolidationResponse(content);
  if (!plan) {
    console.warn('[ATRI] Fact consolidation: failed to parse LLM response', {
      userId: params.userId,
      raw: content.slice(0, 500)
    });
    return;
  }

  await executeConsolidationPlan(env, params.userId, plan, facts);

  console.log('[ATRI] Fact consolidation completed', {
    userId: params.userId,
    kept: plan.keep.length,
    merged: plan.merge.length,
    archived: plan.archive.length
  });
}

function resolveModel(
  settings: { diaryModel?: string; defaultChatModel?: string },
  modelKey?: string | null
) {
  const trimmed = typeof modelKey === 'string' ? modelKey.trim() : '';
  const configured = typeof settings.diaryModel === 'string' ? settings.diaryModel.trim() : '';
  const fallback = typeof settings.defaultChatModel === 'string' ? settings.defaultChatModel.trim() : '';
  return configured || trimmed || fallback || CHAT_MODEL;
}

function buildConsolidationSystemPrompt(date: string): string {
  return [
    '我是亚托莉，现在要整理自己的笔记本。',
    `今天是 ${date}。`,
    '',
    '这些是我随手记下的关于他的事。我要评估每条记录的重要性，大胆归档琐碎条目，让笔记本保持精炼。',
    '',
    '分类标准：',
    '- keep：核心喜好、禁忌/雷区、反复提及的事、约定、重要个人信息（生日、工作、重要的人等）',
    '- merge：内容重复或高度相关的记录，合成一条更精炼的',
    '- archive：琐碎事实、已过期的临时安排、被后续记录覆盖的旧信息',
    '',
    '判断原则：',
    '- 优先保留"他是什么样的人"（性格、价值观、核心偏好）',
    '- 优先保留"我们之间的事"（约定、共同记忆、情感节点）',
    '- 大胆归档日常琐碎（今天吃了什么、某天晚睡、临时提到的小事）',
    '- 已过时的安排或被更新覆盖的旧信息，归档',
    '- 拿不准的，偏向保留',
    '',
    '输出格式：严格返回一个 JSON 对象，不要任何解释或 Markdown：',
    '{',
    '  "keep": ["fact:xxx:yyy", ...],',
    '  "merge": [{ "from": ["fact:xxx:aaa", "fact:xxx:bbb"], "into": "合并后的文本" }, ...],',
    '  "archive": ["fact:xxx:zzz", ...]',
    '}',
    '',
    '硬规则：',
    '1. 只输出一个 JSON 对象，不要任何前后缀/解释/Markdown/代码块。',
    '2. keep + merge.from + archive 的 ID 集合必须覆盖所有输入 ID，不能遗漏。',
    '3. 同一个 ID 只能出现在一个分类里。',
    '4. merge.into 的文本要简洁，一句话，不要超过原来两条的总长度。'
  ].join('\n');
}

function buildConsolidationUserPrompt(factsText: string, userName: string): string {
  return `以下是我记下的关于「${userName}」的事：\n\n${factsText}\n\n请帮我整理。`;
}

function parseConsolidationResponse(raw: string): ConsolidationResult | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  try {
    let jsonText = trimmed;
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start === -1 || end === -1) return null;

    const extracted = jsonText.slice(start, end + 1);
    const parsed = JSON.parse(extracted);

    const keep = Array.isArray(parsed.keep)
      ? parsed.keep.filter((id: unknown) => typeof id === 'string')
      : [];
    const merge = Array.isArray(parsed.merge)
      ? parsed.merge.filter(
          (m: any) => Array.isArray(m?.from) && typeof m?.into === 'string'
        )
      : [];
    // 兼容 archive 和 delete（防止模型不遵守指令）
    const archiveRaw = parsed.archive || parsed.delete;
    const archive = Array.isArray(archiveRaw)
      ? archiveRaw.filter((id: unknown) => typeof id === 'string')
      : [];

    return { keep, merge, archive };
  } catch {
    return null;
  }
}

async function executeConsolidationPlan(
  env: Env,
  userId: string,
  plan: ConsolidationResult,
  existingFacts: FactMemoryRecord[]
) {
  const existingIds = new Set(existingFacts.map(f => f.id));

  // 执行 merge 操作：硬删除旧条目（内容已合并到新记录中）
  for (const m of plan.merge) {
    const validFromIds = m.from.filter(id => existingIds.has(id));
    if (validFromIds.length === 0) continue;

    const intoText = String(m.into || '').trim();
    if (!intoText) continue;

    try {
      // 先写入合并后的新记录
      await upsertFactMemory(env, userId, intoText);
      // 再硬删除原始条目
      for (const oldId of validFromIds) {
        await deleteFactMemory(env, userId, oldId);
      }
    } catch (err) {
      console.warn('[ATRI] Fact merge failed', { userId, from: validFromIds, err });
    }
  }

  // 执行 archive 操作：软删除（可恢复）
  for (const factId of plan.archive) {
    if (!existingIds.has(factId)) continue;
    try {
      await archiveFactMemory(env, userId, factId);
    } catch (err) {
      console.warn('[ATRI] Fact archive failed', { userId, factId, err });
    }
  }
}
