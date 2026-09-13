import type { ModelMessage, ToolDefinition } from './index.js';

/** A conservative, provider-independent estimate, not a model tokenizer. */
export function estimateTextTokens(text: string): number {
  let ascii = 0,
    other = 0;
  for (const character of text) {
    if (character.codePointAt(0)! < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3 + other * 2);
}

export function estimateRequestTokens(
  messages: ModelMessage[],
  tools: ToolDefinition[] = [],
): number {
  return (
    128 +
    (tools.length ? estimateTextTokens(JSON.stringify(tools)) : 0) +
    messages.reduce(
      (total, message) =>
        total +
        32 +
        estimateTextTokens(
          message.raw === undefined
            ? message.content + (message.calls ? JSON.stringify(message.calls) : '')
            : JSON.stringify(message.raw),
        ) +
        (message.images?.length ?? 0) * 4096,
      0,
    )
  );
}

export function trimToTokens(text: string, budget: number): string {
  if (budget <= 0) return '';
  if (estimateTextTokens(text) <= budget) return text;
  let low = 0,
    high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTextTokens(text.slice(0, middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  // Avoid cutting between the UTF-16 halves of an emoji.
  if (low && /[\uD800-\uDBFF]/.test(text[low - 1])) low--;
  return text.slice(0, low);
}
