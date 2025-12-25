# Gemini 原生 API 支持

## 概述

ATRI 后端现在支持 Google Gemini 原生 API 格式，可以直接调用 Gemini 模型而无需通过 OpenAI 兼容层。

## 配置方法

### 环境变量

在 Cloudflare Worker 的环境变量中添加以下配置：

```bash
# Gemini 原生 API 配置（可选）
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_API_URL=https://generativelanguage.googleapis.com
```

**注意：**
- `GEMINI_API_KEY` 和 `GEMINI_API_URL` 是可选的
- 如果不配置，即使使用 `gemini-*` 模型名，系统也会自动回退到 OpenAI 兼容 API
- 原有的 OpenAI 兼容配置仍然有效
- 只有同时配置了 `GEMINI_API_KEY` 和 `GEMINI_API_URL` 时，才会使用 Gemini 原生 API

### 模型选择规则

系统会根据模型名称自动选择使用哪种 API：

1. **使用 Gemini 原生 API**：模型名以 `gemini-` 开头且不包含 `openai`
   - 示例：`gemini-2.5-flash`、`gemini-3-pro-preview`、`gemini-2.0-flash`

2. **使用 OpenAI 兼容 API**：其他所有模型
   - 示例：`openai.gpt-5-chat`、`gpt-4`、`claude-3-opus`

## 使用示例

### Android 客户端

在发送聊天请求时，指定 Gemini 模型：

```kotlin
val request = ChatRequest(
    userId = userId,
    content = "你好",
    modelKey = "gemini-2.5-flash"  // 使用 Gemini 原生 API
)
```

### API 调用

```bash
curl -X POST https://your-worker.workers.dev/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "X-App-Token: your_app_token" \
  -d '{
    "userId": "user123",
    "content": "你好",
    "modelKey": "gemini-2.5-flash"
  }'
```

## 功能特性

### 支持的功能

✅ **文本对话**：完整支持多轮对话
✅ **System Instruction**：自动转换 OpenAI 的 system 消息为 Gemini 的 systemInstruction
✅ **Function Calling**：完整支持工具调用（Tool Calling）
✅ **多模态输入**：支持图片和文档附件
✅ **流式响应**：完整支持 streaming，自动转换为 OpenAI SSE 格式
✅ **自动格式转换**：OpenAI 格式 ↔ Gemini 格式自动转换

### 格式转换

系统会自动处理以下转换：

1. **消息格式**
   - OpenAI: `messages` 数组 → Gemini: `contents` 数组
   - OpenAI: `role: "assistant"` → Gemini: `role: "model"`
   - OpenAI: `role: "system"` → Gemini: `systemInstruction`

2. **工具调用**
   - OpenAI: `tools` → Gemini: `functionDeclarations`
   - OpenAI: `tool_choice` → Gemini: `functionCallingConfig.mode`

3. **响应格式**
   - Gemini 响应自动转换为 OpenAI 兼容格式
   - 保持客户端代码无需修改

## 技术实现

### 核心文件

- `worker/src/services/gemini-service.ts` - Gemini API 服务实现
- `worker/src/services/agent-service.ts` - Agent 对话服务（已更新）
- `worker/src/services/diary-generator.ts` - 日记生成服务（已更新）
- `worker/src/services/profile-generator.ts` - 用户档案生成服务（已更新）
- `worker/src/services/self-review-generator.ts` - 自查生成服务（已更新）

### 关键函数

```typescript
// 统一的聊天完成接口
export async function callChatCompletionsUnified(
  env: Env,
  payload: { messages, tools, ... },
  options?: { model, apiUrl, apiKey, ... }
): Promise<Response>

// 判断是否使用 Gemini 原生 API
export function isGeminiNativeModel(model: string): boolean

// 格式转换函数
export function convertOpenAIMessagesToGemini(messages): { contents, systemInstruction }
export function convertOpenAIToolsToGemini(tools): GeminiTool[]
export function convertGeminiResponseToOpenAI(response, model): OpenAIResponse
```

## 优势

1. **原生支持**：直接使用 Gemini API，无需中间层转换
2. **更好的兼容性**：充分利用 Gemini 特有功能
3. **向后兼容**：不影响现有 OpenAI 兼容模型的使用
4. **灵活切换**：可以在不同模型间自由切换
5. **统一接口**：客户端无需修改，服务端自动处理

## 注意事项

1. **API Key 管理**
   - 确保 `GEMINI_API_KEY` 安全存储
   - 不要在客户端代码中硬编码 API Key

2. **模型命名**
   - 使用正确的 Gemini 模型名称
   - 参考：https://ai.google.dev/gemini-api/docs/models

3. **配额限制**
   - 注意 Gemini API 的速率限制
   - 合理设置超时时间（默认 60 秒）

4. **错误处理**
   - 系统会自动处理 API 错误
   - 错误信息会转换为统一格式返回

## 测试建议

1. **基础对话测试**
   ```bash
   # 测试 Gemini 模型
   curl -X POST https://your-worker.workers.dev/api/v1/chat \
     -H "Content-Type: application/json" \
     -H "X-App-Token: your_token" \
     -d '{"userId": "test", "content": "你好", "modelKey": "gemini-2.5-flash"}'
   ```

2. **工具调用测试**
   - 测试 Agent 的 `update_mood` 和 `read_diary` 工具
   - 验证工具调用是否正常工作

3. **多模态测试**
   - 发送带图片的消息
   - 验证图片是否正确处理

## 故障排查

### 问题：API 调用失败

**检查项：**
1. `GEMINI_API_KEY` 是否正确配置
2. `GEMINI_API_URL` 是否正确（默认：`https://generativelanguage.googleapis.com`）
3. 模型名称是否正确
4. 网络连接是否正常

### 问题：工具调用不工作

**检查项：**
1. 确认使用的是 Gemini 2.5+ 模型（支持 Function Calling）
2. 检查工具定义格式是否正确
3. 查看日志中的错误信息

### 问题：响应格式错误

**检查项：**
1. 确认 `convertGeminiResponseToOpenAI` 函数是否正确执行
2. 检查 Gemini API 返回的原始响应
3. 验证客户端是否正确解析响应

## 更新日志

### 2025-12-26
- ✨ 新增 Gemini 原生 API 支持
- ✨ 实现 OpenAI ↔ Gemini 格式自动转换
- ✨ 更新所有服务以支持统一接口
- 📝 添加配置文档

## 参考资料

- [Gemini API 官方文档](https://ai.google.dev/gemini-api/docs)
- [Gemini API REST 参考](https://ai.google.dev/gemini-api/docs/api-overview)
- [Function Calling 指南](https://ai.google.dev/gemini-api/docs/function-calling)
