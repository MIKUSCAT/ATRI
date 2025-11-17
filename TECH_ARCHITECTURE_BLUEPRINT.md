# ATRI 技术架构蓝图

> 文档目标：让团队成员在 10 分钟内弄清楚「文件结构、核心端口、运行原理、扩展方法」，从而可以安全地做二次开发或定制部署。整篇文字只描述事实和操作步骤，尽量避免抽象术语。

---

## 1. 系统角色速览
| 角色 | 技术栈 | 主要工作 |
| --- | --- | --- |
| Android 客户端 (`E:/ATRI/ATRI`) | Kotlin + Jetpack Compose + Room + Retrofit | 提供聊天 UI、填写 Worker 地址、保存本地消息与日记、上报会话日志、触发日记生成。 |
| Cloudflare Worker (`E:/ATRI/worker`) | TypeScript + itty-router + Wrangler | 接收聊天/日记/附件请求，调用 OpenAI 兼容接口，写入 Cloudflare D1、Vectorize、R2，并在 Cron 中自动生成日记。 |
| 共享提示词 (`E:/ATRI/shared`) | JSON | 统一维护 chat/diary 的人格定义。 |
| 同步脚本 (`E:/ATRI/scripts`) | Python | 将提示词复制到 Android 资产目录与 Worker 配置，保证端到端一致。 |

外部服务：Cloudflare D1（结构化数据）、Vectorize（向量检索）、R2（文件）、OpenAI 推理接口、SiliconFlow Embedding。

---

## 2. 总体数据流
```
Android ChatScreen ──POST /chat──▶ Worker routes/chat ──▶ OpenAI 推理
          │                                            │
          │◀─SSE stream────────────────────────────────┘
          │
          ├─POST /conversation/log─▶ D1.conversation_logs
          │
          ├─POST /upload ─▶ R2（附件） │
          │                          └─GET /media/:key 返回 URL
          │
          ├─POST /diary/generate ─▶ Worker routes/diary ─▶ OpenAI 推理
          │                            │
          │                            ├─写入 D1.diary_entries
          │                            └─调用 memory-service 写 Vectorize
          │
Cloudflare Cron ─scheduled──▶ runDiaryCron() ─▶ fetchConversationLogs() ─▶ generateDiary...
```

---

## 3. 文件结构（含重点文件）
```
E:/ATRI
├─ ATRI/
│  ├─ app/src/main/java/me/atri/
│  │  ├─ ui/chat/ChatScreen.kt                 # SSE 渲染、消息输入、状态栏
│  │  ├─ ui/diary/DiaryTab.kt                  # 本地 Room 日记列表
│  │  ├─ ui/settings/SettingsScreen.kt         # Worker URL / userId 设置
│  │  ├─ data/api/AtriApiService.kt            # 与 Worker 的 Retrofit 接口
│  │  ├─ data/repository/ChatRepository.kt     # 聊天、记忆、日志封装
│  │  ├─ data/repository/DiaryRepository.kt    # 生成 / 拉取日记
│  │  ├─ data/datastore/PreferencesStore.kt    # 保存 userId、baseUrl、昵称
│  │  ├─ di/NetworkModule.kt                   # OkHttp + Retrofit 单例
│  │  └─ utils/                                # SSE 解析、附件格式化等
│  └─ app/src/main/assets/prompts.json         # 由脚本生成
│
├─ worker/
│  ├─ src/index.ts                             # 路由注册 + Cron 入口
│  ├─ src/routes/chat.ts                       # 主聊天接口
│  ├─ src/routes/diary.ts                      # 日记查询/生成/索引
│  ├─ src/routes/conversation.ts               # 会话日志读写
│  ├─ src/routes/media.ts                      # 附件上传/读取
│  ├─ src/routes/admin.ts                      # 受保护的运维接口（清理用户数据与附件）
│  ├─ src/jobs/diary-cron.ts                   # Cron 任务
│  ├─ src/services/openai-service.ts           # 统一封装 /chat/completions 调用
│  ├─ src/services/memory-service.ts           # Embedding + Vectorize
│  ├─ src/services/data-service.ts             # D1 操作（日志、日记）
│  ├─ src/services/diary-generator.ts          # 调用提示词生成日记
│  ├─ src/utils/                               # SSE、附件、文本清洗、时间
│  ├─ src/config/prompts.json                  # 提示词副本
│  ├─ db/schema.sql                            # D1 表结构
│  └─ wrangler.toml                            # 账号、绑定、Cron 配置
│
├─ shared/prompts.json
└─ scripts/sync_shared.py
```

