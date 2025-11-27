# ATRI - 情感演化型 AI 陪伴项目

> **不是聊天机器人，而是会写日记、记得你、还能反省的亚托莉。**

---

## 项目现状速览
- Android 端基于 Jetpack Compose + Room + Retrofit + OkHttp SSE，包含欢迎页、聊天页、日记本、设置页，以及支持长按操作和多版本回滚的聊天记录。
- Cloudflare Worker 同时接入 D1（会话/日记/复盘）、Vectorize（日记 embedding）与 R2（附件），通过 Cron 每晚自动写日记并生成 daily learning 复盘。
- Prompt 采用单一 JSON 源（`shared/prompts.json`），人格、语气、阶段、记忆提示在前后端保持完全一致。阶段逻辑支持 5 级，目前文案写到 3 级（4/5 会临时复用阶段 1）。
- 聊天走 SSE，Worker 会把 reasoning 与正式回复分流，客户端实时展示“思考气泡”，同时上传/引用图片、文档附件。
- 设置页可自定义 Worker URL、模型 ID、昵称与 userId，并能拉取 `/models` 列表。管理员可通过 `/admin/clear-user` 在云端一键清档。

---

## 核心亮点

### 1. 贴近原作的人格脚本
- `identity/soul/memoryWhispers/voice/innerProcess/naturalness` 六段文案围绕“亚托莉想证明自己有心”展开，鼓励自然、口语化、多段式表达。
- 阶段提示描述关系进度（初遇→熟悉→亲近），明确“称呼/界限/撒娇/担忧”演化方式，避免机械问答。
- 反模板化要求：禁止复读“你今天过得怎么样”，鼓励引用之前的细节或身体语言描述。

### 2. 记忆 + 日记 + 自我复盘
```
当日聊天 → /conversation/log
        ↘ Cron 23:59 → 生成日记 → D1 + Vectorize
                         ↘ 生成 daily learning JSON → D1.daily_learning
下一次 /chat → 工作记忆 + 日记回放 + 最近 3 天复盘 + 人格 → system prompt
```
- Working memory：按客户端时区读取当天最多 100 条对话（前 20 + 后 50，居中插省略提示）。
- 长期记忆：Vectorize 目前存放日记向量，命中后回溯对应日期的 transcript 或日记正文。
- Daily learning：Cron 在写日记后立刻生成复盘 JSON（亮点/问题/明日计划），下次聊天以“最近的小反思”形式注入 system prompt。

### 3. Android 体验
- 聊天区支持欢迎卡片、日期锚点、底部抽屉（状态/日记）以及查看“思考过程”。
- 长按消息可复制、重答、切换旧版本、删除、引用图片重新发送。
- 设置页提供 Worker URL、首选模型、昵称、导入 userId、模型目录刷新、本地清档等操作。
- 日记页从 Worker 拉取 `/diary/list`，点击后读 `/diary`，配合对话回忆界面展示。

### 4. Cloudflare Worker
- itty-router 拆分 `/chat` `/conversation` `/diary` `/media` `/models` `/admin` 六类接口，SSE 输出 reasoning/text。
- `runDiaryCron` 每天 UTC 15:59 扫描当天有对话的 userId，自动生成日记 + daily learning 并写入 D1/Vectorize。
- `/upload` + `/media/:key` 让客户端直接向 R2 上传/读取附件，支持图片和通用文件。
- `/admin/clear-user` 通过 `ADMIN_API_KEY` 保护，可清理 D1、Vectorize、R2 的用户数据，方便重置人格。

---

## 快速开始

### 1. Worker（Cloudflare）
```bash
cd worker
npm install
python3 ../scripts/sync_shared.py   # 或 python
npx wrangler login                  # 首次登录

# 配置必要的 Key
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put EMBEDDINGS_API_KEY
# 可选：启用管理员清档
npx wrangler secret put ADMIN_API_KEY

npm run dev          # 本地调试（默认端口 8787）
# 或
npm run deploy       # 部署到 <name>.workers.dev
```
> 提示：`wrangler.toml` 中的 `account_id`、D1/R2/Vectorize 名称需替换成你自己的账号；Cron 默认 `59 15 * * *`（北京 23:59）。

### 2. Android
```bash
cd ATRI
./gradlew installDebug   # 或使用 Android Studio 直接 Run
```
首次启动：在欢迎页输入昵称/头像 → Settings 页填写 Worker URL（例：`http://10.0.2.2:8787` 或 `https://your-worker.workers.dev`） → 返回聊天页即可开始。

---

