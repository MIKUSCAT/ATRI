# ATRI 技术架构蓝图

> 文档目标：让任何人 10 分钟内弄清楚「目录结构、核心链路、端口、扩展方式」，方便定制和部署。以下内容只描述事实与操作，避免抽象术语。

---

## 1. 系统角色速览
| 角色 | 技术栈 | 主要工作 |
| --- | --- | --- |
| Android 客户端 (`E:/ATRI/ATRI`) | Kotlin + Jetpack Compose + Room + Retrofit + OkHttp SSE + Koin | 欢迎页 / 聊天 / 日记 / 设置，记录本地消息与版本，上传附件，调用 Worker，并实时渲染推理流。 |
| Cloudflare Worker (`E:/ATRI/worker`) | TypeScript + itty-router + Wrangler + D1 + R2 + Vectorize | 暴露 `/chat` `/conversation` `/diary` `/media` `/models` `/admin`，调用 OpenAI 兼容接口，写入 D1、Vectorize、R2，定时生成日记与 daily learning，自带清理接口。 |
| 共享提示词 (`E:/ATRI/shared`) | JSON | 统一的人格/阶段/日记/记忆模板，Android 与 Worker 同源，避免人设漂移。 |
| 同步脚本 (`E:/ATRI/scripts/sync_shared.py`) | Python | 将 `shared/prompts.json` 同步到 `ATRI/app/src/main/assets` 与 `worker/src/config`，在 Android `preBuild` 和 Worker `predev/predeploy` 中自动执行。 |

外部依赖：Cloudflare D1（会话/日记/复盘）、Vectorize（日记 embedding）、R2（附件）、OpenAI 兼容接口（默认 `openai.gpt-5-chat`）、SiliconFlow Embedding API。

---

## 2. 总体数据流
1. Android `ChatScreen` 通过 Retrofit 调用 `/chat`，携带最近 20 条消息、附件、阶段、客户端时间。
2. Worker `/chat` 并行加载当天对话（working memory）、Vectorize 日记记忆、最近 3 条 daily learning，组装 system prompt，转发至 OpenAI Chat Completions，返回 SSE。
3. 客户端 `StreamCollector` 拆分 reasoning / text 分片，实时写入 Room 并展示“思考 + 正式回复”。
4. 每条消息都会调用 `/conversation/log` 写入 D1；附件先用 `/upload` 落地 R2，再把 URL 放入聊天上下文。
5. Cloudflare Cron 每天 UTC 15:59 触发 `runDiaryCron`，为当天有对话且无日记的用户生成日记、写入 D1 + Vectorize。
6. Cron 同时使用当天对话 + 日记生成 daily learning 复盘（JSON），写入 `daily_learning` 表，下一次 `/chat` 会把“最近的小反思”附加在 prompt 中。

```
用户 → Android → POST /chat
                ↘ 上传附件 `/upload` → R2
          SSE ← Worker ← OpenAI

Android → /conversation/log → D1.conversation_logs
Cron → runDiaryCron → D1.diary_entries + Vectorize.diary_embeddings
Cron → generateDailyLearning → D1.daily_learning → 下次 /chat 注入
```

---

## 3. 文件结构（含重点文件）
```
E:/ATRI
├─ ATRI/
│  ├─ app/build.gradle.kts          # Compose + Room + Retrofit + syncPrompts 任务
│  └─ app/src/main/java/me/atri/
│     ├─ MainActivity.kt            # 欢迎/聊天/日记/设置导航
│     ├─ data/                      # API、Repository、Room、DataStore、PromptProvider
│     ├─ ui/                        # chat/diary/settings/welcome/components
│     ├─ di/                        # app/network/repository/viewModel 模块
│     └─ utils/                     # SSE 解析、文件处理、emoji 资产
│  └─ app/src/main/assets/prompts.json
│
├─ worker/
│  ├─ wrangler.toml                 # 账号、D1/R2/Vectorize 绑定、Cron
│  ├─ db/schema.sql                 # conversation_logs / diary_entries / daily_learning
│  └─ src/
│     ├─ index.ts                   # itty-router 注册 + scheduled 钩子
│     ├─ routes/                    # chat / conversation / diary / media / admin / models
│     ├─ services/                  # openai / chat / diary-generator / data / memory / daily-learning
│     ├─ jobs/diary-cron.ts         # 自动生成日记 + daily learning
│     ├─ utils/                     # SSE、日期、附件、JSON helper
│     └─ config/prompts.json        # 提示词副本
│
├─ shared/prompts.json              # 唯一提示词母本
└─ scripts/sync_shared.py           # 提示词同步脚本
```