### 3.1 目录补充说明（从源码角度看各角色）
- **Android 客户端 `ATRI/`**：`app/build.gradle.kts` 使用 Kotlin 1.9.22、Compose BOM、Room、Koin，并在 `preBuild` 阶段执行 `syncPrompts` 任务把 `shared/prompts.json` 复制到 `app/src/main/assets`。
  - `me/atri/di/*.kt` 把依赖拆成 `appModule`（Room + DataStore + PromptProvider）、`networkModule`（OkHttp + Retrofit）、`repositoryModule`、`viewModelModule`。
  - `data/repository/ChatRepository.kt` 负责上传附件、写入本地 `MessageDao`、调用 `/chat`、解析 SSE，且会将用户/ATRI 的发言回传 `/conversation/log`。
  - `data/db/AtriDatabase.kt` 注册消息、消息版本、日记、记忆四张表，`MessageDao` 自带软删除、按时段查询、统计能力，供 BottomSheet、状态栏使用。
  - `data/datastore/PreferencesStore.kt` 保存 Worker URL、userId、昵称、亲密度、头像；`UserDataManager` 可一键清空 Room 并重置 userId。
  - `data/prompt/PromptProvider.kt` 统一加载 assets，下游 UI（如状态 Tab）据此获取阶段名称。
- **Cloudflare Worker `worker/`**：TypeScript + itty-router，`src/index.ts` 注册 `/chat`、`/diary`、`/conversation`、`/media`、`/admin`，并在 `scheduled` 钩子执行 `runDiaryCron()`。
  - `routes/chat.ts` 组合日记记忆、Vectorize 检索、当日对话流（`fetchConversationLogsSince()`）与历史日记回放（`buildLongTermRecalls()`），再调用 `callChatCompletions()`，最后用 `pipeChatStream()` 输出 reasoning/text SSE。
  - `routes/diary.ts` 与 `jobs/diary-cron.ts` 共用 `generateDiaryFromConversation()`，支持手动生成、强制索引、Cron 批量补齐，失败会写入 `status = error`。
  - `routes/conversation.ts` 提供 `/conversation/log` 与 `/conversation/last`；`routes/media.ts` 直接写 `MEDIA_BUCKET` 并暴露 `/media/:key`；`routes/admin.ts` 需 `ADMIN_API_KEY`，可以顺序清理 D1、Vectorize、R2。
  - `services/` 拆分 D1、记忆、OpenAI、提示词、日记生成；`db/schema.sql` 定义所有表；`wrangler.toml` 预设 R2/Vectorize/D1 绑定与 Cron。
- **共享提示词 `shared/`**：`prompts.json` 包含 `chat/diary/summary/memory/notify` 五段，Android `PromptProvider` 与 Worker `chat-service`、`diary-generator` 同时引用，确保人格一致。
- **脚本 `scripts/`**：`sync_shared.py` 用 `shutil.copy2` 同步提示词到 App、Worker，执行时会打印源→目标，便于 CI 观察。

---

## 4. 核心运行原理
### 4.1 聊天链路
1. Android `ChatScreen` 读取本地用户配置，构建 `ChatRequest`：`userId`、`content`、`imageUrl`、`recentMessages` 等。
2. Worker `/chat`：
   - 根据 `userId + content` 调用 `searchMemories()`，检索 Vectorize 中的记忆。
   - 使用 `composeSystemPrompt()` 拼接基础人格、阶段提示、关联记忆，同时把当天的“工作记忆”（`fetchConversationLogsSince()`）与历史日记回放（`buildLongTermRecalls()`）注入 `workingMemoryTimeline`、`longTermContext`。
   - 把历史消息与附件格式化为 OpenAI 兼容结构，图片会转换为 `image_url`，普通文件以“用户上传的文件 … 地址 …”的文本说明。
   - 通过 `callChatCompletions()` 调 Cloudflare 代理的 `OPENAI_API_URL`，模型名默认 `openai.gpt-5-chat`，启用 `stream: true`，超时时间由调用方传入（聊天 120s、日记 60s）。
   - 用 `pipeChatStream()` 将分片拆成 reasoning/text SSE 并发回客户端，便于在 UI 中显示“思考过程”。
