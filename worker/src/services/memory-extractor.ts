import { Env } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { callChatCompletions, ChatCompletionError } from './openai-service';
import { MemoryCategory, UserMemoryInput } from './data-service';
import prompts from '../config/prompts.json';

export type ExtractedMemory = {
  category: MemoryCategory;
  key: string;
  value: string;
  importance: number;
  evidence?: string;
};

export type MemoryExtractionResult = {
  memories: ExtractedMemory[];
  raw: string;
};

export async function extractMemoriesFromText(
  env: Env,
  params: {
    text: string;
    modelKey?: string | null;
  }
): Promise<MemoryExtractionResult> {
  const text = sanitizeText(params.text || '').trim();
  if (!text || text.length < 50) {
    return { memories: [], raw: '' };
  }

  const promptTemplate = (prompts as any).memory?.extractTemplate || '';
  if (!promptTemplate) {
    console.warn('[ATRI] extractTemplate not found in prompts.json');
    return { memories: [], raw: '' };
  }

  const userPrompt = promptTemplate.replace('{text}', text.slice(0, 8000));

  try {
    const response = await callChatCompletions(
      env,
      {
        messages: [
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      },
      { model: params.modelKey || undefined }
    );

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const memories = parseMemoriesJson(raw);

    return { memories, raw };
  } catch (error) {
    if (error instanceof ChatCompletionError) {
      throw error;
    }
    console.error('[ATRI] Memory extraction failed:', error);
    return { memories: [], raw: '' };
  }
}

function parseMemoriesJson(raw: string): ExtractedMemory[] {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];

  let text = trimmed;
  if (text.startsWith('```json')) {
    text = text.replace(/^```json\s*/, '').replace(/```$/, '');
  } else if (text.startsWith('```')) {
    text = text.replace(/^```\s*/, '').replace(/```$/, '');
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    return [];
  }

  try {
    const jsonStr = text.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr);
    const memories = Array.isArray(parsed?.memories) ? parsed.memories : [];

    return memories
      .filter((m: any) => m && m.key && m.value && m.category)
      .map((m: any) => ({
        category: validateCategory(m.category),
        key: String(m.key).slice(0, 100),
        value: String(m.value).slice(0, 500),
        importance: Math.min(10, Math.max(1, Number(m.importance) || 5)),
        evidence: m.evidence ? String(m.evidence).slice(0, 200) : undefined
      }));
  } catch (err) {
    console.warn('[ATRI] Memory JSON parse failed:', err);
    return [];
  }
}

function validateCategory(cat: string): MemoryCategory {
  const valid: MemoryCategory[] = ['user_fact', 'user_preference', 'relationship', 'taboo', 'atri_growth'];
  if (valid.includes(cat as MemoryCategory)) {
    return cat as MemoryCategory;
  }
  return 'user_fact';
}

export function toUserMemoryInputs(
  userId: string,
  memories: ExtractedMemory[],
  sourceDate?: string
): UserMemoryInput[] {
  return memories.map(m => ({
    userId,
    category: m.category,
    key: m.key,
    value: m.value,
    importance: m.importance,
    evidence: m.evidence,
    sourceDate
  }));
}