### 3.1 角色补充
- **Android**：
  - Jetpack Compose + Material3 实现欢迎页、聊天界面、日记本、设置页以及底部抽屉（状态/日记）。
  - `ChatViewModel` 管理 SSE 流、消息版本、引用消息；`StreamCollector` 把 Worker SSE 拆成“思考/回复”并记录耗时。
  - Room `messages` + `message_versions` 支持“重答”“回到旧版本”“删除/置顶”；`DiaryDao` 缓存 Cron 生成的云端日记。
  - Settings 可配置 Worker URL、首选模型、昵称、导入旧 userId，并能调用 `/models` 获取模型列表，`UserDataManager` 可清空 Room + 重置 userId。
- **Cloudflare Worker**：
  - itty-router 负责路由拆分；`Env` 注入 D1、Vectorize、R2 及 API Keys。
  - `/chat` 汇总 working memory（最多 100 条，保留头 20/尾 50）、日记记忆、daily learning，随后调用 OpenAI Chat Completions 并流式返回。
  - `/conversation/log/delete/last` 管理会话日志，`/diary` 提供日记详情/列表，`/media` 负责附件上传与读取，`/models` 代理模型目录，`/admin/clear-user` 受密钥保护清理指定用户数据。
  - `runDiaryCron` 在 scheduled 钩子中触发，串联日记生成、Vectorize upsert、daily learning 保存。
- **共享提示词 & 脚本**：`prompts.json` 定义人格、阶段（当前写到 3 阶段）、日记模板、总结模板、记忆提取模板，`sync_shared.py` 确保 Android 与 Worker 使用同一份文案。

---

## 4. 核心运行原理

### 4.1 聊天链路
1. `ChatRepository.sendMessage` 上传附件、在 Room 写入用户消息后立即调用 `/conversation/log`。
2. 构造 `ChatRequest` 时会：
   - 根据本地消息数量决定阶段（1:<80, 2:<200, 3:<400, 4:<700, 5:≥700）。提示词目前仅有 1~3 阶段文案，4/5 暂时复用阶段 1。
   - 自动注入 `recentMessages`（包含附件）、`clientTimeIso`、`userName`、用户选定的 `modelKey`。
   - 若检测到“昨天/前天/某日”查询，会附赠对应日期的用户原话，方便 Worker 直接引用。
3. Worker `/chat` 并行：
   - **Working memory**：按客户端时区计算当天 0 点，查询当天所有日志，超过 100 条则保留前 20、后 50，并插入“省略”提示。
   - **长期记忆**：`searchMemories` topK=3（目前都是日记），`buildLongTermRecalls` 优先加载那天的 transcript，找不到才读取 D1 日记正文。
   - **Daily learning**：`getRecentDailyLearnings` 取最近 3 天复盘，`formatDailyLearningNotes` 输出“亮点/问题/明天多做/少做”。
4. `composeSystemPrompt` 把身份、语气、内心独白、阶段文案、记忆、working memory、daily learning 拼成 system prompt。
5. `buildUserContentParts` 按图文分离生成 OpenAI 多模态数组（text + image_url + 文档提示）。
6. `callChatCompletions` 直接请求 `${OPENAI_API_URL}/chat/completions`，超时 120s，模型优先使用客户端指定值，否则 fallback `Env.CHAT_MODEL`（默认 `openai.gpt-5-chat`）。
7. `pipeChatStream` 拆上游 SSE 成 `reasoning/text` 分片，客户端 `StreamCollector` 收到后实时更新 UI。
8. `persistAtriMessage` 会清理模型自动加的时间戳、替换 emoji 占位符，把最终文本写回 Room，再次调用 `/conversation/log`。