3. Android 解析 SSE（见 `utils/sse`），实时渲染在聊天 UI。

### 4.2 记忆检索与写入
- 检索：`searchMemories()` 先调用 `embedText()`（SiliconFlow），然后在 `VECTORIZE` 索引里查询 topK=3，并过滤 `metadata.u == userId`。
- 写入：
  - 日记：`upsertDiaryMemory()` 以 `diary:<userId>:<date>` 作为向量 ID，仅写入 `userId + 日期 + mood + timestamp` 的轻量元数据，正文依旧保存在 D1。
  - 聊天记忆：逻辑目前收敛到客户端触发，调用 `/conversation/log` 保存原文，然后由 Cron 拿历史对话生成日记，再写 Vectorize。若后续要恢复 `/memory/extract`，可以基于 `memory-service` 继续扩展。

### 4.3 日记生成（手动/自动）
1. 手动：
   - Android 在日记页点击「立即生成」，先把当天聊天记录拼成对话文本，POST `/diary/generate`。
   - Worker 调 `generateDiaryFromConversation()`，把结果写入 D1（`saveDiaryEntry()`）与 Vectorize。
2. 自动（Cron）：
   - `wrangler.toml` 中 `[triggers] crons = ["59 15 * * *"]`，即每天 UTC 15:59。
   - 定时触发 `runDiaryCron()`：
     1. `listPendingDiaryUsers()` 找出当天已聊天但没有 `status = 'ready'` 日记的用户。
     2. `fetchConversationLogs()` 拉取该用户当天的所有日志，拼成 transcript。
     3. 计算距离上次对话的天数，带到提示词里增强情感氛围。
     4. 调 `generateDiaryFromConversation()`，成功后写入 D1 + Vectorize，失败则写入一条 status=`error` 的日记以便排查。

### 4.4 附件与多模态
- `/upload` 接受任意二进制流，以 `X-File-*` 头部传文件名、类型、大小、userId。
- 存储策略：`MEDIA_BUCKET.put(objectKey, body, httpMetadata)`，objectKey 格式 `u/<userId>/<timestamp>-<fileName>`。
- `/media/:key` 直接从 R2 拉取并设置缓存头，客户端将 URL 当图片或文件链接使用。
- 聊天图片：`ChatScreen` 会把上传后的 URL 写进 `attachments`，Worker `buildUserContentParts()` 会把它拼进消息列表。

### 4.5 配置与提示词
- 所有提示词集中在 `shared/prompts.json`，包含 `chat.base`、`chat.coreMemories`、`chat.stages`、`diary.system`、`diary.userTemplate` 等字段。
- `scripts/sync_shared.py` 会将文件复制到：
  1. `ATRI/app/src/main/assets/prompts.json`
  2. `worker/src/config/prompts.json`
- Worker `composeSystemPrompt()`、`generateDiaryFromConversation()` 会直接引用 `src/config/prompts.json`。

---

## 5. HTTP 端口 & 报文细节
### 5.1 聊天
```http
POST /chat
Content-Type: application/json
{
  "userId": "u-123",
  "content": "晚上好呀",
  "recentMessages": [ {"content": "...", "isFromAtri": true} ],
  "currentStage": 2,
  "userName": "阿栖",
  "clientTimeIso": "2025-02-12T22:35:00+08:00",
  "attachments": [ {"type": "image", "url": "https://..."} ]
}
```
响应是 SSE 流，分片示例：
```
data: {"type":"reasoning","content":"(ATRI 内心 OS ...)"}

data: {"type":"text","content":"晚上好呀~"}
```

