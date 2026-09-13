import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpModel,
  estimateRequestTokens,
  estimateTextTokens,
  trimToTokens,
  type ModelConfig,
  type ModelMessage,
  type ToolDefinition,
} from '@atri/llm';
const config: ModelConfig = {
  baseUrl: 'https://model.example',
  apiKey: 'test-only-secret',
  model: 'test-model',
  format: 'openai',
  vision: true,
  maxTokens: 2000,
  timeoutMs: 2000,
};
const tool: ToolDefinition = {
  name: 'search_memory',
  description: '检索',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};

test('OpenAI 兼容接口保存工具关联、推理续传字段和自定义会话头', async () => {
  const requests: { url: string; init: RequestInit; body: any }[] = [];
  const fetcher = (async (url: unknown, init: RequestInit) => {
    requests.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return Response.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            reasoning_content: 'opaque provider continuation',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'search_memory', arguments: '{"query":"面试"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    });
  }) as typeof fetch;
  const client = new HttpModel(config, fetcher),
    messages: ModelMessage[] = [
      { role: 'system', content: '角色' },
      { role: 'user', content: '面试' },
    ];
  const one = await client.complete(messages, [tool], { sessionId: 'conversation:1' });
  assert.equal(one.calls[0].arguments.query, '面试');
  assert.equal(one.text, '');
  await client.complete(
    [
      ...messages,
      one.continuation,
      { role: 'tool', callId: 'c1', name: 'search_memory', content: '{}' },
    ],
    [],
  );
  assert.equal(requests[0].url, 'https://model.example/v1/chat/completions');
  assert.equal(
    (requests[0].init.headers as Record<string, string>)['x-zg-session-id'],
    'conversation:1',
  );
  assert.equal(requests[1].body.messages[2].reasoning_content, 'opaque provider continuation');
  assert.equal(requests[1].body.messages[3].tool_call_id, 'c1');
});
test('Anthropic 工具结果映射为 user tool_result，思考块不作为最终文字返回', async () => {
  const bodies: any[] = [];
  const client = new HttpModel({ ...config, format: 'anthropic' }, (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      content: [
        { type: 'thinking', thinking: 'opaque', signature: 'sig' },
        { type: 'tool_use', id: 'c1', name: 'search_memory', input: { query: '你好' } },
      ],
      usage: { input_tokens: 10, output_tokens: 2 },
    });
  }) as typeof fetch);
  const first = await client.complete(
    [
      { role: 'system', content: 'personality' },
      { role: 'user', content: '你好' },
    ],
    [tool],
  );
  assert.equal(first.text, '');
  await client.complete(
    [
      { role: 'system', content: 'personality' },
      { role: 'user', content: '你好' },
      first.continuation,
      { role: 'tool', callId: 'c1', name: 'search_memory', content: '{"result":1}' },
    ],
    [tool],
  );
  assert.equal(bodies[1].system, 'personality');
  assert.equal(bodies[1].messages.at(-1).content[0].tool_use_id, 'c1');
  assert.equal(bodies[1].messages[1].content[0].signature, 'sig');
});
test('Gemini 保留 functionCall 的 thoughtSignature 与图片块', async () => {
  const bodies: any[] = [];
  const client = new HttpModel({ ...config, format: 'gemini' }, (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: 'search_memory', args: { query: '图片' } },
                thoughtSignature: 'opaque-signature',
              },
            ],
          },
        },
      ],
    });
  }) as typeof fetch);
  const messages: ModelMessage[] = [
    { role: 'system', content: 'personality' },
    { role: 'user', content: '看图', images: ['data:image/png;base64,AAAA'] },
  ];
  const first = await client.complete(messages, [tool]);
  await client.complete(
    [
      ...messages,
      first.continuation,
      { role: 'tool', name: 'search_memory', callId: first.calls[0].id, content: '{"found":true}' },
    ],
    [tool],
  );
  assert.equal(bodies[0].contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.equal(bodies[1].contents[1].parts[0].thoughtSignature, 'opaque-signature');
  assert.equal(bodies[1].contents[2].parts[0].functionResponse.name, 'search_memory');
});
test('模型错误信息不回显 API 密钥，空响应明确失败', async () => {
  const errorClient = new HttpModel(config, (async () =>
    Response.json(
      { error: { message: 'invalid ' + config.apiKey } },
      { status: 401 },
    )) as typeof fetch);
  await assert.rejects(
    errorClient.complete([{ role: 'user', content: 'hi' }]),
    (error) =>
      error instanceof Error &&
      !error.message.includes(config.apiKey) &&
      error.message.includes('401'),
  );
  const empty = new HttpModel(config, (async () => Response.json({ choices: [] })) as typeof fetch);
  await assert.rejects(empty.complete([{ role: 'user', content: 'hi' }]), /没有返回可用内容/);
});