### 4.2 记忆搜写
- Vectorize 目前只写入日记（metadata `c=diary`），检索时根据 `metadata.u` 过滤用户，再按日期回查 D1 获取 transcript/正文。
- 如需恢复“用户偏好/关系/禁忌”类长期记忆，可按 `memory.extractTemplate` 输出结构写入 Vectorize，`composeSystemPrompt` 中现有 `relatedMemories` 区块即可收纳。

### 4.3 日记与 daily learning
1. Cron 用 `listPendingDiaryUsers` 找出当日有对话但无 ready 日记的用户。
2. `fetchConversationLogs` + `buildConversationTranscript` 拼出今天完整对话，`getLastConversationDate` 计算离上次聊天的天数，增强 prompt。
3. `generateDiaryFromConversation` 让模型输出 JSON（diary/highlights/mood），失败时报兜底文案。
4. 写入 `diary_entries` 与 Vectorize 后，调用 `generateDailyLearning`，基于“今日对话 + 日记”生成严格 JSON 的复盘，并写入 `daily_learning`。
5. 下一次 `/chat` 会读取这三天的 learning，形成“## 最近的小反思”，指导模型规避模板化回复。

### 4.4 附件与多模态
- Android 把附件描述成 `PendingAttachment`，先调 `/upload` 写到 R2（键名 `u/<userId>/<timestamp>-<file>`）。
- Worker 返回可公开访问的 `/media/<key>`，聊天时图片作为 `image_url` 注入，文档以文字提示（“用户上传的文件 XXX，地址：YYY”）供模型参考。

### 4.5 提示词供给
- `shared/prompts.json` 含 `chat/diary/summary/memory` 四段内容；`PromptProvider` 给 UI 提供阶段名称/介绍，Worker 使用 `src/config/prompts.json`。
- 后续若需要通知类提示词，可在 JSON 中新增 `notify`，并在 Android/Worker 解构时读取。

---