### 5.2 会话日志
```http
POST /conversation/log
{
  "userId": "u-123",
  "role": "user",      // 或 atri
  "content": "今天见到你真开心",
  "timestamp": 1739616000000,
  "userName": "阿栖",
  "timeZone": "Asia/Shanghai"
}
```
返回 `{ "ok": true, "id": "...", "date": "2025-02-15" }`。日期由服务器按照 `timeZone` 计算。

### 5.3 日记接口
- `GET /diary?userId=u-123&date=2025-02-15` → `{ status: "ready", entry: { ... } }`
- `GET /diary/list?userId=u-123&limit=7` → `{ entries: [ ... ] }`
- `POST /diary/generate` 额外参数 `persist`（默认 true）可用于只取文本不写库。
- `POST /diary/index` 则完全跳过模型，直接把已有文本写进数据库 + Vectorize。

### 5.4 附件
```
POST /upload
Headers:
  X-File-Name: pic.png
  X-File-Type: image/png
  X-File-Size: 123456
  X-User-Id: u-123
Body: <binary>
```
返回 `{ "key": "u/u-123/1700000000000-pic.png", "url": "https://.../media/..." }`。

---

## 6. Android 端实现要点
1. **网络层**：`NetworkModule` 在启动时读取 DataStore 里的 baseUrl，若为空采用 `https://atri-worker.example.com` 作为占位。OkHttp 启用了 `HttpLoggingInterceptor`，方便调试 SSE。
2. **数据同步**：`ChatRepository` 会一边读本地消息，一边监听 SSE 返回；`DiaryRepository` 负责触发 `/diary/generate` 并把结果写入 Room。
3. **设置项**：`PreferencesStore` 保存 Worker URL、昵称、`userId`。清空数据会生成新的 UUID，等同于“遗忘旧记忆”。
4. **WorkManager（历史代码）**：`ATRI/app/src/main/java/me/atri/worker/` 留下了旧的本地提醒任务。如需恢复本地定时器，可在这里扩展；但目前主流程依赖 Cloudflare Cron。
5. **提示词展示**：`PromptProvider` 直接读取 `assets/prompts.json`，用于在 UI 上显示阶段介绍，保证与服务端同步。

---

## 7. Worker 端实现要点
1. **Wrangler 配置**：`wrangler.toml` 已绑定 Vectorize、R2、D1，并设置 Cron。只需修改 `account_id`、`index_name`、`bucket_name` 即可适配自己的账号。
2. **环境变量**：
   - 必填：`OPENAI_API_KEY`、`EMBEDDINGS_API_KEY`
   - 可选：`OPENAI_API_URL`（默认为 `https://aigate.binklac.com/v1`）、`EMBEDDINGS_API_URL`（默认为 `https://api.siliconflow.cn/v1`）、`EMBEDDINGS_MODEL`、`ADMIN_API_KEY`（启用受保护的 `/admin/clear-user`）
3. **服务层**：
   - `openai-service` 统一设置超时（默认 60s，可通过参数传入 120s）
   - `memory-service` 直接使用 `diary:<userId>:<date>` 作为向量主键，只写入轻量 metadata，聊天时再根据 ID 回查 D1 获取正文
   - `data-service` 在 `saveDiaryEntry()` 中使用 `INSERT ... ON CONFLICT`，可以重复写同一天的数据
4. **错误处理**：每个路由捕获异常，返回 JSON `{ error: 'xxx', details }`，方便客户端提示。
5. **Cron 回退**：若自动生成失败，会插入一条内容为“自动日记生成失败，请稍后重试”的记录，方便 UI 给出友好的提示。

---

## 8. 数据模型
### 8.1 D1：conversation_logs
| 字段 | 说明 |
| --- | --- |
| `id` (TEXT) | UUID，服务器端生成。 |
| `user_id` | 与客户端 `userId` 对应。 |
| `date` | 当地时区计算出的 yyyy-MM-dd。 |
| `role` | `user` 或 `atri`。 |
| `content` | 清洗后的对话内容。 |
| `attachments` | JSON 字符串，存储图片等附加信息。 |
| `timestamp` | 原始毫秒值，便于排序。 |
| `user_name` / `time_zone` | 可选字段，方便后续做个性化提示。 |