## 项目结构
```
E:/ATRI
├─ ATRI/                      # Android Compose 客户端
│  ├─ app/src/main/java/me/atri/
│  │  ├─ data/                # API、Repository、Room、DataStore、PromptProvider
│  │  ├─ ui/                  # chat/diary/settings/welcome/components
│  │  ├─ di/                  # app/network/repository/viewModel 模块（Koin）
│  │  └─ utils/               # SSE 解析、文件/图片工具
│  └─ app/src/main/assets/prompts.json (由脚本同步)
│
├─ worker/                    # Cloudflare Worker
│  ├─ src/routes/             # chat / conversation / diary / media / admin / models
│  ├─ src/services/           # openai / chat / data / memory / diary-generator / daily-learning
│  ├─ src/jobs/diary-cron.ts  # 每晚自动生成日记 + daily learning
│  ├─ db/schema.sql           # D1 表结构
│  └─ wrangler.toml           # 账号、绑定、Cron、默认模型
│
├─ shared/prompts.json        # 唯一提示词母本
└─ scripts/sync_shared.py     # 同步脚本（shared -> Android/Worker）
```

---

## 运行原理
1. `ChatRepository` 发送消息 → 上传附件 → 写本地 Room → 调 `/conversation/log` 写 D1。
2. Worker `/chat` 并行加载 working memory（当天对话）、Vectorize 日记、recent daily learning，拼出 system prompt，再把用户文本+附件转换为多模态消息。
3. OpenAI Chat Completions 以 SSE 形式返回；`pipeChatStream` 过滤 reasoning/text，客户端 `StreamCollector` 依次渲染。
4. Cron 每晚扫描当天有对话的用户 → `generateDiaryFromConversation` → 写入 D1 + Vectorize；随即 `generateDailyLearning` 写入 `daily_learning`。
5. 下次聊天时，prompt 里会出现“## 今天聊过的”“## 想起的往事”“## 最近的小反思”，让模型自然引用记忆并反思说话方式。

---

## 记忆与自我复盘
- **工作记忆**：基于客户端时区截取当天 0 点之后的所有会话，限制 100 条，过多时保留开头和最新片段。
- **长期记忆**：Vectorize 目前只存放 `diary:<userId>:<date>`，命中后优先回溯该日期的对话 transcript，不足再引用日记正文。
- **每日复盘**：Cron 生成 JSON：
  ```json
  {
    "date": "2025-02-15",
    "user_talk_summary": { "overall_tone": "...", "key_events": [] },
    "self_reflection": { "good_moments": [], "bad_moments": [], "format_issue": [] },
    "tomorrow_plan": { "do_more": [], "do_less": [], "experiments": [] }
  }
  ```
  Worker 在 `/chat` 中把最近 3 天复盘整理成“亮点 / 问题 / 明天多做 / 明天少做”的列表，帮助模型减少模板化措辞。

---

## Android 客户端细节
- **ChatScreen**：欢迎提示、亲密度状态、滚动到日期锚点、思考气泡、引用消息、图片预览、底部工具栏（附件/引用管理）。
- **消息版本**：Room `message_versions` 最多保存 5 版，长按消息可“重答”“回到旧版本”“复制”“引用图片”“删除”。
- **Settings**：可修改 Worker URL、模型 ID、昵称；支持导入旧 userId、清空本地 Room、刷新服务器模型列表。
- **DiaryScreen**：调用 `/diary/list` + `/diary`，在 Dialog 中展示全文和高光；底部抽屉也能快速查看本地缓存。
- **依赖**：Koin 负责注入 Database/Repositories/ViewModels，DataStore 保存 userId、Worker URL、模型、昵称、亲密度等。

---

## Cloudflare Worker 功能
- **/chat**：working memory + 日记记忆 + daily learning → `composeSystemPrompt` → OpenAI Chat Completions → `pipeChatStream` 输出 reasoning/text。
- **/conversation**：日志写入/批量删除/查询上次聊天时间，所有请求都会清洗文本（去掉时间戳前缀）。
- **/diary**：提供某日详情与最近 N 天列表，状态可能是 `ready/pending/error`，方便客户端给出提示。
- **/media**：`POST /upload` 写入 R2，`GET /media/:key` 公网读取；键名 `u/<userId>/<timestamp>-<file>`，便于 `/admin/clear-user` 定位。
- **/models**：代理 `${OPENAI_API_URL}/models` 并裁剪为 `id/label/provider/note` 四字段，供设置页展示。
- **/admin/clear-user**：受 `ADMIN_API_KEY` 保护，按 userId 依次删除 D1 日记/会话、Vectorize 向量、R2 附件，返回删除统计。
- **Cron**：`runDiaryCron` 遍历当天未生成日记的用户，生成日记 + daily learning，失败时写入 status=`error` 记录。

---