## 5. HTTP 端口与报文
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST /chat` | 主聊天接口，返回 `text/event-stream`，每条分片是 `{"type":"reasoning"|"text","content":"..."}`，终止为 `data: [DONE]`。 |
| `POST /conversation/log` | 记录单条对话，body `{ userId, role, content, timestamp?, attachments?, userName?, timeZone?, date? }`，返回 `{ ok, id, date }`。 |
| `POST /conversation/delete` | 删除若干日志，body `{ userId, ids: [] }`，返回 `{ ok, deleted }`。 |
| `GET /conversation/last` | 查询上一次对话 `{ status:"ok", date, daysSince }` 或 `{ status:"missing" }`，可自带 `timeZone`、`date`。 |
| `GET /diary` | `?userId=xxx&date=yyyy-mm-dd`，返回 `{ status, entry? }`。 |
| `GET /diary/list` | `?userId=xxx&limit=7`，按日期倒序返回最近 N 条日记。 |
| `POST /upload` | 通过 `X-File-Name/Type/Size` + `X-User-Id` 携带元信息，body 为文件字节，返回 `{ key, url, mime, size }`。 |
| `GET /media/:key+` | 从 R2 读取附件，携带缓存头。 |
| `GET /models` | 代理 `${OPENAI_API_URL}/models`，并返回 `{ models: [{ id,label,provider,note }] }`，供 Settings 下拉。 |
| `POST /admin/clear-user` | 需要 `Authorization: Bearer <ADMIN_API_KEY>`，body `{ userId }`，清理该用户的 D1/向量/R2 记录并返回统计。 |

`schedule` 事件会 `ctx.waitUntil(runDiaryCron(env))`，无需 HTTP 调度。

---

## 6. Android 端实现要点
1. **Compose UI**：ChatScreen 支持欢迎提示、动态日期锚点、底部抽屉；DiaryScreen 远程拉取云端日记，支持 Dialog 细看；SettingsScreen 可更改 Worker URL / 模型 / 昵称 / userId。
2. **状态管理**：`ChatViewModel` 监听 Room Flow，计算日期分组、当前状态（Online/Waiting/Missing/Sleeping/Thinking），维护引用消息与附件列表。
3. **SSE 解析**：`StreamCollector` 区分 reasoning/text，刷新 UI 并记录思考起止时间，`ThinkingContent` 组件折叠展示思考文本。
4. **消息版本**：`MessageVersionDao` 记录每次“重答/编辑”结果（最多 5 版），用户可在长按菜单中切换旧版本或删除。
5. **附件工具**：`FileUtils` 把头像写入本地沙盒，`AttachmentContract` 保证只会上传 image/document 两种类型。
6. **数据持久化**：Room version=5（messages/message_versions/diary/memories），DataStore 保存 userId、Worker URL、模型、昵称、亲密度、头像路径、最近一次对话日期。
7. **依赖注入与构建**：Koin modules 管理 Database/Retrofit/Repository/ViewModel，`preBuild` 任务自动把 `shared/prompts.json` 拷贝到 assets。

---

## 7. Worker 端实现要点
1. **路由与调度**：`index.ts` 注册所有 REST 路径，并在 `scheduled` 钩子触发 `runDiaryCron`。
2. **聊天服务**：`routes/chat.ts` 负责 working memory、日记回放、daily learning、附件拼装；`composeSystemPrompt` 注重人格与自然语气；`resolveModelKey` 优先使用客户端模型，再 fallback。
3. **OpenAI 封装**：`openai-service.ts` 统一 `chat/completions` 请求、超时与错误处理；流式响应交给 `pipeChatStream`。
4. **数据层**：`data-service.ts` 所有 D1 操作集中处理（含 JSON 解析），`saveConversationLog` 自动补 `date/timeZone`，`saveDiaryEntry/saveDailyLearning` 均采用 UPSERT。
5. **日记 + 复盘**：`generateDiaryFromConversation` 去掉原来的 4000 字截断，`generateDailyLearning` 要求模型输出合法 JSON；任何异常都会写 error status 方便排查。
6. **附件与 admin**：`routes/media.ts` 负责 R2 put/get，`routes/admin.ts` 通过 `ADMIN_API_KEY` 保护清理接口，会顺序删除 D1/Vectorize/R2。
7. **向量管理**：`memory-service.ts` 目前只写日记向量（metadata 只含 user/date/mood），`deleteDiaryVectors` 分批删除避免超限。

---

## 8. 数据模型

### 8.1 D1 `conversation_logs`
| 字段 | 说明 |
| --- | --- |
| `id` TEXT PK | UUID，客户端或服务器生成。 |
| `user_id` TEXT | 与客户端 userId 对应。 |
| `date` TEXT | yyyy-MM-dd，按 timeZone 计算。 |
| `role` TEXT | `user` / `atri`。 |
| `content` TEXT | 清洗后的文本。 |
| `attachments` TEXT | JSON 字符串。 |
| `timestamp` INTEGER | 毫秒时间戳。 |
| `user_name` / `time_zone` | 可选信息。 |
| `created_at` INTEGER | 写入时间。 |

### 8.2 D1 `diary_entries`
| 字段 | 说明 |
| --- | --- |
| `id` TEXT | `diary:<userId>:<date>`。 |
| `summary` / `content` | 列表摘要 / 日记正文。 |
| `mood` TEXT | 模型给出的心情。 |
| `status` TEXT | `ready/pending/error`。 |
| `created_at` / `updated_at` | 时间戳。 |

### 8.3 D1 `daily_learning`
| 字段 | 说明 |
| --- | --- |
| `id` TEXT | `learn:<userId>:<date>`。 |
| `summary` TEXT | 亮点/问题的概要。 |
| `payload` TEXT | 模型返回的 JSON 原文。 |
| `created_at` / `updated_at` | 时间戳。 |

### 8.4 Vectorize metadata
| 字段 | 说明 |
| --- | --- |
| `id` | `diary:<userId>:<date>` |
| `metadata.u` | userId |
| `metadata.c` | 固定 `diary` |
| `metadata.d` | 日期 |
| `metadata.m` | 心情 |
| `metadata.imp` | 重要度（6） |
| `metadata.ts` | 写入时间 |

---

## 9. 二次开发策略
1. **改人格/阶段**：修改 `shared/prompts.json` → `python3 scripts/sync_shared.py` → 重启 Android / 重新部署 Worker。
2. **加记忆类型**：复用 `memory.extractTemplate`，写入带 `metadata.c=user_preference` 等标签的向量，在 `composeSystemPrompt` 的 `relatedMemories` 区块展示。
3. **扩展 API**：`worker/src/routes` 新建路由并在 `index.ts` 注册，同时在 `AtriApiService` + Repository 中调用。
4. **数据回放**：可新增 `/conversation/list` 之类接口，把 Cloudflare D1 历史同步回多个终端，Room 负责本地合并。
5. **模型管理**：允许 Worker 对 `/models` 做白名单过滤，或在 Settings 增加 Token 鉴权，避免误选不可用模型。

---

## 10. 测试与排查
- Worker 本地调试：`cd worker && npm install && npm run dev`，若需访问真实 R2/Vectorize 用 `npm run dev -- --remote`。
- Android 连接：模拟器填 `http://10.0.2.2:8787`，真机填局域网 IP。
- D1 查询：`wrangler d1 execute atri_diary --command "SELECT * FROM diary_entries ORDER BY date DESC LIMIT 3"`。
- Vectorize：`npx wrangler vectorize info atri-memories` 查看条数，或用 `query` 命令测试召回。
- Cron：`wrangler cron triggers` 查看下次触发；也可给 `runDiaryCron(env, "2025-02-15")` 传参做历史补写。