### 8.2 D1：diary_entries
| 字段 | 说明 |
| --- | --- |
| `id` | `diary:<userId>:<date>`。 |
| `summary` | 80 字摘要，用于列表展示。 |
| `content` | 日记全文。 |
| `mood` | `generateDiaryFromConversation` 根据文本粗略判断的心情。 |
| `status` | `pending` / `ready` / `error`，Cron 失败时会写 `error`。 |
| `created_at` / `updated_at` | 时间戳。 |

### 8.3 Vectorize 元数据（`memory-service.ts`）
| 键 | 说明 |
| --- | --- |
| `u` | userId，用于过滤。 |
| `c` | 分类：`diary` 或其他。 |
| `d` | diaryId / 日期。 |
| `m` | mood。 |
| `imp` | importance，日记固定 6。 |
| `ts` | 写入时间。 |

> 经过改造后，Vectorize metadata 不再存放摘要或正文，所有文本都需要根据 `id` 回查 D1，进一步降低泄露风险。

---

## 9. 二次开发策略
1. **自定义人格**：改 `shared/prompts.json` → `python3 scripts/sync_shared.py` → 重启 IDE / 重新部署 Worker。
2. **替换模型**：改 `wrangler.toml` 中的 `OPENAI_API_URL`、`EMBEDDINGS_*` 或者在 Cloudflare Secrets 里覆盖；Android 如需显示模型名，可在设置页添加输入框。
3. **新增业务接口**：
   - 在 `worker/src/routes/` 新建路由并在 `index.ts` 注册。
   - 在 `AtriApiService` 新增 Retrofit 定义，Repository 调用即可。
4. **多端同步**：可在 Worker 新增 `/sync/messages` 之类的接口，将 D1 数据下发给多个客户端；Android 端对应地在 Room 中建立同步标记。
5. **安全控制**：如果要加鉴权，可在 Worker 路由里校验自定义 Header（例如 `X-Api-Key`），或用 Cloudflare Access/JWT。

---

## 10. 测试与排查
- **本地联调**：先 `npm run dev`，再在 Android 设置页输入 `http://10.0.2.2:8787`（Android 模拟器）或 `http://<局域网IP>:8787`（真机）。
- **日志查看**：Cloudflare Dashboard -> Workers -> 日志；或 `wrangler tail` 查看实时输出。
- **D1 检查**：`wrangler d1 execute atri_diary --command "SELECT * FROM diary_entries LIMIT 5"`。
- **Vectorize 检查**：`npx wrangler vectorize query atri-memories --vector '[...]'`。
- **R2 检查**：Dashboard -> R2 -> 对应 bucket -> Objects。

---

## 11. 常用命令集合
| 场景 | 命令 |
| --- | --- |
| 同步提示词 | `python3 scripts/sync_shared.py` 或 `npm run sync-prompts`（在 worker） |
| 安装 Android 依赖 | `./gradlew assembleDebug` |
| 清理 Android 构建 | `./gradlew clean` |
| Worker 本地调试 | `cd worker && npm run dev` |
| Worker 部署 | `cd worker && npm run deploy` |
| 查看 D1 日记数量 | `wrangler d1 execute atri_diary --command "SELECT count(*) FROM diary_entries;"` |

---

## 12. 下一步可考虑的增强
1. **真正的多端同步**：扩展 Worker 提供 `GET /conversation/list`，Android 启动时拉取缺失的会话。
2. **消息回放/总结 API**：基于现有会话日志很容易加 `/chat/summarize`，Android 直接展示“今日总结”。
3. **权限与速率限制**：在 Worker 外层套 Cloudflare Access，或在 `Router` 层增加简单的 token 校验，防止他人滥用接口。
4. **端到端测试**：可使用 Playwright + Wrangler dev 模拟“App 发消息 → Worker 返回 SSE”全过程。

---

