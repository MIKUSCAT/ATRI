
<div align="center">

# 🏗️ ATRI 技术架构蓝图

### 设计思路 · 运行原理 · 创新亮点

[![Architecture](https://img.shields.io/badge/Architecture-Dual%20Backend-blue?style=for-the-badge&logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Platform](https://img.shields.io/badge/Platform-Android-green?style=for-the-badge&logo=android)](https://developer.android.com/)
[![AI](https://img.shields.io/badge/AI-OpenAI%20%7C%20Claude%20%7C%20Gemini-orange?style=for-the-badge&logo=openai)](https://platform.openai.com/)

</div>

---

> 📖 **这不是"启动说明"，而是技术蓝图：**
> - 讲清楚**我为什么这么设计**（取舍/约束/目标）
> - 讲清楚**系统到底怎么跑**（一次对话怎么走完、状态胶囊/日记/记忆怎么联动）
> - 讲清楚**后续怎么继续开发**（改哪里、怎么扩展）
>
> ⚠️ **说明**：本文按"当前代码现状"写，聊天接口目前是**一次性 JSON 返回**（不是 SSE 流）。为避免隐私泄露，文中不写真实域名/账号/Key，统一用 `<YOUR_SERVER_URL>` 占位。
>
> 📌 **双后端说明**：项目同时维护 Cloudflare Worker（`worker/`）和 VPS/Zeabur（`server/`）两套后端。本文以 VPS 后端（`server/`）为主线描述，Cloudflare Worker 版功能基本一致，差异会单独标注。

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
- [4. 状态胶囊 + 亲密度衰减](#4-创新点-1状态胶囊--亲密度衰减让情绪有视觉表达关系有惯性)
- [5. 日记向量记忆](#5-创新点-2日记-highlights-向量记忆用提炼过的记忆去做检索)
- [6. 三档材料系统](#6-创新点-3日记用户档案实时事实分流上游--三个产物三种用途)
- [7. 工具注册机制](#7-创新点-4工具注册取代全量注入把查证变成模型能力的一部分)

</td>
</tr>
<tr>
<td>

**工程细节**
- [8. 附件与媒体控制](#8-附件与媒体访问控制给-app-的长链接给模型的稳链接)
- [9. API 契约](#9-后端-api-契约完整字段级)
- [10. 数据模型](#10-数据模型完整postgresql--本地存储--android-本地)

</td>
<td>

**开发指南**
- [11. 开发者上手](#11-开发者上手怎么改东西不讲部署)
- [12. 未来演进](#12-未来演进你计划的方向写在蓝图里方便后续对齐)
- [附录 A: 自检清单](#附录-a最小自检清单不等于部署)

</td>
</tr>
</table>

---

## 1. 我想解决什么问题（设计目标 & 约束）

这一套系统的目标不是"能聊天就行"，而是做出一个**长期可用、能记事、情绪有惯性、成本可控**的角色对话系统。

### 🎯 1.1 设计目标

<table>
<tr>
<th width="20%">目标</th>
<th width="80%">描述</th>
</tr>
<tr>
<td>🎭 <strong>角色稳定</strong></td>
<td>亚托莉不是"万能客服"，她要有持续的状态（状态胶囊）和关系温度（亲密度）</td>
</tr>
<tr>
<td>🚫 <strong>不乱编</strong></td>
<td>不确定就承认；需要回忆就去查原文/日记，不靠感觉补全；可以联网查证</td>
</tr>
<tr>
<td>🧠 <strong>记忆可控</strong></td>
<td>既要"记得住"，又要"不会因为全量塞上下文而失控/很贵"</td>
</tr>
<tr>
<td>💰 <strong>成本可控</strong></td>
<td>聊天上下文不能无限长，记忆检索要按需</td>
</tr>
<tr>
<td>🔧 <strong>工程可扩展</strong></td>
<td>已支持 OpenAI/Anthropic/Gemini 原生格式、兼容 API 端点、运行时配置热更新</td>
</tr>
<tr>
<td>🔒 <strong>隐私与安全</strong></td>
<td>所有 API 都要鉴权；附件链接要能控时效/可撤销；Secrets 用 AES-256-GCM 加密存储</td>
</tr>
</table>

### ⚠️ 1.2 现实约束

| 约束 | 影响 |
|------|------|
| 模型上下文有限、费用敏感 | 不可能每次都把"所有聊天记录+所有日记+所有记忆"塞进去 |
| 模型会丢参数/理解偏 | 尤其是图像 URL 的 query，经常在模型侧被丢掉，导致 401 |
| 用户可能断网 | 不能因为日志写失败就完全不能聊天；但又要尽量保证后端"有材料可总结" |

---

## 2. 系统总览（组件与边界）

把系统拆成四块（对应仓库四个目录）：

```
┌─────────────────────────────────────────────────────────────────┐
│                     Android App (ATRI/)                         │
│                    📱 UI + 本地存储 (Room)                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP JSON（加 X-App-Token）
                           ▼
    ┌──────────────────────┴──────────────────────┐
    │                                             │
    ▼                                             ▼
┌───────────────────────────────┐ ┌───────────────────────────────────────┐
│  ☁️ Cloudflare Worker (worker/) │ │   🖥️ VPS Server (server/)              │
│  D1 + R2 + Vectorize          │ │   Fastify + PostgreSQL + pgvector      │
│                                │ │   + 本地文件系统（附件）                 │
└───────────────────────────────┘ └───────────────────────────────────────┘
                           │
                           ▼ 原生多格式适配
┌─────────────────────────────────────────────────────────────────┐
│            上游模型（OpenAI / Anthropic / Gemini 格式）            │
│                   🤖 Chat / Embeddings API                       │
└─────────────────────────────────────────────────────────────────┘
```

### 📦 2.1 组件职责一览

<table>
<tr>
<th>组件</th>
<th>目录</th>
<th>职责</th>
</tr>
<tr>
<td>📱 <strong>Android App</strong></td>
<td><code>ATRI/</code></td>
<td>
• UI + 本地保存（Room）<br/>
• 上传附件到后端<br/>
• 把"用户消息"和"亚托莉回复"都写入后端的 <code>conversation_logs</code><br/>
• 把后端返回的 status/intimacy 显示成"状态胶囊"
</td>
</tr>
<tr>
<td>🖥️ <strong>VPS Server</strong></td>
<td><code>server/</code></td>
<td>
• <code>/api/v1/chat</code>：生成回复（一次性 JSON）<br/>
• <code>/conversation/*</code>：写/删/查/拉取对话日志<br/>
• <code>/diary/*</code>：查日记/列日记/手动重生成<br/>
• <code>/upload</code> & <code>/media*</code>：附件上传与访问控制<br/>
• <code>/models</code>：拉取上游模型列表给 App 选<br/>
• <code>/admin/*</code>：管理后台 API + 静态页面<br/>
• <code>/v1/chat/completions</code> / <code>/v1/messages</code> / <code>/v1beta/models/*</code>：兼容 API<br/>
• <strong>Cron</strong>：每天自动生成日记/用户档案，并写向量记忆<br/>
• <strong>主动消息</strong>：定时评估是否主动说话，支持 Email/企业微信外部通知<br/>
• <strong>Memory Rebuild</strong>：启动时可选重建向量记忆
</td>
</tr>
<tr>
<td>☁️ <strong>Cloudflare Worker</strong></td>
<td><code>worker/</code></td>
<td>
功能与 VPS 版基本一致，差异：使用 D1（SQLite）代替 PostgreSQL、R2 代替本地文件、Vectorize 代替 pgvector
</td>
</tr>
<tr>
<td>📝 <strong>共享提示词</strong></td>
<td><code>shared/prompts.json</code></td>
<td>
• 人格/日记/档案的"母本"<br/>
• 后端真正读取的是各自的 <code>config/prompts.json</code>（由脚本同步或直接内置）
</td>
</tr>
</table>

---

## 3. 核心链路：一次对话到底怎么走完（从点发送开始）

这一节是整套系统的**主线**。看懂它，你就能理解后面所有设计。

### 🔄 3.1 对话顺序图（现状）

```
┌────────┐                    ┌─────────────┐                   ┌────────────┐
│  用户  │                    │  Android    │                   │   Server   │
│        │                    │    App      │                   │            │
└───┬────┘                    └──────┬──────┘                   └─────┬──────┘
    │                                │                                 │
    │  ① 选择附件（可选）              │                                 │
    │  ② 点击发送                     │                                 │
    │ ──────────────────────────────>│                                 │
    │                                │                                 │
    │                                │  ③ 本地先插入 messages（Room）    │
    │                                │────────────────────────────────>│
    │                                │                                 │
    │                                │  ④ POST /conversation/log      │
    │                                │    (role=user, 写入 DB)         │
    │                                │────────────────────────────────>│
    │                                │                                 │
    │                                │  ⑤ POST /api/v1/chat           │
    │                                │    (content + 附件信息)          │
    │                                │────────────────────────────────>│
    │                                │                                 │
    │                                │         ┌──────────────────────┐│
    │                                │         │ ⑥ 鉴权 X-App-Token   ││
    │                                │         │ ⑦ 读今天+昨天对话日志 ││
    │                                │         │ ⑧ 读用户档案         ││
    │                                │         │ ⑨ 读实时事实记忆      ││
    │                                │         │ ⑩ 读 user_states    ││
    │                                │         │ ⑪ 组 system prompt   ││
    │                                │         │ ⑫ 调大模型（工具循环） ││
    │                                │         │ ⑬ 保存最新 user_states││
    │                                │         │ ⑭ 保存回复到对话日志  ││
    │                                │         └──────────────────────┘│
    │                                │                                 │
    │                                │  ⑮ 返回 JSON：                  │
    │                                │     reply + status + intimacy   │
    │                                │<────────────────────────────────│
    │                                │                                 │
    │                                │  ⑯ 插入回复到 messages（Room）   │
    │                                │                                 │
    │  ⑰ 显示回复 + 状态胶囊           │                                 │
    │<───────────────────────────────│                                 │
    │                                │                                 │
```

### 💡 3.2 "先写日志，再聊天"的核心动机

> **关键设计点**

你会看到 App 在调用 `/api/v1/chat` 之前，先 `POST /conversation/log` 写一条用户消息到 DB。

<table>
<tr>
<th width="50%">✅ 好处</th>
<th width="50%">⚠️ 带来的问题</th>
</tr>
<tr>
<td>
• Server 构造上下文时，不用信任客户端"给我最近 N 条消息"，而是直接读 DB 的对话日志<br/>
• 日记/档案/向量记忆都能以 DB 为材料，链路统一
</td>
<td>
Server 读"今天聊天记录"时，可能把刚写入的这一条也读到历史里，导致模型看到重复内容
</td>
</tr>
</table>

**解决方案**：App 会把这条用户消息的 id 作为 `logId` 传给 `/api/v1/chat`，Server 读历史时会剔除它（见 [`server/src/services/agent-service.ts`](server/src/services/agent-service.ts) 的 `excludeLogId`）。

> 📌 **一句话总结**：**DB 是"聊天事实源"，logId 是"去重开关"。**

### 🎭 3.3 为什么日志写失败也不阻塞聊天

[`ChatRepository.logConversationSafely(...)`](ATRI/app/src/main/java/me/atri/data/repository/ChatRepository.kt) 是 `runCatching` 包起来的：写日志失败会打印，但不会让 UI 卡死。

| 取舍 | 说明 |
|------|------|
| ✅ 用户体验优先 | 断网/超时也要尽量能继续聊（至少能拿到回复） |
| ⚠️ 代价 | 那一天的 DB 材料可能不完整，会影响日记/记忆质量 |

### 🔄 3.4 两天上下文窗口

Server 在构造聊天上下文时，会加载**今天 + 昨天**两天的对话日志作为历史（见 [`server/src/services/history-context.ts`](server/src/services/history-context.ts) 的 `loadTwoDaysConversationLogs`）。这让模型能自然地延续跨天话题，同时控制上下文长度。

> 📌 这个逻辑已抽取为独立模块 `history-context.ts`，被主对话（`agent-service.ts`）和主动消息（`proactive-service.ts`）共用，保证两者看到的上下文完全一致。

---

## 4. 创新点 1：状态胶囊 + 亲密度衰减（让情绪有视觉表达，关系有惯性）

### 🎨 4.1 状态胶囊是什么

**状态胶囊（Status Capsule）** 是 ATRI 的动态心情/状态显示系统。它不是传统的三维情绪坐标，而是**模型自主选择的文案 + 颜色**，用于在 App 端展示为一个小胶囊标签。

| 字段 | 含义 | 示例 |
|:----:|------|------|
| `status_label` | 状态文案（中文短句） | `陪着你`、`有点想你了`、`困了…` |
| `status_pill_color` | 胶囊底色（HEX） | `#E3F2FD`（ATRI 气泡色）、`#7FA8FF`、`#FF9A9E` |
| `status_text_color` | 胶囊文字颜色（HEX） | `#FFFFFF` |
| `status_reason` | 只说给自己听的原因 | `聊得很开心，想多待一会儿` |

> 💡 **设计理念**：不用抽象的三维数值（PAD）来表达情绪，而是让模型用自然语言 + 颜色直接表达"我现在是什么状态"，更直观、更有表现力。

### 💕 4.2 亲密度是什么

后端还维护一个 `intimacy`（范围 `-100` ~ `100`），代表"关系温度"。

> ⚠️ 它不是 UI 的装饰，而是会进 prompt，让回复风格随着关系变化。

### 🗃️ 4.3 数据落在哪

在 **`user_states`** 表（PostgreSQL / D1）：

```sql
user_id              -- 用户 id
status_label         -- 状态文案
status_pill_color    -- 胶囊底色 HEX
status_text_color    -- 胶囊文字颜色 HEX
status_reason        -- 状态原因（内部）
status_updated_at    -- 状态更新时间
intimacy             -- 关系温度整数
last_interaction_at / updated_at  -- 时间戳
```

### 🔧 4.4 更新机制（模型"申请修改"）

Server 给模型注册了两个工具（见 [`server/src/services/agent-service.ts`](server/src/services/agent-service.ts) 的 `AGENT_TOOLS`）：

```typescript
set_status(label, pill_color, text_color?, reason)
update_intimacy(delta, reason)
```

> 💡 **设计意图**：当模型判断"心情/状态应该变化"时，先通过 `set_status` 更新文案和颜色，再回答。亲密度变化则通过 `update_intimacy` 申请。

<details>
<summary>📝 如何让模型更积极地调用这些工具？</summary>

当前 system prompt 模板里已经写了明确规则：

```
当你觉得状态变化了，先调用 set_status 工具更新文案和颜色，再继续回复。
```

如果你发现模型很少调用，可以在 `shared/prompts.json` 的 `agent.system` 里加强指示。这比"后端写一堆 if/else 规则"更可扩展：你换人格/换模型/换提示词时，不需要重写规则引擎。

</details>

### 📉 4.5 衰减机制

<table>
<tr>
<th>衰减类型</th>
<th>规则</th>
<th>含义</th>
</tr>
<tr>
<td><strong>亲密度衰减</strong></td>
<td>
每隔 3 天，把亲密度往 0 推 1 点（正数变小，负数变大）
</td>
<td>💔 关系不维护会慢慢淡</td>
</tr>
<tr>
<td><strong>额外约束</strong></td>
<td>
• <code>update_intimacy</code> 的 delta 被 clamp 到 <code>[-50, 10]</code><br/>
• 如果当前亲密度 < 0，想升温会打折（<code>*0.6</code>，至少 +1）
</td>
<td>💔 "破镜难圆"的工程化表达</td>
</tr>
</table>

### 🎯 4.6 它怎么影响回复

[`composeAgentSystemPrompt(...)`](server/src/services/agent-service.ts) 会把状态胶囊信息和亲密度写进 system prompt（来自 `shared/prompts.json` 的 `agent.system` 模板或内置默认模板）。

> 📌 所以模型每次回复都带着"我现在是什么状态、和你是什么关系"。

Server 返回给 App 的 `status` 对象（包含 label/pillColor/textColor）和 `intimacy`，用于 UI 展示状态胶囊。

---

## 5. 创新点 2：日记 highlights 向量记忆（用"提炼过的记忆"去做检索）

> 💡 很多 RAG 的坑来自一句话：**把噪声也向量化了**。

我这里刻意不做"每句对话都进向量库"，而是：

```
① 先每天生成一篇日记（带 highlights）
           ↓
② 只把 highlights（4~10 条短句）向量化
           ↓
③ 检索时先召回"哪天发生过什么"，再按需读日记/原文
```

### ✨ 5.1 为什么 highlights 比逐句对话更适合向量化

| 优势 | 说明 |
|------|------|
| 🎯 **信息密度高** | highlights 是"事件 + 对象 + 情绪"的短句，不是闲聊口水 |
| 💰 **成本可控** | 每天最多 10 条向量，而不是上千条 |
| 🎲 **召回更稳** | 按"天"去重，更像人类回忆路径（先想起那天，再看细节） |

### 📝 5.2 向量写入

**VPS 版**使用 PostgreSQL + pgvector 扩展，向量直接存储在 `memory_vectors` 表中。

写入逻辑在 [`server/src/services/memory-service.ts`](server/src/services/memory-service.ts) 的 `upsertDiaryHighlightsMemory`：

```typescript
// 向量 ID 规则
id: `hl:<userId>:<date>:<i>`  // i 从 0 开始，最多 10

// 表字段
{
  id,
  user_id,
  date,          // 日期 YYYY-MM-DD
  idx,           // 序号
  text,          // highlight 原文
  mood,          // 情绪
  importance: 6, // 重要度（当前固定 6）
  timestamp,     // 写入时间戳
  embedding      // vector(1024) 向量
}
```

> 📌 **Cloudflare Worker 版**使用 Vectorize 存储向量，向量 ID 和 metadata 结构与上述类似。

### 🔍 5.3 向量检索（search_memory 工具）

模型想回忆时，不是后端强行把一堆记忆塞进 prompt，而是让模型自己调用：

```typescript
search_memory(query)
```

**实现流程**（[`server/src/services/memory-service.ts`](server/src/services/memory-service.ts)）：

```
① 对 query 做 embedding（调 Embeddings API）
           ↓
② PostgreSQL 余弦距离查询（embedding <=> vector），LIMIT topK
           ↓
③ 过滤：只保留 user_id 匹配的
           ↓
④ 返回按相似度排序的"片段"（日期 + 原文 + 分数）
```

### 🔗 5.4 回忆分两段：先找日期，再读原文

> 🚫 **防乱编的关键设计**

工具链在 [`server/src/services/agent-service.ts`](server/src/services/agent-service.ts)：

| 步骤 | 工具 | 作用 |
|:----:|------|------|
| 1️⃣ | `search_memory(query)` | 告诉模型"可能相关的是哪几天 + 一句片段" |
| 2️⃣ | `read_diary(date)` | 读那天日记（第一人称、情绪更浓） |
| 2️⃣ | `read_conversation(date)` | 读那天原始聊天（带时间戳，适合引用原话） |

> 📌 这就是**"工具注册取代全量注入"**的核心：不把所有历史塞进去，只在需要时取证。
>
> 新版记忆系统还会在每次聊天前做一次轻量“主动联想”，把相关情景记忆作为“脑海里自然浮现的旧事”注入；工具则继续负责不确定时的查证。

---

## 6. 创新点 3：类人记忆系统（fact / episodic / intention 三层分工）

> 💡 这次改造的核心不是“记得更多”，而是：**像人一样筛选、巩固、联想、选择性说出口**。

早期设计里，长期记忆主要由“日记 highlights + 实时 fact”承担。实际使用后会出现一个问题：

- fact 容易变成杂物箱；
- 日记虽然写得很好，但模型往往只有在用户问“你还记得吗”时才会主动查；
- 这不像人。人是当前话题触发旧场景，然后自然联想到过去。

因此 Worker 版记忆系统被重构为三层：

| 层级 | 表 | 解决什么 | 是否直接进 prompt |
|------|----|----------|------------------|
| 🧩 长期事实 | `fact_memories` | 长期稳定的偏好、雷区、约定、重要身份信息 | 少量高价值事实进入 |
| 🎞️ 情景记忆 | `episodic_memories` | 从日记提炼出的“那天发生过什么” | 当前话题相关才进入 |
| 💭 心里念头 | `memory_intentions` | 日记里未说出口、之后想找机会说的话 | pending 且气氛相关才进入 |
| 📜 记忆事件 | `memory_events` | 记录 recalled / used / archived / merged | 不进 prompt，用于再巩固和排查 |

### 🧩 6.1 fact：只保留长期稳定认知

`fact_memories` 不再只是 `content`。它现在带有权重和来源：

```sql
type              -- profile / preference / taboo / promise / relationship / habit / important / other
importance        -- 重要度 1-10
confidence        -- 置信度 0-1
source            -- chat / diary / manual / consolidation / legacy
source_date       -- 来源日期
recall_count      -- 被想起次数
last_recalled_at  -- 最近被想起时间
archived_at       -- 归档时间
```

写入原则变得更严格：

| 可以进 fact | 不该进 fact |
|------------|-------------|
| 长期喜好 / 雷区 | 今天吃了什么 |
| 重要身份信息 | 今天困不困 |
| 明确约定 | 某天普通闲聊 |
| 关系期待 / 情感创伤 | 单日流水账 |
| 稳定习惯 | 过期临时安排 |

`remember_fact` 工具也加入了 `type / importance / confidence` 参数，让模型在记住之前先判断这件事到底值不值得长期保存。

### 🎞️ 6.2 episodic：日记变成“会自然想起的场景”

完整日记仍然保存在 `diary_entries`，但夜间生成日记时，会额外产出 `episodicMemories`：

```json
{
  "title": "他认真谈起记忆系统",
  "content": "他希望我不是被问到才查，而是像真人一样自然想起以前发生过的事。",
  "emotion": "心虚、在意、想证明自己",
  "tags": ["记忆", "真实感", "关系期待"],
  "importance": 9,
  "confidence": 0.95,
  "emotionalWeight": 9
}
```

这类记忆不是干巴巴事实，也不是完整日记，而是“可被当前话题触发的旧场景”。

白天聊天时，Worker 会用当前用户消息做轻量联想检索：

```
用户当前消息
   ↓
Vectorize / D1 检索相关 episodic memories
   ↓
注入 <脑海里自然浮现的旧事>
   ↓
模型判断是否自然提起
```

提示词明确要求：

- 不要说“数据库显示”；
- 不要说“我检索到”；
- 合适才说，不合适只影响理解和语气；
- 需要细节时再用 `read_diary` / `read_conversation` 查证。

### 💭 6.3 intention：日记里未说出口的话

人类晚上回想一天时，经常会产生“下次见面想说的话”。

ATRI 现在也有这层：`memory_intentions`。

```sql
content           -- 想找机会自然说的话
trigger_hint      -- 什么气氛/话题下适合说
urgency           -- 紧迫度
emotional_weight  -- 情绪权重
status            -- pending / used / expired / archived
expires_at        -- 过期时间
```

这不是任务清单。模型不会机械完成它，而是在当前气氛合适时自然说出口。

### 🌙 6.4 夜间巩固流程

Cloudflare Worker 的日记 cron 现在做的不只是写日记：

```
① 找出今天有聊天但还没 ready 日记的用户
                    ↓
② 拉 conversation_logs → 拼 transcript
                    ↓
③ 一次 LLM 输出：diary / highlights / episodicMemories / factCandidates / innerThoughts
                    ↓
④ 保存 diary_entries
                    ↓
⑤ highlights 写入 Vectorize
                    ↓
⑥ episodicMemories 写入 episodic_memories
                    ↓
⑦ innerThoughts 写入 memory_intentions
                    ↓
⑧ factCandidates 严格筛选后写入 fact_memories
                    ↓
⑨ consolidateFactsForUser 合并重复、归档杂碎
```

为了控制成本，`diary / episodic / factCandidates / innerThoughts` 合并在同一次日记 LLM 输出里，白天聊天不额外增加 LLM 调用。

### 🧹 6.5 fact consolidation：杀伐果断清理杂碎

每晚整理 fact 时，模型被明确要求：

- 临时状态默认归档；
- 单日事件默认归档；
- 重复内容必须 merge；
- 日记细节不要进 fact；
- 如果输入超过 50 条，active facts 应明显变少。

输出结构仍然是简单 JSON：

```json
{
  "keep": ["fact:..."],
  "merge": [{ "from": ["fact:a", "fact:b"], "into": "合并后的长期事实" }],
  "archive": ["fact:..."]
}
```

`archive` 是软归档，用于避免误删；确认无用的数据可以通过管理脚本或迁移进一步硬删。

### 🔀 6.6 分流上游

| 用途 | 配置变量 | 说明 |
|------|----------|------|
| 💬 Chat | `OPENAI_API_URL` / `OPENAI_API_KEY` | 聊天走这个 |
| 📔 日记/巩固 | `DIARY_API_URL` / `DIARY_API_KEY` / `DIARY_MODEL` | 日记、情景记忆、fact 候选走这个 |
| 🧠 Embedding | `EMBEDDINGS_API_URL` / `EMBEDDINGS_API_KEY` / `EMBEDDINGS_MODEL` | highlights / episodic 检索向量 |

隔离的意义：

- 聊天要快、稳定；
- 日记允许慢一点、质量高一点；
- 日记上游挂了，不影响日常聊天。

## 7. 创新点 4：工具注册取代全量注入（把"查证"变成模型能力的一部分）

> 🚫 很多系统的做法是：把所有历史、所有记忆、所有档案拼成一个巨大 prompt。

**这样做的问题**：
- 💰 费用高、速度慢
- 🔊 噪声大、模型更容易"顺着噪声编"
- 🔧 记忆更新/删除很难控

**我这里的做法**：

```
① system prompt 只放"当前状态 + 使用规则 + 档案/事实的摘要"
                    ↓
② 把"回忆/查证/更新状态/联网搜索/记住事实"做成工具
                    ↓
③ 明确告诉模型：什么时候该用什么工具（写在 prompts 里）
```

### 🔧 7.1 当前已注册的 8 个工具

在 [`server/src/services/agent-service.ts`](server/src/services/agent-service.ts)：

| 工具 | 参数 | 作用 |
|------|------|------|
| `search_memory` | `query` | 找可能相关的日期/片段（来自 highlights + facts 向量） |
| `read_diary` | `date` | 读那天日记（第一人称） |
| `read_conversation` | `date` | 读那天原文聊天（带时间戳） |
| `web_search` | `query` | 联网搜索（Tavily API），确认不确定的事实 |
| `set_status` | `label`, `pill_color`, `text_color?`, `reason` | 更新状态胶囊（文案 + 颜色） |
| `update_intimacy` | `delta`, `reason` | 更新关系温度 |
| `remember_fact` | `content` | 记住一个具体事实（实时向量化存储） |
| `forget_fact` | `factId` | 忘掉一个过时的事实 |

### 🔄 7.2 工具循环怎么跑（最多 5 轮）

`runToolLoop(...)` 做的事：

```
① 调上游 Chat API（带 tools + tool_choice=auto）
                    ↓
② 如果模型返回 tool_calls：逐个执行，结果作为 role=tool 塞回 messages
                    ↓
③ 【关键】执行完工具后，会用最新状态重建 system prompt
                    ↓
④ 继续下一轮，直到模型不再调用工具，给出最终回复
```

> 📌 这保证：模型"先更新状态/亲密度"，下一句回复就能体现变化，不会延迟一轮。

### 🌐 7.3 原生多格式支持

[`server/src/services/llm-service.ts`](server/src/services/llm-service.ts) 实现了对三种 API 格式的原生支持：

| 格式 | 端点 | 消息转换 | 工具转换 |
|------|------|----------|----------|
| **OpenAI** | `/v1/chat/completions` | 原生（无需转换） | 原生 |
| **Anthropic** | `/v1/messages` | `openAiMessagesToAnthropic` | `openAiToolsToAnthropic` |
| **Gemini** | `/v1beta/models/:model:generateContent` | `openAiMessagesToGemini` | `openAiToolsToGemini` |

内部统一使用 OpenAI 格式的 messages/tools 数据结构，在发送请求时按 `chatApiFormat` 配置自动转换。响应也会统一提取回 OpenAI 格式的 `{ content, tool_calls }`。

---

## 8. 附件与媒体访问控制（给 App 的长链接，给模型的稳链接）

### 📤 8.1 上传（`POST /upload`）

在 [`server/src/routes/media.ts`](server/src/routes/media.ts)：

```typescript
// App 上传时的 Header
X-File-Name / X-File-Type / X-File-Size / X-User-Id

// body 是文件字节流

// Server 存到本地文件系统（MEDIA_ROOT），key 形如：
`u/<safeUserId>/<timestamp>-<safeFileName>`
```

**返回值**：

| 字段 | 说明 |
|------|------|
| `key` | 存储 key |
| `rawUrl` | 不签名的 `/media/<key>` |
| `url` | 给 App 的长签名 URL（默认 1 年） |
| `signedUrl` | 给模型的短签名 URL（默认 10 分钟，且是路径签名） |

### 🔐 8.2 为什么要"路径签名"

> ⚠️ **这是为了对抗模型丢 query**

模型侧经常出现这种情况：

```
你给了：https://.../media/xxx?exp=...&sig=...
模型请求时把 ?exp&sig 丢了 → 401
```

所以我专门给模型做了一种形式：

```
/media-s/<exp>/<sig>/<key>
```

这个签名在路径里，不依赖 query，模型更不容易丢。

**实现见**：
- [`server/src/utils/media-signature.ts`](server/src/utils/media-signature.ts) 的 `signMediaUrlForModel`
- [`server/src/routes/media.ts`](server/src/routes/media.ts) 的 `/media-s/...` 路由

### 🔒 8.3 访问控制优先级（现状）

**读取 `/media/:key+`**（给 App）：

```
① query 签名 exp/sig 校验通过
          ↓（失败则继续）
② Header X-App-Token 校验通过
          ↓（失败则继续）
③ query ?token=<APP_TOKEN> 校验通过（兼容兜底，不推荐）
```

**读取 `/media-s/...`**（给模型）：

```
① 优先校验路径签名
          ↓（不通过）
② 走 Header/query token 兜底
```

**签名算法**：`HMAC-SHA256(key + "\n" + exp)`，secret 优先用 `MEDIA_SIGNING_KEY`，否则回退 `APP_TOKEN`。

---

## 9. 后端 API 契约（完整｜字段级）

> 📌 **统一规则**：除 `OPTIONS *` 外，所有业务接口都需要 `X-App-Token`；返回 JSON。
> CORS：`Access-Control-Allow-Origin: *`。
>
> 📌 **双后端一致**：Cloudflare Worker 版和 VPS 版对外 API 路径保持一致，客户端无需改代码。

下面写的是"现状协议"，继续开发请以此为基准。

---

### 9.1 `OPTIONS *`

用于浏览器预检，返回：
```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-App-Token, Authorization, X-File-Name, X-File-Type, X-File-Size, X-User-Id
```

---

### 9.2 `POST /api/v1/chat`（生成回复）

<details>
<summary>📋 点击展开详情</summary>

**Header**
```http
Content-Type: application/json
X-App-Token: <token>
```

**Request Body（推荐字段名）**
```json
{
  "userId": "uuid",
  "content": "文本，可为空（只发图时）",
  "logId": "这条用户消息在 DB 的 id（用于去重，可选）",
  "platform": "android（可选）",
  "userName": "可选",
  "clientTimeIso": "2026-01-02T22:33:44+08:00（可选）",
  "modelKey": "上游模型 id（可选）",
  "imageUrl": "data:... 或 https://...（可选）",
  "attachments": [
    { "type": "image|document", "url": "https://.../media/...", "mime": "image/png", "name": "a.png", "sizeBytes": 123 }
  ],
  "timeZone": "Asia/Shanghai（可选）"
}
```

**Response（成功）**
```json
{
  "reply": "亚托莉的回复",
  "status": {
    "label": "陪着你",
    "pillColor": "#E3F2FD",
    "textColor": "#FFFFFF"
  },
  "action": null,
  "intimacy": 12,
  "replyLogId": "uuid",
  "replyTimestamp": 1730000000000,
  "replyTo": "原 logId"
}
```

**常见错误**
| 状态码 | 响应 | 原因 |
|:------:|------|------|
| 503 | `{"error":"app_token_missing"}` | 后端没配置 `APP_TOKEN` |
| 401 | `{"error":"unauthorized"}` | Token 不匹配 |
| 400 | `{"error":"invalid_request","message":"..."}` | 缺 userId 或完全空消息 |
| 500 | `{"error":"bio_chat_failed","details":"..."}` | 上游模型失败等 |

</details>

---

### 9.3 `POST /conversation/log`（写入日志）

<details>
<summary>📋 点击展开详情</summary>

**Header**
```http
Content-Type: application/json
X-App-Token: <token>
```

**Request Body**
```json
{
  "logId": "可选（作为 id 写入 DB）",
  "userId": "uuid",
  "role": "user|atri",
  "content": "文本，不能为空",
  "timestamp": 1730000000000,
  "attachments": [
    { "type": "image|document", "url": "https://.../media/...", "mime": "image/png", "name": "a.png", "sizeBytes": 123 }
  ],
  "replyTo": "可选（回复的目标消息 id）",
  "userName": "可选（用户侧昵称）",
  "timeZone": "Asia/Shanghai（可选）",
  "date": "2026-01-02（可选）"
}
```

**Response（成功）**
```json
{ "ok": true, "id": "最终写入的id", "date": "YYYY-MM-DD" }
```

**错误**
| 状态码 | 响应 | 原因 |
|:------:|------|------|
| 400 | `{"error":"invalid_params"}` | 缺 userId 或 role 不合法 |
| 400 | `{"error":"empty_content"}` | content 为空 |
| 500 | `{"error":"log_failed"}` | 写入失败 |

</details>

---

### 9.4 `POST /conversation/delete`（按 id 批量删除日志）

**Request**
```json
{ "userId": "uuid", "ids": ["id1","id2"] }
```

**Response**
```json
{ "ok": true, "deleted": 2 }
```

---

### 9.5 `GET /conversation/last`（查询上次聊天日期）

| Query 参数 | 必填 | 默认值 |
|------------|:----:|--------|
| `userId` | ✅ | - |
| `timeZone` | ❌ | `Asia/Shanghai` |
| `date` | ❌ | 按 timeZone 取今天 |

**Response**
```json
// 没有记录
{ "status": "missing" }

// 有记录
{ "status": "ok", "date": "YYYY-MM-DD", "daysSince": 3 }
```

---

### 9.6 `GET /diary`（查某天日记）

| Query 参数 | 必填 |
|------------|:----:|
| `userId` | ✅ |
| `date` | ✅ (YYYY-MM-DD) |

**Response**
```json
// 不存在
{ "status": "missing" }

// 存在
{ "status": "ready|pending|error", "entry": { ... } }
```

---

### 9.7 `GET /diary/list`（列日记）

| Query 参数 | 必填 | 默认值 |
|------------|:----:|--------|
| `userId` | ✅ | - |
| `limit` | ❌ | 7（最大 30） |

**Response**
```json
{
  "entries": [
    {
      "id": "diary:...",
      "date": "YYYY-MM-DD",
      "summary": "...",
      "content": "...",
      "mood": "...",
      "status": "ready",
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```

---

### 9.8 `POST /diary/regenerate`（重生成某天日记）

**Request**
```json
{ "userId": "uuid", "date": "YYYY-MM-DD" }
```

**Response（成功）**
```json
{ "status": "ready", "entry": { ... } }
```

**常见错误**
| 状态码 | 响应 | 原因 |
|:------:|------|------|
| 404 | `{"error":"no_conversation_logs"}` | 当天没有对话日志 |
| 500 | `{"status":"error","error":"..."}` | 生成失败 |

---

### 9.9 `POST /upload`（上传附件）

**Header**
```http
X-App-Token: <token>
X-File-Name: filename.png
X-File-Type: image/png
X-File-Size: 12345
X-User-Id: uuid
```

**Body**：文件二进制

**Response**
```json
{
  "key": "u/xxx/173...-a.png",
  "url": "给App用的长签名URL（可能带 exp/sig）",
  "signedUrl": "给模型用的路径签名URL（/media-s/...）",
  "rawUrl": "不签名的URL",
  "mime": "image/png",
  "size": 123
}
```

---

### 9.10 `GET/HEAD /media/:key+`（读取附件）

允许三种方式放行（见第 8 节）。成功会返回对象内容，并带：
```http
Cache-Control: public, max-age=31536000
```

---

### 9.11 `GET/HEAD /media-s/:exp/:sig/:key+`（路径签名读取附件）

给模型用的稳定形式，见第 8 节。

---

### 9.12 `GET /models`（模型列表）

代理请求上游模型列表，归一成：
```json
{
  "models": [
    { "id": "...", "label": "...", "provider": "...", "note": "..." }
  ]
}
```

---

### 9.13 `POST /admin/clear-user`（清理用户数据）

<details>
<summary>📋 点击展开详情</summary>

**Header**
```http
Authorization: Bearer <ADMIN_API_KEY>
```

**Request**
```json
{ "userId": "uuid" }
```

**Response**
```json
{
  "ok": true,
  "userId": "uuid",
  "stats": {
    "diaries": 10,
    "diaryVectors": 100,
    "conversationLogs": 200,
    "mediaObjects": 5,
    "userSettings": 1
  }
}
```

</details>

---

### 9.14 兼容 API 端点（仅 VPS）

VPS 后端额外提供三组兼容端点，让第三方客户端（如 ChatGPT 类工具）直接接入：

| 端点 | 鉴权方式 | 格式 |
|------|----------|------|
| `POST /v1/chat/completions` | `Authorization: Bearer <COMPAT_API_KEY>` | OpenAI 格式 |
| `POST /v1/messages` | `x-api-key` 或 `Authorization: Bearer` | Anthropic 格式 |
| `POST /v1beta/models/:model:generateContent` | `key` query 或 `x-goog-api-key` header | Gemini 格式 |

> ⚠️ 兼容端点不支持 `stream=true`，仅支持一次性 JSON 返回。
>
> 📌 兼容端点会自动创建匿名用户（基于 API key 的 SHA-256 哈希），并记录对话日志。

---

### 9.15 管理后台 API（仅 VPS）

管理后台通过 `ADMIN_API_KEY` 鉴权，提供：

| 端点 | 功能 |
|------|------|
| `GET /admin/config` | 读取运行时配置（public 部分 + secrets 存在性） |
| `PATCH /admin/config` | 更新运行时配置和密钥（AES-256-GCM 加密存储） |
| `DELETE /admin/config` | 重置运行时配置 |
| `GET /admin/prompts` | 读取提示词覆盖 |
| `PUT /admin/prompts` | 更新提示词覆盖 |
| `DELETE /admin/prompts` | 重置提示词覆盖 |
| `GET /admin/logs` | 读取应用日志缓冲 |

---

## 10. 数据模型（完整｜PostgreSQL / 本地存储 / Android 本地）

### 🗄️ 10.1 PostgreSQL（[`server/src/services/db-bootstrap.ts`](server/src/services/db-bootstrap.ts) 自动建表）

<table>
<tr>
<th colspan="2">conversation_logs（对话日志）</th>
</tr>
<tr>
<td><code>id</code></td>
<td>主键（客户端可传 logId，否则后端生成 UUID）</td>
</tr>
<tr>
<td><code>user_id</code></td>
<td>用户 id</td>
</tr>
<tr>
<td><code>date</code></td>
<td>YYYY-MM-DD（优先用客户端传入 date，否则按 timestamp+timeZone 计算）</td>
</tr>
<tr>
<td><code>role</code></td>
<td><code>user|atri</code></td>
</tr>
<tr>
<td><code>content</code></td>
<td>清洗后的文本</td>
</tr>
<tr>
<td><code>attachments</code></td>
<td>JSON 字符串（数组）</td>
</tr>
<tr>
<td><code>reply_to</code></td>
<td>回复目标消息 id（可选）</td>
</tr>
<tr>
<td><code>timestamp</code></td>
<td>毫秒</td>
</tr>
<tr>
<td><code>user_name</code></td>
<td>可选</td>
</tr>
<tr>
<td><code>time_zone</code></td>
<td>可选</td>
</tr>
<tr>
<td><code>created_at</code></td>
<td>写入时间</td>
</tr>
</table>

<table>
<tr>
<th colspan="2">conversation_log_tombstones（删除标记）</th>
</tr>
<tr>
<td><code>user_id</code> + <code>log_id</code></td>
<td>复合主键，记录已删除的日志 ID</td>
</tr>
<tr>
<td><code>deleted_at</code></td>
<td>删除时间戳</td>
</tr>
</table>

<table>
<tr>
<th colspan="2">user_states（用户状态）</th>
</tr>
<tr>
<td><code>status_label</code></td>
<td>状态胶囊文案（如"陪着你"）</td>
</tr>
<tr>
<td><code>status_pill_color</code></td>
<td>胶囊底色 HEX（如 #E3F2FD）</td>
</tr>
<tr>
<td><code>status_text_color</code></td>
<td>胶囊文字颜色 HEX（如 #FFFFFF）</td>
</tr>
<tr>
<td><code>status_reason</code></td>
<td>状态原因（内部使用）</td>
</tr>
<tr>
<td><code>status_updated_at</code></td>
<td>状态更新时间戳</td>
</tr>
<tr>
<td><code>intimacy</code></td>
<td>关系温度（-100 ~ 100）</td>
</tr>
<tr>
<td><code>last_interaction_at</code> / <code>updated_at</code></td>
<td>用于衰减与更新</td>
</tr>
</table>

<table>
<tr>
<th colspan="2">diary_entries（日记）</th>
</tr>
<tr>
<td><code>id</code></td>
<td><code>diary:&lt;userId&gt;:&lt;date&gt;</code></td>
</tr>
<tr>
<td><code>summary</code></td>
<td>highlights 拼接或正文摘要</td>
</tr>
<tr>
<td><code>content</code></td>
<td>日记正文</td>
</tr>
<tr>
<td><code>mood</code></td>
<td>一个词</td>
</tr>
<tr>
<td><code>status</code></td>
<td><code>pending|ready|error</code></td>
</tr>
</table>

<table>
<tr>
<th colspan="2">user_settings（用户设置）</th>
</tr>
<tr>
<td><code>model_key</code></td>
<td>用户偏好模型</td>
</tr>
</table>

<table>
<tr>
<th colspan="2">user_profiles（用户档案）</th>
</tr>
<tr>
<td><code>content</code></td>
<td>JSON 字符串（事实/喜好/雷区/说话风格/关系进展）</td>
</tr>
</table>

<table>
<tr>
<th colspan="2">memory_vectors（向量记忆 — pgvector）</th>
</tr>
<tr>
<td><code>id</code></td>
<td>主键：<code>hl:&lt;userId&gt;:&lt;date&gt;:&lt;i&gt;</code>（日记 highlights）或 <code>fact:&lt;userId&gt;:&lt;hash&gt;</code>（实时事实）</td>
</tr>
<tr>
<td><code>user_id</code></td>
<td>用户 id</td>
</tr>
<tr>
<td><code>date</code></td>
<td>日期</td>
</tr>
<tr>
<td><code>idx</code></td>
<td>序号（facts 为 -1）</td>
</tr>
<tr>
<td><code>text</code></td>
<td>原文</td>
</tr>
<tr>
<td><code>mood</code></td>
<td>情绪标签（facts 为 <code>system_fact</code>）</td>
</tr>
<tr>
<td><code>importance</code></td>
<td>重要度（highlights=6, facts=10）</td>
</tr>
<tr>
<td><code>timestamp</code></td>
<td>写入时间戳</td>
</tr>
<tr>
<td><code>embedding</code></td>
<td><code>vector(1024)</code> — pgvector 类型</td>
</tr>
</table>

<table>
<tr>
<th colspan="2">admin_runtime_config（运行时配置）</th>
</tr>
<tr>
<td><code>config_json</code></td>
<td>公开配置 JSON（API 格式、URL、温度、token 数等）</td>
</tr>
<tr>
<td><code>secrets_*</code></td>
<td>AES-256-GCM 加密的密钥（ciphertext + iv + tag）</td>
</tr>
</table>

<table>
<tr>
<th colspan="2">admin_prompts_override（提示词覆盖）</th>
</tr>
<tr>
<td><code>prompts_json</code></td>
<td>覆盖的提示词 JSON（agent/diary/profile/proactive 的 system 和 userTemplate）</td>
</tr>
</table>

<table>
<tr>
<th colspan="2">proactive_messages（主动消息记录）</th>
</tr>
<tr>
<td><code>id</code></td>
<td>主键：<code>pm:&lt;logId&gt;</code></td>
</tr>
<tr>
<td><code>user_id</code></td>
<td>用户 id</td>
</tr>
<tr>
<td><code>content</code></td>
<td>主动消息文本</td>
</tr>
<tr>
<td><code>trigger_context</code></td>
<td>触发上下文 JSON（intimacy/hoursSince/localHour 等）</td>
</tr>
<tr>
<td><code>status</code></td>
<td><code>pending|delivered|expired</code></td>
</tr>
<tr>
<td><code>notification_channel</code></td>
<td><code>none|email|wechat_work</code></td>
</tr>
<tr>
<td><code>notification_sent</code></td>
<td>外部通知是否已发送</td>
</tr>
<tr>
<td><code>expires_at</code></td>
<td>过期时间（默认 72 小时后）</td>
</tr>
</table>

<table>
<tr>
<th colspan="2">proactive_user_states（主动消息用户状态）</th>
</tr>
<tr>
<td><code>user_id</code></td>
<td>用户 id</td>
</tr>
<tr>
<td><code>last_proactive_at</code></td>
<td>上次主动消息时间戳</td>
</tr>
<tr>
<td><code>daily_count</code> / <code>daily_count_date</code></td>
<td>当日已发送数量与对应日期</td>
</tr>
</table>

### 📦 10.2 本地文件系统（VPS 附件存储）

```
MEDIA_ROOT/
  u/<safeUser>/<timestamp>-<safeName>          # 附件文件
  u/<safeUser>/<timestamp>-<safeName>.meta.json # 元数据（contentType 等）
```

### 📱 10.3 Android 本地（Room + DataStore）

**Room**：[`ATRI/app/src/main/java/me/atri/data/db/AtriDatabase.kt`](ATRI/app/src/main/java/me/atri/data/db/AtriDatabase.kt)

| 表 | 说明 |
|---|---|
| `messages` | 消息（带 isDeleted/isImportant/version） |
| `message_versions` | 消息版本（用于编辑/重答） |
| `diary` | 本地缓存日记（当前主要用于展示） |
| `memories` | 本地记忆表（更多用于统计/预留） |

**DataStore**：[`PreferencesStore.kt`](ATRI/app/src/main/java/me/atri/data/datastore/PreferencesStore.kt)

| Key | 说明 |
|-----|------|
| `api_url` | Server URL |
| `app_token` | 鉴权 token |
| `model_name` | 模型 id |
| `user_id` / `user_name` | 用户信息 |
| `last_chat_date` | 离线兜底 |

---

## 11. 开发者上手（怎么改东西，不讲部署）

### 🔧 11.1 你最常改的东西 → 改哪儿

| 你想改什么 | 改哪些文件 |
|------------|------------|
| 🎭 改人格/口吻/工具使用规则 | [`shared/prompts.json`](shared/prompts.json) 的 `agent`（或通过管理后台在线编辑） |
| 📔 改日记写法 | [`shared/prompts.json`](shared/prompts.json) 的 `diary` |
| 📋 改用户档案结构 | [`shared/prompts.json`](shared/prompts.json) 的 `profile` + [`server/src/services/profile-generator.ts`](server/src/services/profile-generator.ts) |
| 🔧 加一个新工具 | [`server/src/services/agent-service.ts`](server/src/services/agent-service.ts)（AGENT_TOOLS + executeAgentTool） |
| 🧠 改向量记忆策略 | [`server/src/services/memory-service.ts`](server/src/services/memory-service.ts) |
| 📬 改主动消息逻辑 | [`server/src/services/proactive-service.ts`](server/src/services/proactive-service.ts) |
| 📜 改上下文构建 | [`server/src/services/history-context.ts`](server/src/services/history-context.ts)（主对话+主动消息共用） |
| 🔐 改附件安全/签名 | [`server/src/utils/media-signature.ts`](server/src/utils/media-signature.ts) + [`server/src/routes/media.ts`](server/src/routes/media.ts) |
| 🌐 改 LLM 格式适配 | [`server/src/services/llm-service.ts`](server/src/services/llm-service.ts) |
| ⚙️ 改运行时配置系统 | [`server/src/services/runtime-settings.ts`](server/src/services/runtime-settings.ts) |
| 📱 App 增加/调用新接口 | [`ATRI/.../AtriApiService.kt`](ATRI/app/src/main/java/me/atri/data/api/AtriApiService.kt) + Repository + ViewModel + UI |

### 🚀 11.2 "工具注册"扩展的标准姿势

> 推荐流程

```
① 先想清楚：这个能力是"读事实"（适合工具），还是"生成文本"（适合模型直接回答）
                    ↓
② 加工具 schema（让模型知道参数是什么）
                    ↓
③ 实现工具执行（必须返回可读的、可信的内容）
                    ↓
④ 在 prompts 里写清楚"什么时候该用它"（否则模型不会用/乱用）
```

---

## 12. 未来演进（你计划的方向，写在蓝图里方便后续对齐）

> 📌 这一节只讲"计划怎么扩"，不影响现状实现。

### ✅ 12.1 已完成：原生多格式支持

**已实现**：`llm-service.ts` 支持 OpenAI、Anthropic、Gemini 三种原生 API 格式，通过 `chatApiFormat` / `diaryApiFormat` 配置切换。

### ✅ 12.2 已完成：主动消息（ATRI 先开口）

**已实现**：后端定时评估是否应该主动说话，并生成 `role=atri` 的消息写入 `conversation_logs`。

**核心机制**（[`server/src/services/proactive-service.ts`](server/src/services/proactive-service.ts)）：

| 项目 | 说明 |
|------|------|
| 触发方式 | 后端定时调度（默认每 60 分钟检查一次） |
| 上下文 | 与主对话一致的两天历史窗口（共用 `history-context.ts`） |
| 判断逻辑 | 模型自主决定——认为该说就说，不该打扰就输出 `[SKIP]` |
| 消息落库 | 写入 `conversation_logs`（role=atri）+ `proactive_messages` 表 |
| 外部通知 | 模型可调用 `send_notification` 工具，支持 Email（Resend）和企业微信 Webhook |
| 频率控制 | 安静时段、每日上限、冷却时间、亲密度门槛、最近活跃过滤 |

**配置方式**（全部在 `/admin` 管理后台，无需重启）：

1. **Runtime Config** → 开启主动消息，设置检查间隔、安静时段、每日上限、冷却小时数
2. **通知渠道**（可选）→ 选 `none` 则仅应用内消息，选 `email` / `wechat_work` 则需要配置相应凭据
3. **Prompt Editor** → 编辑 `proactive.system`，可用占位符：`{clock_time}` `{hours_since}` `{intimacy}` `{user_profile_snippet}`

**Email 通知需要额外环境变量**：
```env
EMAIL_API_KEY=re_xxx
EMAIL_FROM=ATRI <atri@your-domain.com>
```

> 📌 主动消息的上下文与主对话完全对齐（两天历史窗口），保证主动消息的语境连贯性。

### 🔊 12.3 SSE 流式输出

**现状**：聊天接口是一次性 JSON 返回。

**演进方向**：支持 SSE 流式输出，让回复可以逐字显示，提升用户体验。需要考虑工具循环中间结果的流式处理。

---

## 附录 A：最小"自检清单"（不等于部署）

> ✅ 你要验证系统"设计链路"是否通，最少看这三件事：

| # | 检查项 | 如何验证 |
|:-:|--------|----------|
| 1️⃣ | `/api/v1/chat` 能返回 `reply/status/intimacy` | 发一条消息，检查响应格式 |
| 2️⃣ | `/conversation/log` 写入后，`/conversation/last` 能查到日期 | 写入日志，查询确认 |
| 3️⃣ | `/diary/regenerate` 在当天有日志时能生成 `ready` 日记，并且后续 `search_memory` 能召回到那天 | 重生成日记，测试记忆检索 |

---

<div align="center">

---

**📖 相关文档**

[`README.md`](README.md) · [`shared/prompts.json`](shared/prompts.json) · [`server/src/services/db-bootstrap.ts`](server/src/services/db-bootstrap.ts)

---

<sub>Built with ❤️ for those who believe AI can be more than just a tool</sub>

</div>