---

## 11. 常用命令
| 场景 | 命令 |
| --- | --- |
| 同步提示词 | `python3 scripts/sync_shared.py` |
| Worker 开发 | `cd worker && npm run dev` |
| Worker 部署 | `cd worker && npm run deploy` |
| 设置 Secrets | `cd worker && npx wrangler secret put OPENAI_API_KEY`（另需 EMBEDDINGS_API_KEY/ADMIN_API_KEY） |
| Android 调试安装 | `cd ATRI && ./gradlew installDebug` |
| Android 清理 | `cd ATRI && ./gradlew clean` |
| 统计日记数量 | `cd worker && wrangler d1 execute atri_diary --command "SELECT COUNT(*) FROM diary_entries;"` |

---

## 12. 下一步建议
1. 补全 `chat.stages` 的第 4/5 阶段，避免高阶段体验退化。
2. 恢复“长期记忆”写入，除了日记外再记录用户事实、禁忌，真正形成三层记忆。
3. 在客户端展示 daily learning，让用户看到 ATRI 的自我反省。
4. 给 `/chat` 等接口增加简易鉴权（例如 `X-App-Token`）或接入 Cloudflare Access，防止公开滥用。
5. 扩展 `/conversation` 加列表/分页接口，方便多端同步完整消息历史。
6. 附件上传增加大小限制/压缩提示，降低 R2 成本。
7. 引入 CI（lint + `wrangler deploy --dry-run`）确保提示词同步任务不会遗漏。

---

## 13. 环境与配置矩阵
| 场景 | Android 入口 | Worker 运行方式 | Cloudflare 资源 | 备注 |
| --- | --- | --- | --- | --- |
| 本地联调 | `http://10.0.2.2:8787` 或 `http://<局域网IP>:8787` | `npm run dev`（可加 `--remote`） | 可选（本地模式走 mock） | 适合调 UI / SSE，Cron 依赖云端。 |
| 远程测试 | `https://<worker>.workers.dev` | `npm run deploy` | 免费 D1/R2/Vectorize + Cron | Cron 有 ±1min 漂移。 |
| 生产 | `https://mikuscat.qzz.io`（自定义域） | `npm run deploy` + 绑定域名 | 独立账号 + Secrets + 日志 | 建议配合 Access、速率限制、监控。 |

Secrets：`OPENAI_API_KEY`、`EMBEDDINGS_API_KEY` 必填；`ADMIN_API_KEY` 启用后才可调用 `/admin/clear-user`。

---

