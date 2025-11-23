function toPlainText(delta: unknown): string {
  if (delta == null) return '';
  if (typeof delta === 'string') return delta;
  if (typeof delta === 'number' || typeof delta === 'boolean') {
    return String(delta);
  }
  if (Array.isArray(delta)) {
    return delta.map(item => toPlainText(item)).join('');
  }
  if (typeof delta === 'object') {
    const obj = delta as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? obj.type : undefined;
    // 仅保留真正的文本/输出块，忽略 artifact、tool_call 等非文本类型
    if (type) {
      if (type === 'text') return toPlainText(obj.text ?? obj.content ?? '');
      if (type === 'output_text') return toPlainText(obj.output_text ?? obj.text ?? obj.content ?? '');
      if (type === 'reasoning') return toPlainText(obj.reasoning ?? obj.text ?? obj.content ?? '');
      // 其他类型（artifact、tool_call 等）直接丢弃，避免渣字串
      return '';
    }
    if (obj.text != null) return toPlainText(obj.text);
    if (obj.content != null) return toPlainText(obj.content);
    if (obj.value != null) return toPlainText(obj.value);
    if (obj.output_text != null) return toPlainText(obj.output_text);
    return Object.values(obj).map(value => toPlainText(value)).join('');
  }
  return '';
}

export function pipeChatStream(response: Response): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      console.log('[ATRI] Starting stream...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[ATRI] Stream completed');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            await writer.write(encoder.encode('data: [DONE]\n\n'));
            break;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta || {};
            const contentDelta = toPlainText(delta.content);
            const reasoningDelta = toPlainText(delta.reasoning_content);

            if (reasoningDelta) {
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ type: 'reasoning', content: reasoningDelta })}\n\n`)
              );
            }
            if (contentDelta) {
              await writer.write(
                encoder.encode(`data: ${JSON.stringify({ type: 'text', content: contentDelta })}\n\n`)
              );
            }
          } catch (err) {
            console.error('[ATRI] Parse error:', err, 'data:', data);
          }
        }
      }
    } catch (err) {
      console.error('[ATRI] Stream error:', err);
      await writer.write(encoder.encode(`data: [ERROR: ${String(err)}]\n\n`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
