# ATRI 技术架构蓝图

> 目标：用十分钟了解 ATRI 工程的结构、数据流、关键接口与扩展方式，方便后续安全地定制或部署。文字尽量直白，所有路径都按照仓库现状编写。

---

## 1. 系统角色速览
| 角色 | 技术栈 | 主要职责 |
| --- | --- | --- |
| Android 客户端（`ATRI/ATRI`） | Kotlin、Jetpack Compose、Room、Retrofit、Koin | 提供聊天 UI、上传附件、记录本地消息与日记、把所有对话回写到云端。 |
| Cloudflare Worker（`ATRI/worker`） | TypeScript、itty-router、Wrangler | 提供 `/chat`、`/conversation/*`、`/diary`、`/upload`、`/models`、`/admin/clear-user`，并在 `scheduled` 事件里自动生成日记和长期记忆。 |
| 共享提示词（`shared/prompts.json`） | JSON | 定义 ATRI 的人格、日记模板、长期记忆提炼方式，App 与 Worker 通过脚本保持完全一致。 |
| 辅助脚本（`scripts/sync_shared.py`） | Python | 把提示词拷贝到 `worker/src/config/prompts.json` 和 `ATRI/app/src/main/assets/prompts.json`，避免“看到的”和“实际使用的”不一致。 |

外部依赖：Cloudflare D1（结构化数据）、Cloudflare Vectorize（向量记忆）、Cloudflare R2（附件）、OpenAI 兼容推理 API、OpenAI 兼容 Embedding API。

---

## 2. 总体数据流
```
Android ChatScreen
    │  1. POST /chat（SSE）
    ▼
Cloudflare Worker routes/chat ──▶ OpenAI /chat/completions
    │                              （携带人格 + 记忆 + 图片）
    │◀────────────── SSE reasoning + text
    │
    ├─POST /conversation/log──▶ D1.conversation_logs
    ├─POST /upload────────────▶ R2（任意文件） → GET /media/:key
    └─GET /diary /diary/list──▶ D1.diary_entries

Cloudflare Cron Trigger（每天 UTC 15:59）
    │
    └─runDiaryCron()
        ├─fetchConversationLogs()
        ├─generateDiaryFromConversation()
        ├─saveDiaryEntry() → D1.diary_entries
        ├─upsertDiaryMemory() → Vectorize（长期记忆）
        ├─extractMemoriesFromText() → D1.user_memories + Vectorize
        └─generateDailyLearning() → D1.daily_learning
```

---

## 3. 目录与关键文件
```
repo-root
├─ ATRI/
│  ├─ app/src/main/java/me/atri/
│  │  ├─ ui/                     # Compose 界面：Chat、Diary、Settings、Welcome
│  │  ├─ data/api/AtriApiService.kt
│  │  ├─ data/repository/*.kt    # ChatRepository、DiaryRepository、SettingsRepository...
│  │  ├─ data/db/                # Room 实体与 DAO
│  │  ├─ data/datastore/         # PreferencesStore（userId、workerUrl 等）
│  │  ├─ di/                     # appModule / networkModule / repositoryModule / viewModelModule
│  │  └─ utils/                  # SSE 解析、附件、Markdown、Emoji 工具
│  ├─ app/build.gradle.kts       # Compose BOM、OkHttp SSE、Room KSP 等依赖
│  └─ app/src/main/assets/prompts.json
│
├─ worker/
│  ├─ src/index.ts               # itty-router 注册 + scheduled 入口
│  ├─ src/routes/chat.ts         # 主聊天接口
│  ├─ src/routes/conversation.ts # 会话日志写删查
│  ├─ src/routes/diary.ts        # GET /diary 与 GET /diary/list
│  ├─ src/routes/media.ts        # 附件上传与读取
│  ├─ src/routes/models.ts       # 模型列表代理
│  ├─ src/routes/admin.ts        # 管理端清理接口
│  ├─ src/jobs/diary-cron.ts     # 自动日记/记忆脚本
│  ├─ src/services/*.ts          # openai-service、memory-service、data-service 等
│  ├─ src/utils/*.ts             # jsonResponse、stream、attachments、date、file、sanitize
│  ├─ src/config/prompts.json    # 由脚本同步
│  ├─ db/schema.sql              # D1 表结构
│  └─ wrangler.toml              # Cloudflare 资源绑定与 Cron
│
├─ shared/prompts.json           # 提示词母本
└─ scripts/sync_shared.py        # 同步脚本
```