## 14. 典型生命周期
1. **部署**：同步提示词 → `npm install` → `wrangler login` → 创建/绑定 D1、R2、Vectorize → 配置 Secrets → `npm run deploy`。
2. **用户首次体验**：安装 APK → 欢迎页填写昵称/头像 → Settings 填 Worker URL → 聊天。
3. **日常运行**：白天聊天上传日志，晚上 Cron 自动补写日记和 daily learning，第二天 prompt 自动引用。
4. **提示词/模型更新**：修改 `shared/prompts.json` 或 `wrangler.toml` → `sync_shared.py` → 重新部署 → 客户端重启。
5. **数据清理/重置**：管理员调用 `/admin/clear-user` 删除云端，用户在 App 内可清空本地 Room + 重置 userId。

---

## 15. 功能与 API 对照
| 功能 | Android 入口 | Worker 模块 | 端点 |
| --- | --- | --- | --- |
| 实时聊天 | `ChatScreen` / `ChatRepository.sendMessage` | `routes/chat.ts`, `services/chat-service.ts` | `POST /chat` |
| 会话日志 | `ChatRepository.logConversationSafely` | `routes/conversation.ts` | `POST /conversation/log`, `POST /conversation/delete`, `GET /conversation/last` |
| 日记列表/详情 | `DiaryViewModel` | `routes/diary.ts` | `GET /diary`, `GET /diary/list` |
| 自动日记 + 复盘 | （Cron） | `jobs/diary-cron.ts`, `services/diary-generator.ts`, `services/daily-learning.ts` | Cloudflare `scheduled` |
| 附件上传 | `ChatRepository.uploadPendingAttachments` | `routes/media.ts` | `POST /upload`, `GET /media/:key` |
| 模型目录 | `SettingsViewModel.refreshModelCatalog` | `routes/models.ts` | `GET /models` |
| 管理清理 | （需自建后台） | `routes/admin.ts` | `POST /admin/clear-user` |

---

## 16. 性能与扩展
- SSE 需要长连接：Android OkHttp `readTimeout=180s`，Worker 调 OpenAI 超时 120s，可按需调整；若频繁超时，先降低 prompt 长度或模型 `max_tokens`。
- Working memory 限制 100 条，防止 prompt 过长；若希望保留更多上下文，可在 Worker 端做分段查表。
- Vectorize 免费层 100K embedding，建议为老日记提供“归档/删除”按钮，或按重要度筛写。
- D1 适合 10K 日活，再高可迁移到 PlanetScale/Neon 等外部数据库；也可以在 Worker 加缓存（KV/Durable Objects）。
- R2 上传未做压缩，最好在客户端限制大小并提示用户，或在 Worker 中做简单压缩。
- Cron 失败会写 status=`error` 日记，客户端应提示“稍后重试”，避免用户误以为记忆缺失。

---

## 17. 安全与权限
1. Secrets 仅保存于 Cloudflare，`.dev.vars` 不可提交。
2. 默认所有接口开放，若对外发布，建议加 `X-App-Token` 或使用 Cloudflare Access/JWT 限制来源。
3. `/admin/clear-user` 仅在配置 `ADMIN_API_KEY` 时生效，务必通过私有后台调用。
4. `/upload` 当前未鉴权，可检查 `X-User-Id` 是否有效或按 IP 限制。
5. `sanitizeText` 移除了时间戳前缀，但日志里仍可能出现敏感内容，部署到生产时可再做脱敏。

---

## 18. 运维与监控
- `wrangler tail --format pretty` 查看线上日志；可结合 Cloudflare Logpush 输出到第三方（Datadog/Grafana Loki）。
- Cron 面板：Workers & Pages → Cron Triggers → Runs 查看最近触发和错误。
- R2/Vectorize 巡检：`npx wrangler r2 object list <bucket>`、`npx wrangler vectorize info atri-memories`。
- 如需报警，可在 `runDiaryCron` 捕获异常后调用自建 webhook，把成功/失败推到钉钉/飞书。
- Worker 支持在控制台回滚到旧部署；Android 版本更新需按常规渠道发布，必要时可在设置页提供“关闭新功能”开关。

掌握以上内容即可快速定位文件、理解数据流，并安全地扩展 ATRI。
