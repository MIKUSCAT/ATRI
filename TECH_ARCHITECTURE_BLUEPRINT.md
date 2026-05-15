<div align="center">

# 🏗️ ATRI 技术架构蓝图

### 设计思路 · 运行原理 · 当前代码真相

[![Architecture](https://img.shields.io/badge/Architecture-Cloudflare%20Worker-blue?style=for-the-badge&logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Platform](https://img.shields.io/badge/Platform-Android-green?style=for-the-badge&logo=android)](https://developer.android.com/)
[![AI](https://img.shields.io/badge/AI-OpenAI%20%7C%20Anthropic%20%7C%20Gemini-orange?style=for-the-badge&logo=openai)](https://platform.openai.com/)
[![Memory](https://img.shields.io/badge/Memory-Fact%20%2F%20Episodic%20%2F%20Intention-purple?style=for-the-badge)](#6-创新点-3类人记忆系统fact--episodic--intention-三层分工)

</div>

---

> 📖 **这不是“启动说明”，而是技术蓝图。**
>
> 它回答三个问题：
>
> - **为什么这么设计**：哪些地方为了角色感，哪些地方为了成本和可维护性；
> - **系统到底怎么跑**：一次聊天、日记、记忆、附件、主动消息分别怎么流动；
> - **以后怎么继续改**：常见改动应该动哪个文件，哪些表和接口是单一真相。
>
> ⚠️ **当前现状**：发布版以后端 `worker/` 为主，运行在 Cloudflare Workers；旧 `server/` 后端已经不再作为发布主线。本文按当前代码写，不写真实域名、账号、Key，统一用 `<YOUR_WORKER_URL>` / `<APP_TOKEN>` / `<SECRET>` 这类占位。

---

## 📑 目录导航

<table>
<tr>
<td width="50%">

**核心设计**
- [1. 设计目标 & 约束](#1-我想解决什么问题设计目标--约束)
- [2. 系统总览](#2-系统总览组件与边界)
- [3. 核心链路](#3-核心链路一次对话到底怎么走完从点发送开始)

</td>
<td width="50%">

**创新亮点**
- [4. 状态胶囊 + 亲密度](#4-创新点-1状态胶囊--亲密度让情绪有视觉表达关系有惯性)
- [5. 日记 highlights 向量记忆](#5-创新点-2日记-highlights-向量记忆用提炼过的记忆去做检索)
- [6. 类人记忆系统](#6-创新点-3类人记忆系统fact--episodic--intention-三层分工)
- [7. 工具注册机制](#7-创新点-4工具注册取代全量注入把查证变成模型能力的一部分)

</td>
</tr>
<tr>
<td>

**工程细节**
- [8. 附件与媒体控制](#8-附件与媒体访问控制给-app-的长链接给模型的稳链接)
- [9. API 契约](#9-后端-api-契约完整字段级)
- [10. 数据模型](#10-数据模型完整cloudflare-d1--r2--vectorize--android-本地)

</td>
<td>

**开发指南**
- [11. 开发者上手](#11-开发者上手怎么改东西不讲部署)
- [12. 未来演进](#12-未来演进你计划的方向写在蓝图里方便后续对齐)
- [附录 A. 自检清单](#附录-a最小自检清单不等于部署)

</td>
</tr>
</table>

---

## 1. 我想解决什么问题（设计目标 & 约束）

这一套系统的目标不是“能聊天就行”，而是做出一个**长期可用、会记事、情绪有惯性、成本可控**的角色对话系统。

### 🎯 1.1 设计目标

<table>
<tr>
<th width="20%">目标</th>
<th width="80%">描述</th>
</tr>
<tr>
<td>🎭 <strong>角色稳定</strong></td>
<td>亚托莉不是万能客服。她要有持续的心境、说话习惯、关系距离和“没说出口但心里挂着的话”。</td>
</tr>
<tr>
<td>🚫 <strong>少编故事</strong></td>
<td>不知道就查，不靠感觉硬补。需要细节时读日记、读原聊天、查记忆或联网。</td>
</tr>
<tr>
<td>🧠 <strong>记忆可控</strong></td>
<td>长期事实、日记场景、未说出口的话分层存储，避免把所有历史全塞进上下文。</td>
</tr>
<tr>
<td>💰 <strong>成本可控</strong></td>
<td>聊天只带两天上下文 + 少量召回；夜间整理合并成一次 LLM 输出，不在白天反复烧 token。</td>
</tr>
<tr>
<td>🔧 <strong>工程简单</strong></td>
<td>发布主线只保留 Cloudflare Worker 一套后端：D1、R2、Vectorize、Cron 都在 Cloudflare 里完成。</td>
</tr>
<tr>
<td>🔒 <strong>隐私安全</strong></td>
<td>业务接口统一走 <code>X-App-Token</code>；附件用签名 URL；密钥只放 Wrangler secret 或本地环境，不进仓库。</td>
</tr>
</table>

### ⚠️ 1.2 现实约束

| 约束 | 影响 | 当前做法 |
|------|------|----------|
| 模型上下文有限 | 不能每次塞全量聊天/日记 | 两天聊天上下文 + fact/episodic/intention 少量注入 |
| 模型会丢 query 参数 | 图片 URL 带签名 query 时可能 401 | 给模型用路径签名 `/media-s/...` |
| Cloudflare Worker 有执行时间 | 不能做很重的同步任务 | 日记、主动消息走 Cron；聊天工具循环限制轮数 |
| D1 是 SQLite | 不适合复杂全文检索 | 结构化事实走 D1，语义召回走 Vectorize |
| App 可能本地已有旧表 | Room 迁移必须兼容 | DB version 8，迁移 7→8 删除旧 diary/memories 表 |

---

## 2. 系统总览（组件与边界）

当前发布主线可以理解成三层：

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Android App (ATRI/)                     │
│  Compose UI / Room 本地消息 / DataStore 设置 / Retrofit API       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP JSON + X-App-Token
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker Backend (worker/)           │
│  Router / Agent / Diary Cron / Proactive Cron / Media / Compat    │
└───────────────┬──────────────────┬──────────────────┬────────────┘
                │                  │                  │
                ▼                  ▼                  ▼
        ┌─────────────┐      ┌─────────────┐    ┌──────────────┐
        │ D1 SQLite   │      │ R2 Bucket   │    │ Vectorize    │
        │ 对话/日记/记忆│      │ 附件对象     │    │ 语义向量检索 │
        └──────┬──────┘      └──────┬──────┘    └──────┬───────┘
               │                    │                  │
               └────────────────────┴──────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│              上游模型 / Embedding / Web Search / Notification     │
│       OpenAI 格式 / Anthropic 格式 / Gemini 格式统一适配           │
└─────────────────────────────────────────────────────────────────┘
```

### 📦 2.1 组件职责一览

<table>
<tr>
<th>组件</th>
<th>目录 / 服务</th>
<th>职责</th>
</tr>
<tr>
<td>📱 <strong>Android App</strong></td>
<td><code>ATRI/</code></td>
<td>
• Compose 聊天、日记、设置、“关于她”页面<br/>
• Room 只保存本地消息和消息版本，不再保存本地 diary/memory 表<br/>
• DataStore 保存用户 id、接口地址、头像等轻量配置<br/>
• 上传附件、发送聊天、拉取远端对话/日记/self model<br/>
• 显示状态胶囊，长按可看 <code>status.reason</code>
</td>
</tr>
<tr>
<td>☁️ <strong>Cloudflare Worker</strong></td>
<td><code>worker/</code></td>
<td>
• <code>/api/v1/chat</code>：核心聊天入口，一次性 JSON 返回<br/>
• <code>/conversation/*</code>：写日志、删日志、拉日志、作废记忆<br/>
• <code>/diary/*</code>：查询/列表/重生成日记<br/>
• <code>/upload</code>、<code>/media*</code>：R2 附件上传与签名读取<br/>
• <code>/models</code>、<code>/current-model</code>：模型列表和当前模型<br/>
• <code>/proactive/pending</code>：App 拉取主动消息<br/>
• <code>/api/v1/me/self-model</code>：“关于她”页面数据<br/>
• Cron：日记巩固、主动消息评估
</td>
</tr>
<tr>
<td>🗄️ <strong>D1</strong></td>
<td><code>ATRI_DB</code></td>
<td>
保存对话日志、日记、用户状态、用户设置、主动消息、事实记忆、情景记忆、心里念头、运行时配置、自我模型等。
</td>
</tr>
<tr>
<td>🪣 <strong>R2</strong></td>
<td><code>MEDIA_BUCKET</code></td>
<td>
保存用户上传的图片/文档附件。数据库只存 key/url/metadata，不存文件本体。
</td>
</tr>
<tr>
<td>🧭 <strong>Vectorize</strong></td>
<td><code>VECTORIZE</code></td>
<td>
保存 highlights、fact、episodic memory 的向量，用于自然召回。
</td>
</tr>
<tr>
<td>📝 <strong>共享提示词</strong></td>
<td><code>shared/prompts/</code></td>
<td>
提示词母本。<code>npm run deploy</code> 前会自动执行 <code>scripts/sync_shared.py</code> 生成 <code>worker/src/config/prompts.json</code>。
</td>
</tr>
</table>

---

## 3. 核心链路：一次对话到底怎么走完（从点发送开始）

这一节是整套系统的主线。看懂它，后面的状态、日记、记忆、附件都能对上。

### 🔄 3.1 对话顺序图（现状）

```text
┌────────┐                 ┌─────────────┐                 ┌─────────────────┐
│  用户  │                 │ Android App │                 │ Cloudflare Worker│
└───┬────┘                 └──────┬──────┘                 └────────┬────────┘
    │                             │                                  │
    │ ① 输入文字/选择附件          │                                  │
    │ ───────────────────────────>│                                  │
    │                             │ ② 附件先 POST /upload（可选）     │
    │                             │─────────────────────────────────>│
    │                             │<─────────────────────────────────│
    │                             │ ③ Room 先插入用户消息             │
    │                             │                                  │
    │                             │ ④ POST /conversation/log          │
    │                             │─────────────────────────────────>│
    │                             │                                  │
    │                             │ ⑤ POST /api/v1/chat               │
    │                             │─────────────────────────────────>│
    │                             │                                  │
    │                             │        ⑥ 鉴权 X-App-Token         │
    │                             │        ⑦ 读两天对话上下文          │
    │                             │        ⑧ 召回 fact/episodic       │
    │                             │        ⑨ 读取 pending proactive    │
    │                             │        ⑩ 读取 memory_intentions    │
    │                             │        ⑪ 拼 system prompt          │
    │                             │        ⑫ 工具循环调用上游模型       │
    │                             │        ⑬ 保存 reply 到日志          │
    │                             │        ⑭ 异步落状态/事实/念头副作用  │
    │                             │                                  │
    │                             │ ⑮ 返回 reply/status/intimacy/id    │
    │                             │<─────────────────────────────────│
    │                             │ ⑯ Room 插入 ATRI 回复              │
    │<────────────────────────────│ ⑰ UI 显示回复 + 状态胶囊            │
```

### 💡 3.2 为什么 App 要先写日志

App 在 `/api/v1/chat` 前先写 `/conversation/log`，主要是为了让后端有稳定的对话材料。

<table>
<tr>
<th width="50%">✅ 好处</th>
<th width="50%">⚠️ 代价</th>
</tr>
<tr>
<td>
• 日记 cron 能拿到用户原话<br/>
• 重新生成时能按 <code>replyTo</code> 找上下文<br/>
• 多端/重装后可以从远端拉回对话<br/>
• 删除消息时能同步 tombstone
</td>
<td>
• 聊天链路多一次请求<br/>
• 如果写日志失败，App 需要继续尝试聊天，不能直接卡死<br/>
• 需要用 <code>logId</code> 去重，避免重试写出重复消息
</td>
</tr>
</table>

### 🎭 3.3 聊天为什么是一次性 JSON，不是 SSE

当前 App 和 Worker 的主线是一次性 JSON：

```json
{
  "reply": "亚托莉说的话",
  "status": {
    "label": "陪着你",
    "pillColor": "#E3F2FD",
    "textColor": "#FFFFFF",
    "reason": "只说给我自己听的理由"
  },
  "intimacy": 12,
  "replyLogId": "..."
}
```

App 端为了聊天节奏，会在新 ATRI 消息上做逐字显示。也就是说：

- **网络协议不是流式**；
- **视觉体验有打字机感**；
- 真 SSE 会放到未来演进，不和当前实现混在一起。

### 🔄 3.4 两天上下文窗口

`history-context.ts` 会取“今天 + 昨天”的对话，按日期分段塞入模型上下文。

这么做的理由很直接：

| 方案 | 问题 |
|------|------|
| 只给当前一句 | 角色不连贯，刚说过的事容易断 |
| 全量聊天历史 | 贵、慢、噪声大，模型容易乱抓细节 |
| 今天 + 昨天 | 大多数日常连续性够用，成本也能控 |

更久以前的内容不靠上下文硬塞，而靠 `search_memory` / `read_diary` / `read_conversation` 按需查。

---

## 4. 创新点 1：状态胶囊 + 亲密度（让情绪有视觉表达，关系有惯性）

### 🎨 4.1 状态胶囊是什么

状态胶囊是聊天顶部那颗小胶囊，不只是装饰。它由后端 `user_states` 管：

```ts
status_label       // 展示文案，比如“陪着你”
status_pill_color  // 胶囊底色
status_text_color  // 文字颜色
status_reason      // 她为什么变成这个心境，只给自己听的理由
status_updated_at  // 更新时间
```

App 端对应：

- `BioChatResponse.Status.reason`
- `AtriStatus.LiveStatus.reason`
- `ChatTopBar.StatusPill(...)`

当前 UI 行为：状态文字会动画切换；长按胶囊会弹出 reason。

### 💕 4.2 亲密度是什么

亲密度是 `user_states.intimacy`，范围目前按 `-100 ~ 100` 夹紧。

它不是“每发一条 +1”的本地计数。旧版前端本地亲密度已经删除，后端是唯一真相。

| 场景 | 可能变化 |
|------|----------|
| 用户明确表达信任、依赖、承诺 | 小幅上升 |
| 用户攻击、否认、越界 | 下降 |
| 普通闲聊 | 通常不动 |
| 模型不确定 | 宁可不改，也不要乱改 |

### 🗃️ 4.3 数据落在哪

| 数据 | 位置 | 说明 |
|------|------|------|
| 当前状态 | D1 `user_states` | label / color / reason |
| 当前亲密度 | D1 `user_states.intimacy` | 后端唯一真相 |
| App 显示 | Room 当前消息 + ViewModel 状态 | 只显示，不维护单独计数 |
| 历史 mood | Room `messages.mood` | 保存当时回复携带的状态 JSON |

### 🔧 4.4 更新机制

模型回复必须输出结构化 JSON，里面可以带：

```json
{
  "reply": "我现在想说的话",
  "status": {
    "label": "安静陪着",
    "pillColor": "#BFD7EA",
    "textColor": "#FFFFFF",
    "reason": "他看起来累了，我不想追问"
  },
  "intimacyDelta": 1,
  "rememberFacts": [],
  "forgetFacts": []
}
```

`agent-reply-parser.ts` 负责解析，`agent-service.ts` 负责生成副作用计划，`applySideEffects(...)` 再落库。

### 🎯 4.5 它怎么影响回复

状态不是只给 UI 看。下一轮聊天时，`agent-prompt-builder.ts` 会把当前状态放进 `<现在>`：

```text
<现在>
和你认识：第 N 天
上次说话：...
我现在的状态：陪着你（#E3F2FD）
上次心境：...
我们的距离：76
</现在>
```

所以它会反过来影响语气，而不是一次性的显示字段。

---

## 5. 创新点 2：日记 highlights 向量记忆（用“提炼过的记忆”去做检索）

### ✨ 5.1 为什么不是把每句聊天都向量化

逐句聊天太碎，会带来很多噪声：

- “嗯”“好”“你说”这种无意义内容很多；
- 一天里话题很多，逐句召回容易抓错；
- 成本高，删除和修正也麻烦。

所以系统用夜间日记把一天压缩成 highlights：

```text
conversation_logs → diary_entries + highlights → Vectorize
```

highlights 是“这一天真正值得记的点”，更适合语义检索。

### 📝 5.2 向量写入

`diary-generator.ts` 生成日记时，会产出：

- `highlights`
- `episodicMemories`
- `factCandidates`
- `innerThoughts`

其中 highlights 会写入 Vectorize，id 形如：

```text
hl:<userId>:<date>:<index>
```

### 🔍 5.3 向量检索

聊天时不会无脑把所有 highlights 塞进 prompt，而是模型需要时调用工具：

| 工具 | 用途 |
|------|------|
| `search_memory` | 按 query 找可能相关的记忆/日期 |
| `read_diary` | 读某天日记原文 |
| `read_conversation` | 读某天聊天原文 |

这样回答旧事时会更像：

> “我想起来那天你说过……”

而不是：

> “数据库检索结果显示……”

### 🔗 5.4 回忆分两段

```text
当前问题
  ↓
search_memory 找到候选日期/片段
  ↓
如果只需要氛围：直接用候选片段影响回复
  ↓
如果需要细节：再 read_diary / read_conversation 查证
```

这能减少幻觉，也能少查不必要的数据。

---

## 6. 创新点 3：类人记忆系统（fact / episodic / intention 三层分工）

这是这次瘦身后的重点。记忆不再是一锅粥，而是分成三类。

### 🧩 6.1 fact：长期稳定认知

`fact_memories` 只放长期稳定事实，比如：

| 适合进 fact | 不适合进 fact |
|-------------|---------------|
| 用户长期身份 | 今天有点困 |
| 明确偏好/雷区 | 某次闲聊细节 |
| 关系承诺 | 单日情绪 |
| 稳定习惯 | 临时计划 |

核心字段：

```sql
id, user_id, text, type, importance, confidence,
source, source_date, embedding_id,
archived_at, updated_at
```

旧的“什么都记一点”会污染人格，现在通过 `fact-consolidation.ts` 每晚清理重复、合并和归档。

### 🎞️ 6.2 episodic：会自然想起的场景

`episodic_memories` 来自日记，但不是完整日记。

它更像人脑里的一个场景切片：

```json
{
  "title": "他认真谈起记忆系统",
  "content": "他希望我不是被问到才查，而是像真人一样自然想起以前发生过的事。",
  "emotion": "在意、想证明自己",
  "tags": ["记忆", "真实感"],
  "importance": 9,
  "emotionalWeight": 9
}
```

白天聊天时，`auto-recall-service.ts` 会尝试把相关场景注入成自然想起的旧事。

### 💭 6.3 intention：心里挂着的话

`memory_intentions` 保存日记里的 `innerThoughts`：

```sql
content           -- 想找机会自然说的话
trigger_hint      -- 什么气氛下适合说
urgency           -- 紧迫度
emotional_weight  -- 情绪权重
status            -- pending / used / expired / archived
expires_at        -- 过期时间
```

这不是任务清单。`agent-prompt-builder.ts` 注入时会写清楚：

```text
<我心里挂着的话>
这些是我之前没说出口、想找机会自然说的。
气氛合适才说，不合适就只放在心里，绝不机械念清单。
</我心里挂着的话>
```

回复完成后，`agent-service.ts` 会用文本重叠判断哪些 intention 已经自然说出，然后 `markIntentionUsed(...)`。

### 🌙 6.4 夜间巩固流程

Cloudflare Cron：`59 15 * * *`，按 UTC 看是每天 15:59，配合北京时间夜间使用。

```text
① 找今天有聊天但日记未 ready 的用户
                    ↓
② 拉 conversation_logs 拼 transcript
                    ↓
③ 一次 LLM 生成 diary / highlights / episodic / facts / innerThoughts
                    ↓
④ 保存 diary_entries
                    ↓
⑤ highlights 写 Vectorize
                    ↓
⑥ episodic_memories 入 D1，并尝试写向量
                    ↓
⑦ memory_intentions 入 D1
                    ↓
⑧ factCandidates 严格筛选后入 fact_memories
                    ↓
⑨ consolidateFactsForUser 合并、归档、清理
                    ↓
⑩ atri_self_model 夜间更新
```

### 🧹 6.5 瘦身后的删除点

这次发布前已经删掉/移除的旧东西：

| 区域 | 已处理 |
|------|--------|
| 后端旧表 | `chat_turns` 不再存在 |
| 后端死函数 | 旧 `searchMemories`、旧 recalled 标记函数、backfill 路由已清掉 |
| 后端孤儿表 | `memory_events` 已从 schema 移除，并新增 `0014_drop_memory_events.sql` 清远端旧表 |
| 前端底部弹窗 | `ui/sheet/*` 整套删除 |
| 前端本地记忆/日记表 | `MemoryDao/DiaryDao`、`MemoryEntity/DiaryEntity` 删除 |
| 前端本地亲密度 | `StatusRepository` 和本地 intimacy 计数删除 |
| 前端孤儿工具 | `ConversationFormatter` 删除 |

### 🔀 6.6 分流上游

| 用途 | 配置变量 | 说明 |
|------|----------|------|
| 💬 Chat | `OPENAI_API_URL` / `OPENAI_API_KEY` / `DEFAULT_CHAT_MODEL` | 实时聊天 |
| 📔 Diary | `DIARY_API_URL` / `DIARY_API_KEY` / `DIARY_MODEL` | 夜间日记和巩固 |
| 🧠 Embedding | `EMBEDDINGS_API_URL` / `EMBEDDINGS_API_KEY` / `EMBEDDINGS_MODEL` | 向量化 |
| 🌐 Web Search | `TAVILY_API_URL` / `TAVILY_API_KEY` | 联网查证，可选 |
| 📮 Notification | `EMAIL_API_KEY` / `PROACTIVE_NOTIFICATION_TARGET` | 主动消息外部提醒 |

---

## 7. 创新点 4：工具注册取代全量注入（把“查证”变成模型能力的一部分）

> 🚫 不把所有历史一股脑塞进去。
> ✅ 只给当前必要信息，剩下的让模型用工具查。

### 🔧 7.1 当前工具

工具定义在 `worker/src/services/agent-tools.ts`。

| 工具 | 作用 |
|------|------|
| `search_memory` | 查相关记忆/事实/日期 |
| `read_diary` | 读某天日记 |
| `read_conversation` | 读某天聊天原文 |
| `web_search` | 联网查证 |

状态、亲密度、记事实、忘事实不再作为外部 tool 直接暴露，而是让模型在最终 JSON 里提交：

```json
{
  "status": { "label": "...", "pillColor": "...", "textColor": "...", "reason": "..." },
  "intimacyDelta": 1,
  "rememberFacts": [{ "content": "...", "type": "preference", "importance": 8, "confidence": 0.9 }],
  "forgetFacts": [{ "factId": "..." }]
}
```

这样做的好处是：最终副作用集中落库，逻辑更清楚，也更容易控制。

### 🔄 7.2 工具循环怎么跑

`runInformationToolLoop(...)` 做的事：

```text
① 调上游 Chat API，带 tools
        ↓
② 如果返回 tool_calls，就逐个执行
        ↓
③ 工具结果作为 role=tool 放回 messages
        ↓
④ 最多循环 MAX_AGENT_LOOPS 次
        ↓
⑤ 拿最终文本，用 agent-reply-parser 解析 JSON
```

当前 `MAX_AGENT_LOOPS = 8`。

### 🌐 7.3 原生多格式支持

`worker/src/services/llm-service.ts` 内部统一用 OpenAI 风格 messages/tools，然后按配置转换：

| 格式 | 配置值 | 说明 |
|------|--------|------|
| OpenAI | `openai` | `/v1/chat/completions` |
| Anthropic | `anthropic` | `/v1/messages` |
| Gemini | `gemini` | `/v1beta/models/:model:generateContent` |

外部还提供兼容端点：

- `POST /v1/chat/completions`
- `POST /v1/messages`
- `POST /v1beta/models/:path+`

---

## 8. 附件与媒体访问控制（给 App 的长链接，给模型的稳链接）

### 📤 8.1 上传：`POST /upload`

App 上传附件时传：

```http
X-File-Name: a.png
X-File-Type: image/png
X-File-Size: 12345
X-User-Id: <userId>
X-App-Token: <APP_TOKEN>
```

Worker 保存到 R2，key 形如：

```text
u/<safeUserId>/<timestamp>-<safeFileName>
```

返回：

| 字段 | 说明 |
|------|------|
| `key` | R2 object key |
| `rawUrl` | `/media/<key>` |
| `url` | 给 App 的长签名 URL |
| `signedUrl` | 给模型的短路径签名 URL |

### 🔐 8.2 为什么要路径签名

模型侧经常会丢 query 参数：

```text
原本：/media/u/a.png?exp=...&sig=...
模型实际请求：/media/u/a.png
结果：401
```

所以给模型的 URL 用：

```text
/media-s/<exp>/<sig>/<key>
```

签名在路径里，不容易被模型吃掉。

### 🔒 8.3 访问控制优先级

| 路径 | 校验方式 |
|------|----------|
| `/media/:key+` | query 签名 → Header Token → query token 兼容 |
| `/media-s/:exp/:sig/:key+` | 路径签名 → Header/query token 兜底 |

签名算法：`HMAC-SHA256(key + "\n" + exp)`。secret 优先 `MEDIA_SIGNING_KEY`，否则回退 `APP_TOKEN`。

---

## 9. 后端 API 契约（完整｜字段级）

> 📌 统一规则：除 `OPTIONS *` 和少量兼容预检外，业务接口都要 `X-App-Token`。
> 📌 返回 JSON。CORS 当前允许 `*`。

### 9.1 `OPTIONS *`

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-App-Token, Authorization, X-File-Name, X-File-Type, X-File-Size, X-User-Id
```

### 9.2 `GET /health`

健康检查。

```json
{ "ok": true }
```

### 9.3 `POST /api/v1/chat`

核心聊天接口。

**Request**

```json
{
  "userId": "uuid",
  "content": "文本，可为空（只发图时）",
  "logId": "用户消息 id，可选，用于 replyTo/去重",
  "platform": "android",
  "userName": "可选",
  "clientTimeIso": "2026-05-07T10:30:00+08:00",
  "modelKey": "可选，上游模型 id",
  "imageUrl": "可选",
  "attachments": [
    { "type": "image", "url": "https://...", "mime": "image/png", "name": "a.png", "sizeBytes": 123 }
  ],
  "forceRegenerate": false
}
```

**Response**

```json
{
  "reply": "亚托莉回复",
  "status": {
    "label": "陪着你",
    "pillColor": "#E3F2FD",
    "textColor": "#FFFFFF",
    "reason": "她心里为什么这样"
  },
  "action": null,
  "intimacy": 76,
  "replyLogId": "atri-message-id",
  "replyTimestamp": 1778123456789,
  "replyTo": "user-message-id"
}
```

### 9.4 `POST /conversation/log`

写入用户或 ATRI 消息。

```json
{
  "logId": "可选",
  "userId": "uuid",
  "role": "user|atri",
  "content": "文本",
  "timestamp": 1778123456789,
  "attachments": [],
  "replyTo": "可选",
  "userName": "可选",
  "timeZone": "Asia/Shanghai",
  "date": "2026-05-07"
}
```

返回：

```json
{ "ok": true, "id": "最终 id", "date": "2026-05-07" }
```

### 9.5 `POST /conversation/delete`

软删除日志，并写 tombstone。

```json
{ "userId": "uuid", "ids": ["id1", "id2"] }
```

### 9.6 `GET /conversation/last`

查最近聊天日期。

```http
/conversation/last?userId=<uuid>&timeZone=Asia/Shanghai&date=2026-05-07
```

### 9.7 `GET /conversation/pull`

App 拉远端日志和 tombstone。

```http
/conversation/pull?userId=<uuid>&after=0&limit=200&tombstones=true
```

### 9.8 `POST /conversation/invalidate-memory`

用于删除/改写消息后，把相关事实软归档或标记失效。

### 9.9 `GET /diary`

```http
/diary?userId=<uuid>&date=2026-05-07
```

### 9.10 `GET /diary/list`

```http
/diary/list?userId=<uuid>&limit=7
```

### 9.11 `POST /diary/regenerate`

手动重生成某天日记。

```json
{ "userId": "uuid", "date": "2026-05-07" }
```

### 9.12 `GET /api/v1/me/self-model`

“关于她”页面。

```http
/api/v1/me/self-model?userId=<uuid>
```

返回：

```json
{
  "coreTraits": [],
  "speechStyle": [],
  "relationshipStance": "...",
  "emotionalBaseline": "...",
  "recentChanges": [],
  "taboos": [],
  "updatedAt": 1778123456789
}
```

### 9.13 `GET /proactive/pending`

App 拉取待展示主动消息。

```http
/proactive/pending?userId=<uuid>
```

### 9.14 `POST /upload`

上传附件到 R2。见 [8.1](#81-上传post-upload)。

### 9.15 `GET/HEAD /media/:key+`

读取 R2 对象。

### 9.16 `GET/HEAD /media-s/:exp/:sig/:key+`

读取路径签名对象，主要给模型用。

### 9.17 `GET /models`

拉上游模型列表。失败时返回 fallback。

### 9.18 `GET /current-model`

返回当前默认模型。

### 9.19 `POST /admin/clear-user`

管理清理接口，需要 `Authorization: Bearer <ADMIN_API_KEY>`。

会清理：

- diary entries
- conversation logs
- diary vector ids
- R2 media objects
- user settings
- fact memories
- episodic memories
- memory intentions
- user state

### 9.20 兼容 API

| 路径 | 用途 |
|------|------|
| `POST /v1/chat/completions` | OpenAI 兼容 |
| `POST /v1/messages` | Anthropic 兼容 |
| `POST /v1beta/models/:path+` | Gemini 兼容 |

---

## 10. 数据模型（完整｜Cloudflare D1 / R2 / Vectorize / Android 本地）

### 🗄️ 10.1 D1 表

表定义在 `worker/db/schema.sql`，迁移在 `worker/migrations/`。

| 表 | 用途 |
|----|------|
| `conversation_logs` | 对话日志，含 role/content/date/attachments/reply_to/deleted_at |
| `conversation_log_tombstones` | 删除同步 tombstone |
| `user_states` | 状态胶囊、亲密度、最后互动时间 |
| `diary_entries` | 每日第一人称日记、highlights、status |
| `user_settings` | 用户偏好设置 |
| `proactive_messages` | 主动消息待取队列 |
| `proactive_user_state` | 主动消息频率/冷却状态 |
| `fact_memories` | 长期稳定事实 |
| `episodic_memories` | 情景记忆 |
| `memory_intentions` | 心里挂着的话 |
| `admin_runtime_config` | 运行时配置 |
| `admin_prompts_override` | 提示词覆盖 |
| `memory_candidates` | 事实候选暂存/处理状态 |
| `atri_self_model` | “关于她”的自我模型 |
| `nightly_runs` | 夜间任务运行记录 |
| `fact_vector_state` | fact 向量状态 |

> 📌 `memory_events` 已删除。远端旧库需要跑 `0014_drop_memory_events.sql`。

### 🪣 10.2 R2 对象

R2 只保存附件二进制，路径：

```text
u/<safeUserId>/<timestamp>-<safeFileName>
```

D1 `conversation_logs.attachments` 保存附件 JSON，不保存文件本体。

### 🧭 10.3 Vectorize

当前向量大致有三类：

| 前缀 | 说明 |
|------|------|
| `hl:<userId>:<date>:<i>` | 日记 highlight |
| `fact:<id>` | 长期事实 |
| `epi:<id>` | 情景记忆 |

Vectorize 查不到时，系统会降级用 D1 里的重要度/更新时间排序。

### 📱 10.4 Android Room

`AtriDatabase` 当前 version = 8，只保留：

| 表 | Entity | 用途 |
|----|--------|------|
| `messages` | `MessageEntity` | 本地聊天显示、附件、mood、删除状态、版本计数 |
| `message_versions` | `MessageVersionEntity` | 编辑/重生成后的版本记录 |

已经删掉的旧本地表：

- `diary`
- `memories`

### 🧰 10.5 Android DataStore

DataStore 保存轻量配置，例如：

- user id
- server url / app token
- atri avatar path
- 输入/设置相关状态

不再保存本地亲密度。

---

## 11. 开发者上手（怎么改东西，不讲部署）

### 🔧 11.1 你最常改的东西 → 改哪儿

| 想改什么 | 主要文件 |
|----------|----------|
| 聊天入口 | `worker/src/routes/chat.ts` |
| 组 prompt | `worker/src/services/agent-prompt-builder.ts` |
| 模型调用/格式转换 | `worker/src/services/llm-service.ts` |
| 工具 | `worker/src/services/agent-tools.ts` |
| 状态/对话/日记 DB | `worker/src/services/data-service.ts` |
| fact 记忆 | `worker/src/services/memory-service.ts` |
| 情景记忆 | `worker/src/services/episodic-memory-service.ts` |
| 心里念头 | `worker/src/services/memory-intention-service.ts` |
| 日记生成 | `worker/src/services/diary-generator.ts` |
| 夜间任务 | `worker/src/jobs/diary-cron.ts` |
| 主动消息 | `worker/src/services/proactive-service.ts` / `worker/src/jobs/proactive-cron.ts` |
| App 聊天页 | `ATRI/app/src/main/java/me/atri/ui/chat/` |
| App 设置/关于她 | `ATRI/app/src/main/java/me/atri/ui/settings/` |
| App API 契约 | `ATRI/app/src/main/java/me/atri/data/api/` |
| App 本地 DB | `ATRI/app/src/main/java/me/atri/data/db/` |

### 🚀 11.2 新增一个工具的标准姿势

1. 在 `agent-tools.ts` 加 tool schema；
2. 在 `executeInfoTool(...)` 里写执行逻辑；
3. 在提示词里写清楚“什么时候该用”；
4. 跑 `npm run typecheck`；
5. 至少手动测一次模型真的会调用，而不是只写了工具没人用。

### 🧱 11.3 新增 D1 字段/表

1. 改 `worker/db/schema.sql`；
2. 新增 `worker/migrations/00xx_xxx.sql`；
3. 如果本地模拟需要，跑本地迁移；
4. 发布前对远端跑：

```bash
npx wrangler d1 migrations apply ATRI_DB --remote
```

### 📱 11.4 新增 App 字段

1. 后端 response 加字段；
2. Android `data/api/response/*` 加字段；
3. Repository 转换；
4. ViewModel 状态；
5. Compose UI 展示；
6. 跑 release 构建确认 Kotlin 编译过。

---

## 12. 未来演进（你计划的方向，写在蓝图里方便后续对齐）

### ✅ 12.1 已完成：后端瘦身

- 发布主线聚焦 Worker；
- 删除旧 dead code；
- `memory_events` 已从 schema 移除；
- 前端本地 Room 只保留聊天相关表。

### ✅ 12.2 已完成：类人记忆三层分工

- fact：长期稳定事实；
- episodic：自然想起的场景；
- intention：未说出口但心里挂着的话。

### ✅ 12.3 已完成：关于她

`GET /api/v1/me/self-model` + App 设置页“关于她”，把 `atri_self_model` 变成用户可见的成长记录。

### ✅ 12.4 已完成：主动消息

Worker Cron 每 30 分钟评估一次是否该主动说话，支持 pending 队列和外部通知。

### 🔊 12.5 待做：真正 SSE 流式输出

现在是一次性 JSON + App 逐字显示。以后如果要真流式，需要同时改：

- Worker 返回 SSE；
- Android Retrofit/OkHttp SSE 消费；
- 中途 tool call / 最终 status 的协议；
- 失败重试和 Room 写入时机。

### 🎨 12.6 待做：状态 reason 的更拟人 UI

当前是长按胶囊弹窗。以后可以改成更轻的 Popup、模糊背景、渐变出现，但这属于 UI 优化，不影响当前协议。

---

## 附录 A：最小“自检清单”（不等于部署）

### A.1 Worker 自检

```bash
cd worker
npm run typecheck
```

### A.2 Android release 构建

```bash
cd ATRI
cmd.exe /c gradlew.bat assembleRelease
```

产物：

```text
ATRI/app/build/outputs/apk/release/app-release.apk
```

### A.3 远端 D1 迁移

这次包含 `0014_drop_memory_events.sql`，所以部署前/后都要记得跑远端迁移：

```bash
cd worker
npx wrangler d1 migrations apply ATRI_DB --remote
```

### A.4 Cloudflare Worker 部署

```bash
cd worker
npm run deploy
```

如果本地没有登录态，就设置：

```bash
export CLOUDFLARE_API_TOKEN=<SECRET>
```

### A.5 最小手动验证

| 项目 | 验证方式 |
|------|----------|
| 健康检查 | `GET /health` 返回 `{ ok: true }` |
| 聊天 | App 发一条消息，能返回 reply/status/intimacy |
| 状态 reason | 长按状态胶囊能看到 reason 或默认文案 |
| 日记 | 有聊天记录的日期能生成/查询日记 |
| 关于她 | 设置页进入“关于她”能拉到 self model |
| 附件 | 上传图片后，App 能显示，模型能读取签名 URL |
| 主动消息 | `/proactive/pending?userId=...` 能取 pending 或空数组 |

---

<div align="center">

**这份蓝图按当前发布代码更新。**
**核心原则：少一点死代码，多一点可解释的长期关系感。**

</div>