---

## 4. 核心运行机制
### 4.1 聊天链路
1. **前置步骤**：Android 端会把所有附件先 POST `/upload`，拿到 R2 的公共 URL，再构造成 `attachments` 列表。
2. **发送消息**：`ChatRepository.sendMessage()` 写入本地 Room → 异步调用 `/chat`。同时将用户发言 POST `/conversation/log`，保证 D1 有原始记录。
3. **Worker 处理**：
   - `searchMemories()`：输入内容先走 Embedding，再从 Vectorize 查询 topK=3 的记忆（仅保留 metadata，真正正文要在 D1 里回查）。
   - `buildLongTermRecalls()`：如果命中日记记忆，就反向查询 D1，拿到对应日期的对话摘要，拼出“想起的往事”。
   - `fetchConversationLogsSince()`：取当天 0 点后的对话，构造“工作记忆时间线”，确保多轮聊天连贯。
   - `getRecentDailyLearnings()`、`getTopUserMemories()`、`buildEmotionContext()`：补充最近学习记录、结构化偏好，以及“多久没聊天”“上次心情”等轻量情绪。
   - `composeSystemPrompt()`：按提示词定义，把人格、阶段、记忆、情绪、当前时间拼成 system prompt。
   - `callChatCompletions()`：面向 `OPENAI_API_URL` 发起 `stream: true` 请求（默认 120 秒超时）。
   - `pipeChatStream()`：把 reasoning/text 两种片段通过 SSE 原封不动传给客户端。
4. **保存回答**：Android 端把 ATRI 的回复写入 Room，再次调用 `/conversation/log`，以便 Cron 复用。

### 4.2 自动日记 + 结构化记忆
1. Cron 由 `wrangler.toml` 中 `crons = ["59 15 * * *"]` 配置，UTC 15:59 运行。
2. `listPendingDiaryUsers()` 寻找“今天在 conversation_logs 里出现，但没有 status=ready 日记”的 userId 列表。
3. 对每个用户：
   - `fetchConversationLogs()` 取当天全部对话 → `buildConversationTranscript()` 变成可读文本；
   - `generateDiaryFromConversation()`（内部再次调用 `callChatCompletions`）生成日记正文、高光、心情；
   - `saveDiaryEntry()` 落到 D1，失败时写 status=`error`，方便客户端提示；
   - `upsertDiaryMemory()` 把 200 字摘要写进 Vectorize，metadata 只留 userId、date、mood、timestamp；
   - `extractMemoriesFromText()` → `saveUserMemories()` + `upsertStructuredMemories()`，将偏好/关系/禁忌等结构化信息写入 D1 + Vectorize；
   - `generateDailyLearning()` + `saveDailyLearning()` 产出“今天我学到了什么”。
4. Android 端通过 `/diary/list`、`/diary` 拉取数据，再同步进本地 Room；目前客户端没有主动触发日记的接口。

### 4.3 情绪与记忆融合
- `getTopUserMemories()`：按照重要性排序，最多返回 15 条结构化记忆，并按 `user_fact`、`user_preference` 等类别分组显示在 prompt 中。
- `buildEmotionContext()`：结合 `getLastConversationDate()`、最近日记心情、`daily_learning` 提炼成“心情提醒”。
- 所有信息都走 `composeSystemPrompt()` 的“我记得的事 / 现在的心情 / 最近的小反思”3 个 Sections，保证 prompt 清晰且可控。