test('自定义输出上限与温度适用于三种接口，日记覆盖值也不能突破上限', async () => {
  for (const format of ['openai', 'anthropic', 'gemini'] as const) {
    const bodies: any[] = [];
    const client = new HttpModel({ ...config, format, maxTokens: 768, temperature: 0.25 }, (async (
      _url,
      init,
    ) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        content: [{ type: 'text', text: 'ok' }],
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      });
    }) as typeof fetch);
    await client.complete([{ role: 'user', content: '你好' }], [], { maxTokens: 4000 });
    await client.complete([{ role: 'user', content: '你好' }], [], { maxTokens: 512 });
    for (const [index, expected] of [768, 512].entries()) {
      const payload = format === 'gemini' ? bodies[index].generationConfig : bodies[index];
      assert.equal(
        payload[format === 'gemini' ? 'maxOutputTokens' : 'max_tokens'],
        expected,
        format,
      );
      assert.equal(payload.temperature, 0.25, format);
    }
  }
});

test('推理模型使用 completion token 上限，留空温度不发送该字段', async () => {
  let body: any;
  const client = new HttpModel({ ...config, model: 'o3', maxTokens: 1024 }, (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  }) as typeof fetch);
  await client.complete([{ role: 'user', content: '你好' }]);
  assert.equal(body.max_completion_tokens, 1024);
  assert.equal(Object.hasOwn(body, 'max_tokens'), false);
  assert.equal(Object.hasOwn(body, 'temperature'), false);
});

test('输入预算包含图片、工具与续传内容，超限时不会发出网络请求', async () => {
  const messages: ModelMessage[] = [
    { role: 'system', content: '人物设定' },
    { role: 'user', content: '看看这张图片', images: ['data:image/png;base64,AAAA'] },
    {
      role: 'assistant',
      content: '',
      raw: { role: 'assistant', content: '', reasoning_content: '推理续传'.repeat(1000) },
    },
  ];
  const estimate = estimateRequestTokens(messages, [tool]);
  assert.ok(estimate > estimateRequestTokens(messages));
  assert.ok(estimate > 12000);
  let requests = 0;
  const fetcher = (async () => {
    requests++;
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  }) as typeof fetch;
  await assert.rejects(
    new HttpModel({ ...config, inputBudgetTokens: estimate - 1 }, fetcher).complete(messages, [
      tool,
    ]),
    /超过/,
  );
  await assert.rejects(
    new HttpModel(
      { ...config, contextWindowTokens: estimate + config.maxTokens + 1023 },
      fetcher,
    ).complete(messages, [tool]),
    /超过/,
  );
  assert.equal(requests, 0);
  await new HttpModel(
    {
      ...config,
      inputBudgetTokens: estimate,
      contextWindowTokens: estimate + config.maxTokens + 1024,
    },
    fetcher,
  ).complete(messages, [tool]);
  assert.equal(requests, 1);
});

test('中文、英文和表情裁剪遵守估算预算，不产生半个 Unicode 字符', () => {
  const text = 'hello，今天一起去海边🌊看日落吧。'.repeat(50);
  for (const budget of [0, 1, 20, 99, 200]) {
    const trimmed = trimToTokens(text, budget);
    assert.ok(text.startsWith(trimmed));
    assert.ok(estimateTextTokens(trimmed) <= budget);
    assert.doesNotMatch(trimmed, /[\uD800-\uDFFF]/u);
  }
  assert.equal(trimToTokens('🌊', 1), '');
  assert.equal(trimToTokens('🌊', 2), '🌊');
});