## API 接口概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST /chat` | SSE 聊天接口，`recentMessages` 包含最近 20 条上下文，流式返回 reasoning/text。 |
| `POST /conversation/log` | 记录日志 `{ userId, role, content, timestamp?, attachments?, userName?, timeZone? }`，返回 `{ ok, id, date }`。 |
| `POST /conversation/delete` | Body `{ userId, ids: [] }`，返回 `{ ok, deleted }`。 |
| `GET /conversation/last` | `?userId=xxx&timeZone=Asia/Shanghai`，返回 `{ status:"ok", date, daysSince }` 或 `{ status:"missing" }`。 |
| `GET /diary` / `GET /diary/list` | 查询单日或最近 N 天日记，配合客户端 Dialog 展示。 |
| `POST /upload` | 通过 `X-File-Name/Type/Size` + `X-User-Id` 上传附件，返回 `{ key, url, mime, size }`。 |
| `GET /media/:key+` | 读取 R2 对象，带长缓存头。 |
| `GET /models` | 代理上游模型列表，供设置页下拉。 |
| `POST /admin/clear-user` | 需要 `Authorization: Bearer <ADMIN_API_KEY>`，返回 `{ ok, stats }`。 |

示例：`POST /chat`
```json
{
  "userId": "u-123",
  "content": "晚上好呀",
  "currentStage": 2,
  "recentMessages": [{ "content": "hi", "isFromAtri": true }],
  "attachments": [],
  "userName": "阿栖",
  "clientTimeIso": "2025-02-15T21:30:00+08:00",
  "modelKey": "openai.gpt-5-chat"
}
```
返回：
```
data: {"type":"reasoning","content":"（想起昨天...）"}

data: {"type":"text","content":"晚上好呀，我刚在收拾厨房……"}

data: [DONE]
```

---

## 提示词结构
```json
{
  "chat": {
    "identity": "你是亚托莉...",
    "soul": "## 你是什么样的人...",
    "voice": "## 你说话的样子...",
    "stages": { "1": "...", "2": "...", "3": "..." },
    "memoryHeader": "——对了，我想起来了——"
  },
  "diary": {
    "system": "夜深了，又到了写日记的时间...",
    "userTemplate": "今天是：{timestamp}{daysSinceInfo}..."
  },
  "summary": { "prompt": "请扮演亚托莉..." },
  "memory": { "extractTemplate": "你现在要帮亚托莉整理长期记忆..." }
}
```
- 所有修改只能动 `shared/prompts.json`，通过 `python3 scripts/sync_shared.py` 同步到 Android assets 与 Worker `src/config`。
- 目前没有 `notify` 字段，若未来要做提醒，请在 JSON 中新增并修改两端的解析逻辑。

---

## 常见问题
1. **提示词改了没生效？**  
   运行 `python3 scripts/sync_shared.py`，再重新部署 Worker、重新编译 Android（`./gradlew installDebug`）或清除 App 缓存。
2. **真机连不上本地 Worker？**  
   确保手机与电脑在同一局域网，设置页填写 `http://<电脑局域网IP>:8787`，并在 `wrangler dev --remote` 模式下运行以访问云端资源。
3. **Cron 没生成日记？**  
   用 `wrangler cron triggers` 确认调度是否生效，并检查当天是否调用过 `/conversation/log`。也可以手动执行 `runDiaryCron(env, "2025-02-15")` 做补录。
4. **附件上传失败？**  
   确认已创建 R2 bucket，headers 带齐 `X-File-Name/Type/Size` 与 `X-User-Id`，文件大小建议 <5MB。
5. **模型列表为空？**  
   检查 `OPENAI_API_URL` 是否真的支持 `/models`，若上游不支持可在 Worker 里返回静态白名单。

---

## 路线图
- [ ] 补齐阶段 4/5 的提示词与 UI 展示。
- [ ] 恢复“用户偏好/禁忌”长期记忆写入，将 Vectorize 用于非日记事实。
- [ ] 在 App 中展示 daily learning，让用户看到 ATRI 的自我改进计划。
- [ ] 为 `/chat` 等接口增加简易鉴权或 Cloudflare Access 保护。
- [ ] 提供 `/conversation/list` 分页接口，支持多端同步完整消息。
- [ ] 在客户端增加附件大小限制与压缩策略，降低 R2 成本。

---

## 贡献方式
1. Fork 仓库并新建分支，修改前先执行 `python3 scripts/sync_shared.py`，保持提示词一致。
2. 代码遵循 Kotlin/TypeScript 基本格式，注释使用中文；PR 中说明变更动机与验证方式。
3. 如果只是反馈想法或 bug，可以直接开 Issue，附上复现步骤/日志即可。

---

## 许可证
MIT License。使用过程中需遵守 OpenAI、Cloudflare 等服务条款，提示词中的角色内容仅供学习交流。

---

## 致谢
- 《ATRI -My Dear Moments-》原作及粉丝社群提供的灵感。
- Cloudflare Workers / D1 / R2 / Vectorize 免费额度。
- 所有帮助改进提示词工程与情感 AI 的开发者、研究者与玩家。