### 4.4 附件与清理
- `/upload`：Body 是二进制流，Header 中的 `X-File-*` 字段会加进 R2 对象的 metadata，下载时自动带上 `Content-Type` 和 `Content-Disposition`。
- `/media/:key`：公开访问，返回 1 年缓存头。若担心泄露，可在 Cloudflare Dashboard 上加防盗链或 Private Bucket。
- `/admin/clear-user`：需要在 Cloudflare Secret 里设置 `ADMIN_API_KEY`，请求时通过 `Authorization: Bearer <key>` 发送。接口顺序删除 D1 日记、对话、Vectorize 中的日记向量、用户附件（遍历 R2 前缀 `u/<user>/`）。

---

## 5. Android 端实现要点
1. **入口**：`MainActivity` 注入 `PreferencesStore`，`AtriApp()` 里根据「是否首次启动」「是否打开设置/日记页」决定要渲染的 Compose Screen。
2. **依赖注入**：Koin 模块拆成 `appModule`（Room、DataStore、PromptProvider）、`networkModule`（OkHttp + Retrofit + SSE）、`repositoryModule`、`viewModelModule`。因此要在新增仓储类时记得更新模块。
3. **网络层**：
   - Retrofit 只负责短连接接口；聊天走 OkHttp SSE（`StreamCollector`），在仓储层实时把分片写入 UI。
   - `ChatRepository` 负责：上传附件、写本地消息、调用 `/chat`、持续收听流、在收到最终内容后写入 Room、同步 `/conversation/log`。
   - `DiaryRepository` 目前只调用 `/diary/list`、`/diary`，再写入 Room。旧版 `generateDiaryNow()` 已移除。
4. **Room 结构**：
   - `MessageEntity` / `MessageDao`：保存聊天记录、附件、是否为 ATRI、思考片段等。
   - `MessageVersionEntity`：记录多次重写（例如大模型回退）的版本。
   - `DiaryEntity`：缓存日记概要与全文，方便离线阅读。
5. **DataStore**：记录 Worker URL、userId、昵称、头像、自定义阶段。`PreferencesStore.ensureUserId()` 会在缺失时自动生成 UUID。
6. **附件体验**：通过 `AttachmentContract` 统一描述 `image` / `document` / `emoji`，UI 端可以直接根据 type 渲染不同组件。
7. **清空数据**：设置页提供“一键清空”按钮，调用 `UserDataManager` 清空全部 Room 表，并生成新的 userId，相当于“重新认识 ATRI”。

---

## 6. Worker 端实现要点
1. **入口文件 `src/index.ts`**：创建 itty-router，注册 `/chat`、`/media`、`/diary`、`/conversation`、`/admin`、`/models`，最后暴露 `fetch` 与 `scheduled`。
2. **环境变量**（在 Cloudflare Secrets 中设置）：
   - `OPENAI_API_KEY`（必填）、`OPENAI_API_URL`（默认 `https://api.openai.com/v1`）；
   - `EMBEDDINGS_API_KEY`、`EMBEDDINGS_API_URL`、`EMBEDDINGS_MODEL`；
   - `ADMIN_API_KEY`（可选，控制 `/admin/clear-user`）。
3. **Wrangler 配置 `wrangler.toml`**：
   - `[vars]` 填好默认 API URL、embedding 模型；
   - `[[vectorize]]`、`[[r2_buckets]]`、`[[d1_databases]]` 绑定 Cloudflare 资源；
   - `[triggers] crons = ["59 15 * * *"]` 指向自动日记；
   - 如果要预览 R2，还可以设置 `preview_bucket_name`。
4. **服务层**：
   - `openai-service.ts`：统一控制请求超时、错误格式；
   - `memory-service.ts`：封装向量写入/查询、结构化记忆 upsert、批量删除；
   - `data-service.ts`：对 D1 的所有操作都集中在这里（日志、日记、每日学习、记忆、删除）；
   - `diary-generator.ts` / `daily-learning.ts` / `memory-extractor.ts`：都基于提示词调用大模型，封装好输入输出结构。
