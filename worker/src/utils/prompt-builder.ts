import type { EffectiveRuntimeSettings } from '../services/runtime-settings';

export type PromptScope =
  | 'proactive'
  | 'diary'
  | 'nightly_memory'
  | 'nightly_state'
  | 'self_model_update';

/**
 * 拼接 core_self + 指定 scope 的 system prompt。
 * 所有 LLM 调用都应该用这个函数构建 system，保证人格底色一致。
 *
 * core_self 是亚托莉的身份与性格底色，跨场景共享；
 * scope 段是当下场景该做什么、怎么输出。
 */
export function buildSystemPromptFor(
  scope: PromptScope,
  settings: EffectiveRuntimeSettings
): string {
  const prompts = (settings.prompts || {}) as Record<string, { system?: string }>;
  const coreSelf = String(prompts.core_self?.system || '').trim();
  const scoped = String(prompts[scope]?.system || '').trim();

  return [coreSelf, scoped].filter(Boolean).join('\n\n');
}

export function getPromptUserTemplate(scope: PromptScope, settings: EffectiveRuntimeSettings): string {
  const prompts = (settings.prompts || {}) as Record<string, { userTemplate?: string }>;
  return String(prompts[scope]?.userTemplate || '').trim();
}