## 13. 环境与配置矩阵
| 场景 | Android 入口 | Worker 运行方式 | Cloudflare 资源 | 备注 |
| --- | --- | --- | --- | --- |
| 本地联调 | `http://10.0.2.2:8787`（模拟器）/ `http://<局域网IP>:8787`（真机） | `npm run dev`（Wrangler 本地，端口 8787） | 无需 R2 / Vectorize（但相关调用返回 mock，需要 `--remote` 才能访问云端绑定） | 适合调试 UI 与基本 SSE 流；记忆/附件功能依赖云端时可临时禁用。 |
| 远程沙箱 | `https://<worker>.workers.dev` | `npm run deploy` 部署到测试账号 | Cloudflare 免费套餐：1 个 R2 bucket、1 个 Vectorize、1 个 D1 | 注意免费版 Cron 触发存在 ±1 分钟延迟。 |
| 生产环境 | 自定义域名（例如 `https://atri-worker.example.com`） | 同上，但需在 Dashboard 绑定自定义域 | 至少 1 套 R2 / Vectorize / D1；建议单独账号管理 Secrets | 需要配置 HTTPS 证书、Access 控制以及更高的 Worker 限额。 |

> Secrets（`OPENAI_API_KEY`、`EMBEDDINGS_API_KEY`）只在 Cloudflare 端保存；本地联调可以通过 `.dev.vars` 或环境变量临时注入。

---

## 14. 典型运行生命周期
1. **首次部署**：同步提示词 → `npm install` → `npx wrangler login` → 创建/绑定 R2、Vectorize、D1 → 配置 Secrets → `npm run deploy`。
2. **用户初次使用**：安装 APK → 设置页填写 Worker URL/昵称 → 自动生成 `userId` → 开始聊天。
3. **每日闭环**：
   - 日间：Android 通过 `/chat`、`/conversation/log`、`/upload` 与 Worker 交互，被动触发记忆检索。
   - 夜间（UTC 15:59）：Cron 触发 `runDiaryCron()`，对当天未生成日记的用户拉取 `conversation_logs` → 生成日记 → 写 `diary_entries` + Vectorize。
   - 次日：Android 进入日记页，读取本地 Room；若需要同步云端，可调用 `/diary/list` 对比。
4. **提示词/模型更新**：修改 `shared/prompts.json` 或 `wrangler.toml` → 运行同步脚本 → 重新部署 Worker → Android 侧若需要展示新文案，重新打包或下发热更新。
5. **版本升级**：遵循“先 Worker 后 App”的顺序，确保新接口已上线再发客户端。

---

## 15. 功能模块与 API 对照
| 功能 | Android 端入口 | Worker 模块 | 端点/端口 | 说明 |
| --- | --- | --- | --- | --- |
| 聊天对话 | `ChatScreen` + `ChatRepository.sendMessage()` | `routes/chat.ts`, `services/chat-service.ts` | `POST /chat`（SSE，8787/HTTPS） | 自动注入阶段提示、记忆、时间；支持多图、文档。 |
| 会话日志 | `ConversationLogRequest` | `routes/conversation.ts`, `services/data-service.ts` | `POST /conversation/log` | 日志写入 D1，供 Cron/手动生成日记使用。 |
| 最近一次对话查询 | `ChatRepository.fetchLastConversation()` | 同上 | `GET /conversation/last` | 计算距离上一次有效对话多少天。 |
| 日记列表/详情 | `DiaryRepository.fetchDiaryList/detail` | `routes/diary.ts` | `GET /diary`、`GET /diary/list` | 直接从 D1 拉取现有记录。 |
| 日记生成（手动） | `DiaryRepository.generateDiaryNow()` | `routes/diary.ts`, `services/diary-generator.ts` | `POST /diary/generate` | 可传 `persist=false` 仅获取草稿。 |
| 日记索引（绕过生成） | 同上 | 同上 + `services/memory-service.ts` | `POST /diary/index` | 已有文本也可写入 D1 + Vectorize。 |
| 附件上传 | `uploadAttachment()` | `routes/media.ts` | `POST /upload`（二进制） + `GET /media/:key` | 由 Android 直连 Worker，Worker 代理上传到 R2。 |
| 云端清理 | 后台脚本 / 管理控制台 | `routes/admin.ts`, `services/data-service.ts`, `services/memory-service.ts` | `POST /admin/clear-user` | Header `Authorization: Bearer <ADMIN_API_KEY>`，根据 userId 删除 D1 日志、日记、向量与 R2 附件。 |
| Cron 自动任务 | 无需客户端 | `jobs/diary-cron.ts` + `services/*` | Cloudflare `scheduled` 事件 | 每天一次自动生成日记并写 Vectorize。 |