5. **工具层**：
   - `utils/stream.ts` 把大模型 SSE 拆成 JSON 对象，兼容 `type: reasoning/text`；
   - `utils/attachments.ts` 把历史消息中的图片、文档转为模型可读的 `ContentPart[]`；
   - `utils/date.ts` 提供 `resolveDayStartTimestamp`、`formatDateInZone` 等跨时区工具；
   - `utils/file.ts` 中的 `sanitizeFileName()` 确保 R2 路径安全。
6. **错误处理**：所有路由均返回 `jsonResponse({ error, details }, status)`，Android 端收到后会在 UI 中展示可读提示。Cron 执行失败会写入一条 `status=error` 的日记，方便客户端告知用户。

---

## 7. 数据模型
### 7.1 Cloudflare D1
| 表 | 关键字段 | 用途 |
| --- | --- | --- |
| `conversation_logs` | `id`, `user_id`, `date`, `role`, `content`, `attachments`, `timestamp`, `user_name`, `time_zone` | 保存所有原始对话，供 Cron 或分析使用。 |
| `diary_entries` | `id`, `user_id`, `date`, `summary`, `content`, `mood`, `status`, `created_at`, `updated_at` | 自动/手动生成的日记。当前只使用自动模式。 |
| `daily_learning` | `id`, `user_id`, `date`, `summary`, `payload` | 根据对话 + 日记推导出的反思文本，作为 prompt 中“近期反思”来源。 |
| `user_memories` | `id`, `user_id`, `category`, `key`, `value`, `importance`, `evidence`, `source_date` | 结构化记忆：用户事实、偏好、关系、禁忌、ATRI 自我成长。 |

建表脚本在 `worker/db/schema.sql`，`wrangler d1 execute <db>` 即可执行。

### 7.2 Cloudflare Vectorize
仅存摘要嵌入，不存正文，降低泄露风险。约定 metadata:
| 键 | 含义 |
| --- | --- |
| `u` | userId |
| `c` | 分类：`diary` 或结构化类别（`user_fact` 等） |
| `d` | 对于日记是日期，对于结构化记忆可放 source date |
| `k` | 结构化记忆的 key |
| `t` | 结构化记忆的 value 截断文本 |
| `m` | mood（仅日记） |
| `imp` | importance，默认 5，日记固定 6 |
| `ts` | 写入时间戳 |

### 7.3 提示词同步
1. 修改 `shared/prompts.json`；
2. 运行 `python scripts/sync_shared.py` 或者在 `worker` 和 `ATRI` 内执行 `npm run sync-prompts`/`./gradlew syncPrompts`；
3. 发版前确认 `worker/src/config/prompts.json` 与 `ATRI/app/src/main/assets/prompts.json` 已更新。

---

## 8. HTTP 接口速查
| 方法 | 路径 | 说明 | 请求关键字段 | 响应要点 |
| --- | --- | --- | --- | --- |
| `POST` | `/chat` | 主聊天接口（SSE） | `userId`, `content`, `recentMessages`, `currentStage`, `userName`, `clientTimeIso`, `attachments` | SSE 分片：`{"type":"reasoning","content":"..."}` / `{"type":"text","content":"..."}` |
| `POST` | `/conversation/log` | 把单条发言写入 D1 | `userId`, `role`(user/atri), `content`, `timestamp`, `attachments`, 可选 `userName`, `timeZone`, `date` | `{ ok: true, id, date }` |
| `POST` | `/conversation/delete` | 批量删除日志 | `userId`, `ids: []` | `{ ok: true, deleted: <count> }` |
| `GET` | `/conversation/last` | 查询最近一次聊天日期 | query: `userId`, 可选 `timeZone`, `date` | `{ status: 'ok', date, daysSince }` 或 `{ status: 'missing' }` |
| `GET` | `/diary` | 获取指定日期日记 | query: `userId`, `date` | `{ status: 'ready', entry }` / `{ status: 'missing' }` |
| `GET` | `/diary/list` | 最近 N 条日记 | query: `userId`, `limit(<=30)` | `{ entries: [...] }` |
| `POST` | `/upload` | 上传二进制到 R2 | Headers: `X-File-Name`, `X-File-Type`, `X-File-Size`, `X-User-Id`; Body: binary | `{ key, url, mime, size }` |
| `GET` | `/media/:key` | 读取 R2 文件 | 路径参数 `:key` | 200 + 二进制回应，附带缓存头 |
| `GET` | `/models` | 转发上游模型列表 | - | `{ models: [{ id, label, provider, note }] }` |
| `POST` | `/admin/clear-user` | 删除指定用户所有云端数据 | Header: `Authorization: Bearer <ADMIN_API_KEY>`，Body: `{ userId }` | `{ ok: true, stats: { diaries, diaryVectors, conversationLogs, mediaObjects } }` |

