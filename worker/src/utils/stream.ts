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
            const contentDelta = delta.content || '';
            const reasoningDelta = delta.reasoning_content || '';

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