---

## 16. 性能、容量与扩展注意事项
- **SSE 并发**：Cloudflare Worker 每次请求最大 100 秒 CPU，`pipeChatStream` 已以流式返回减少占用；若需更高并发，可考虑分片 Worker 或减少 `max_tokens`/`temperature`。
- **D1 性能**：单表适合日活 1e4 级别。若需要更高吞吐，可迁移到外部数据库（PlanetScale、Neon），或在 Worker 中引入 `Durable Objects` 缓存热数据。
- **Vectorize 限额**：免费层 100K embedding；日记写入 importance=6，可按用户设置 TTL 或提供“归档”功能防止无限增长。
- **上传大小**：R2 接口默认支持最大 100MB，对应的移动网络瓶颈在 Android 端；可在客户端限制大小并给出提示。
- **延迟优化**：`searchMemories()` + OpenAI 请求并行会更快，目前串行设计是为了日志清晰；如需提速，可先调用向量检索 Promise，再与聊天请求使用 `Promise.all`。
- **容灾**：`generateDiaryFromConversation` 捕获异常后写 `status=error`，Android 可检测并提示用户重试；也可以在 Cron 成功后发送 webhook 通知。

---

## 17. 安全与权限建议
1. **密钥管理**：所有敏感 Key 仅存放于 Cloudflare Secrets，本地调试用 `.dev.vars` 时请勿提交到版本库。
2. **API 鉴权**：默认无鉴权，可按需添加：Client 在 Header 携带 `X-App-Token`，Worker 端检查 Env 中的共享密钥；或使用 Cloudflare Access/JWT 限制来源域名。
3. **传输安全**：生产必须通过 HTTPS，也可在 Worker 前面加 Cloudflare Zero Trust 强制 TLS 1.3。
4. **数据隐私**：D1/Vectorize 存放用户对话，可使用受 `ADMIN_API_KEY` 保护的 `/admin/clear-user` 接口删除指定 `userId` 的日志、日记、向量与 R2 附件。
5. **速率限制**：可结合 Cloudflare Turnstile/Rate Limiting Rules，或在 Worker 中统计 IP/UserId 请求频率，超过阈值返回 429。
6. **日志脱敏**：`sanitizeText` 已去除危险字符，但如需再处理，可在 `jsonResponse` 之前对内容进行掩码，避免在 `wrangler tail` 中输出敏感信息。

---

## 18. 运维与监控
- **实时日志**：`wrangler tail --format pretty` 可查看线上 SSE、Cron 输出；Cloudflare Dashboard 也能过滤单个 Worker。
- **Cron 结果**：Dashboard -> Workers & Pages -> Cron Triggers -> Runs 可展示最近触发/错误。也可在 `runDiaryCron` 中加入 webhook（例如飞书机器人）。
- **R2/Vectorize 健康检查**：使用 `npx wrangler r2 object list` 或 `npx wrangler vectorize info atri-memories` 定期巡检，防止索引超限。
- **错误告警**：可以在 Worker 中捕获异常后 `fetch` 到自建的监控接口，或使用 Cloudflare Logpush 把日志推送到第三方（Datadog、Loki）。
- **版本回滚**：Cloudflare Dashboard -> Workers & Pages -> Deployments -> Promote 旧版本；Android 则使用版本号 + 渠道跟踪，必要时下发热补丁关闭有问题的入口。

---

只要按照本蓝图理解结构，就能快速定位到需要修改的文件、知道每个端口的职责，并且清楚如何在 Cloudflare/Android 两端部署和排查。