> 项目内没有 `/memory/extract`、`/diary/generate`、`/notify/decide` 等接口；相关功能要么已经下线，要么由 Cron 内的服务函数代替。

---

## 9. 开发与部署流程
1. **准备依赖**：Node.js 18+、Python 3.8+、Android Studio、Wrangler CLI（可选）。
2. **配置 Cloudflare**：
   - Dashboard 中创建 D1、Vectorize、R2；
   - 把资源 ID 写进 `worker/wrangler.toml`；
   - 通过 `npx wrangler secret put ...` 设置所有 Key。
3. **部署 Worker**：
   ```bash
   cd worker
   npm install
   python ../scripts/sync_shared.py
   npm run deploy
   ```
4. **编译 Android**：
   ```bash
   cd ATRI
   python ../scripts/sync_shared.py   # 或 ./gradlew syncPrompts
   ./gradlew assembleDebug
   ```
5. **本地联调**：
   - Worker：`npm run dev -- --remote`（需要访问云端绑定时再加 `--remote`）；
   - Android 模拟器访问本地 Worker：设置页填 `http://10.0.2.2:8787`；真机可用局域网 IP。
6. **日志与排查**：
   - 命令 `cd worker && npx wrangler tail` 查看线上日志；
   - `wrangler d1 execute <db> --command "SELECT * FROM diary_entries LIMIT 5"` 检查数据；
   - `npx wrangler vectorize info <index>` 查看索引状态；
   - R2 直接在 Dashboard 检查对象列表。

---

## 10. 扩展建议与风险提示
1. **自定义人格/模型**：修改 `shared/prompts.json` 或 `wrangler.toml` 中的模型参数，再跑同步脚本即可。记得同时更新 Worker Secret 里的 `OPENAI_API_URL`，否则大模型和嵌入服务会不匹配。
2. **新增接口**：在 `worker/src/routes/` 新建文件并在 `index.ts` 注册；Android 端新增 Retrofit 接口，交由对应 Repository 管理，避免在 ViewModel 里直接写网络逻辑。
3. **安全控制**：
   - 线上一定使用 HTTPS Worker 地址；
   - 建议在 Worker 层增加 `X-App-Token` 校验或接入 Cloudflare Access；
   - 重要接口（聊天、日记）可结合 Cloudflare Rate Limiting 做限流。
4. **容量估算**：
   - D1 适合 1 万级日活；若超出需迁出或增加分表策略；
   - Vectorize 免费版 100K 嵌入，可定期清理已读日记；
   - R2 默认 100MB 单文件限制，可在客户端限制附件大小。
5. **监控与告警**：在 `runDiaryCron` 中遇到异常时，可 `fetch` 到自建 webhook，把错误推送到飞书/钉钉群；必要时可开启 Cloudflare Logpush。
6. **测试覆盖**：建议补充以下自动化用例：
   - Worker 层单元测试：Mock D1/Vectorize，验证 `/chat` 构造 prompt 的关键字段；
   - Android 仓储层测试：模拟 SSE 分片，确保 `ChatRepository` 能正确合并结果；
   - 端到端脚本：利用 Wrangler + okhttp，在 CI 里跑“发消息 → 收到 SSE → 检查 D1 日志”闭环。

---

按本蓝图即可快速定位到关键文件、理解数据如何在 App / Worker / Cloudflare 之间流动，也能明确哪些接口已经存在、哪些还没实现，方便安全迭代。
