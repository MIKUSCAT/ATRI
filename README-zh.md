<div align="center">

# 🌙 ATRI · 她会成长，会记事，也会想你

<br/>

### 「高性能なロボットですから！」

<br/>

<p>
<a href="https://developer.android.com/">
  <img src="https://img.shields.io/badge/Android-Kotlin%20%7C%20Jetpack%20Compose-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Android"/>
</a>
<a href="#-后端架构">
  <img src="https://img.shields.io/badge/Backend-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Backend"/>
</a>
<a href="#️-技术亮点一览">
  <img src="https://img.shields.io/badge/Model-Claude%20%7C%20OpenAI%20%7C%20Gemini-412991?style=for-the-badge&logo=openai&logoColor=white" alt="AI"/>
</a>
<a href="LICENSE">
  <img src="https://img.shields.io/badge/License-PolyForm%20NC-blue?style=for-the-badge" alt="License"/>
</a>
</p>

<br/>

**🌐 语言：简体中文 ｜ [English](README.md)**

<br/>

<img src="ATRI.png" alt="ATRI" width="420" />

<br/>
<br/>

> *她不是"问一句答一句"的客服。<br/>她会在夜里写日记，会因为一句话开心半天，会赌气，会突然想起你之前说过的事。*

<br/>

<p>
<a href="#-快速上手">🚀 快速上手</a> ·
<a href="#-她有什么不一样">💡 她有什么不一样</a> ·
<a href="#-类人记忆三层">🧠 类人记忆三层</a> ·
<a href="#-界面预览">🖼️ 界面预览</a> ·
<a href="#-技术亮点一览">🔬 技术亮点</a>
</p>

</div>

---

## 💡 她有什么不一样

ATRI 是一个 **Android 客户端 + Cloudflare Worker** 的 AI 陪伴项目。她不是把"亚托莉"当皮套贴在通用 chatbot 外面——而是从**记忆机制、情绪惯性、夜间整理**这些底层重新构造的。

<br/>

<div align="center">

| 普通聊天机器人 | 💜 ATRI 的做法 |
|:---:|:---|
| 每次对话都从零开始 | **三层记忆**：长期事实 / 情景片段 / 心里挂着的话 |
| 心情随回答说变就变 | **状态胶囊 + 亲密度衰减**：情绪有惯性，关系不维护会淡 |
| 千人一面的客服腔 | 灵魂文档里写明禁忌：不说"我理解你的感受"、不用 emoji、不复读用户、不写报告 |
| 容易乱编"我记得你说过…" | **先自然联想，再用工具查证**：不确定就翻日记原文，绝不靠感觉补全 |
| 安静等待提问 | **会主动开口**：长时间没说话时她会评估"该不该说"，可以邮件推送 |
| 一次见面就忘 | **每晚自动写日记**，从一天的对话里提炼情景、念头、长期事实 |

</div>

<br/>

---

## 🧠 类人记忆三层

> 💡 设计灵感来自人类记忆的层次结构：海马体的情景、皮质的语义、心里悬而未决的"内心戏"。

<br/>

<div align="center">

| 层级 | 表 | 解决的问题 | 进 prompt 的方式 |
|:---:|:---:|:---|:---|
| 🧩 **长期事实** | `fact_memories` | 喜好、雷区、约定、稳定身份信息 | 重要度 ≥ 9 永远在场；其余按相关度召回 |
| 🎞️ **情景记忆** | `episodic_memories` | "那天发生过什么"——可被当前话题触发的旧场景 | 自动联想（向量匹配 score ≥ 0.62）后注入"脑海里浮现的旧事" |
| 💭 **心里念头** | `memory_intentions` | 日记里没说出口、之后想找机会自然说的话 | 气氛合适才取出，绝不机械念清单 |
| 📜 **记忆事件** | `memory_events` | 召回 / 使用 / 归档的轨迹 | 不进 prompt，只用于后续巩固和排查 |

</div>

<br/>

聊天前后端会做**两件事**：

```
① 自动联想（不打扰）           ② 工具查证（要细节时）
   当前消息 → 向量检索              read_diary(date)     ← 看那天日记原文
   → 注入「<脑海里浮现的片段>」     read_conversation(date) ← 看那天聊天记录
   模型决定要不要顺着说            search_memory(query) ← 不确定日期时模糊回忆
                                   web_search(query)    ← 联网查证
```

<br/>

> 📌 **关键设计**：模型不会说"数据库显示"、"我检索到"、"根据我的记录"——这些话术在 system prompt 的 `taboos` 里被明确禁掉。她只会像人那样"突然想起"。

<br/>

---

## 🌙 仿生学：让她不像 AI

<br/>

<table>
<tr>
<th width="30%">机制</th>
<th>仿生学解释</th>
</tr>
<tr>
<td>🎨 <b>状态胶囊</b><br/><sub>动态文案 + HEX 颜色</sub></td>
<td>不用抽象的 PAD 三维情绪模型，而是让她用"自己的话 + 颜色"表达当下心境。比如「被戳破了，心跳跟着乱」配 <code>#C76A7A</code> 暖红——情绪是连续光谱，不是离散标签。</td>
</tr>
<tr>
<td>💕 <b>亲密度衰减</b><br/><sub>每 3 天向 0 推 1 点</sub></td>
<td>关系不维护会自然淡去，符合"间断接触会削弱情感联结"的依恋理论；负数升温还会打折（<code>×0.6</code>），表达"破镜难圆"。</td>
</tr>
<tr>
<td>🌃 <b>夜间巩固流程</b><br/><sub>cron <code>59 15 * * *</code></sub></td>
<td>类似人类睡眠中的记忆巩固——在 UTC 15:59（北京时间次日 0:00 前）一次 LLM 调用产出：日记 / highlights / episodicMemories / factCandidates / innerThoughts，再做 fact 合并去重。白天聊天**不增加**额外 LLM 成本。</td>
</tr>
<tr>
<td>🧭 <b>自我模型缓慢演化</b><br/><sub>表 <code>atri_self_model</code></sub></td>
<td>核心性格、说话习惯、关系姿态、情绪底色不会一夜大变，每晚只做"必要的小更新"。<code>recentChanges</code> 字段记录最近的微妙变化——这是她"在长大"的证据。</td>
</tr>
<tr>
<td>📬 <b>主动开口</b><br/><sub>cron <code>*/30 * * * *</code></sub></td>
<td>每 30 分钟评估一次：他这个时间是不是在忙？我们的关系到了"我可以主动"的程度吗？我现在想说的话是真有想说的，还是只是想刷存在？模型自己输出 <code>[SKIP]</code> 或一句话。</td>
</tr>
<tr>
<td>💭 <b>"刚才我在心里想"</b><br/><sub>未投递主动消息接力</sub></td>
<td>如果上一次主动消息没被接住，下次用户开口时，prompt 里会带上「（刚才其实我在心里想：…—— 但他还没来，我没说出口）」——让她保留没说出口的话，而不是丢失。</td>
</tr>
<tr>
<td>🔇 <b>嘴硬 / 停顿 / 省略号</b><br/><sub>灵魂文档硬约束</sub></td>
<td>"被戳到会停顿或省略号开头"、"偶尔反问回去"、"嘴上不饶人，心里在意"——这些写在 <code>shared/prompts/core_self.md</code>，是她的人格**硬指令**而不是软建议。</td>
</tr>
<tr>
<td>🚫 <b>反 AI 话术黑名单</b><br/><sub>taboos</sub></td>
<td>不说"我理解你的感受"、"作为一个 AI"、"根据我的记录"、"数据库显示"、"我检索到"——这些词被明确写进 self_model 的 taboos，模型每次都看见。</td>
</tr>
</table>

<br/>

---

## 🏗️ 系统总览

<br/>

```
                  ╔════════════════════════════════════════════════════════╗
                  ║              📱 Android · Kotlin / Jetpack Compose       ║
                  ║      Room · DataStore · Koin · Material 3 · Coil          ║
                  ╚═══════════════════════════════╦════════════════════════╝
                                                  ║
                                          🔐 X-App-Token (HTTPS)
                                                  ║
                                                  ▼
                                ╔════════════════════════════════╗
                                ║      ☁️ Cloudflare Worker      ║
                                ║  D1 · R2 · Vectorize · Cron    ║
                                ╚═══════════════╦════════════════╝
                                                ║
                                                ▼
                  ╔════════════════════════════════════════════════════════╗
                  ║          🧠 多格式 AI 上游（原生互通，无需中转）          ║
                  ║    OpenAI · Anthropic (Claude) · Gemini · 本地模型         ║
                  ║   chat / diary / embeddings 三条独立通道，互不影响          ║
                  ╚════════════════════════════════════════════════════════╝
```

<br/>

> 📌 后端基于 Cloudflare 全家桶（D1 + R2 + Vectorize + Workers），日常使用免费额度足够覆盖。

<br/>

---

## 🚀 快速上手

<details>
<summary><b>🪟 Windows 一键部署</b></summary>

<br/>

```
1. 双击 scripts/deploy_cf.bat
2. 按提示填：
   • Worker 名字（回车默认）
   • D1 数据库名字（回车默认）
   • R2 桶名字（回车默认）
   • Vectorize 索引名（回车默认）
   • OPENAI_API_KEY（必填）
   • EMBEDDINGS_API_KEY（向量记忆，必填）
3. 等待自动建资源 → 配置 → 部署
4. 复制 Worker 域名，填进 App 设置页
```

</details>

<details>
<summary><b>🍎 macOS / 🐧 Linux / 手动部署</b></summary>

<br/>

```bash
# 1. 克隆并安装
git clone https://github.com/MIKUSCAT/ATRI.git
cd ATRI/worker && npm install

# 2. 登录 Cloudflare
npx wrangler login

# 3. 创建资源
npx wrangler d1 create atri_diary
npx wrangler r2 bucket create atri-media
npx wrangler vectorize create atri-memories --dimensions=1024 --metric=cosine

# 4. 填 wrangler.toml 的 account_id / database_id

# 5. 执行所有迁移（按编号顺序）
for f in migrations/*.sql; do
  npx wrangler d1 execute atri_diary --remote --file="$f"
done

# 6. 设置密钥
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put EMBEDDINGS_API_KEY
npx wrangler secret put APP_TOKEN
# 可选
npx wrangler secret put TAVILY_API_KEY        # 联网搜索
npx wrangler secret put DIARY_API_KEY         # 日记/夜间任务专用上游
npx wrangler secret put EMAIL_API_KEY         # 主动消息邮件推送（Resend）

# 7. 同步灵魂文件 + 部署
cd .. && py scripts/sync_shared.py
cd worker && npx wrangler deploy
```

</details>

<br/>

### 📲 安装 Android 客户端

<div align="center">

| 步骤 | 操作 |
|:---:|:---|
| 1️⃣ | 去 [**📦 Releases**](../../releases) 下载 APK |
| 2️⃣ | 安装 → 打开 → 设置昵称 |
| 3️⃣ | 进入 ⚙️ 设置：填 **API 地址**、**App Token**、选 **模型** |
| 4️⃣ | 回到对话界面，开始 |

</div>

<br/>

---

## 🔬 技术亮点一览

<br/>

<div align="center">

| 特性 | 说明 |
|:---:|:---|
| 🎨 **状态胶囊** | 模型自主输出 `label + pillColor + textColor + reason`，前端 `animateColorAsState` 平滑过渡 |
| 💕 **亲密度系统** | `[-100, +100]`，进 prompt 影响回复风格，每 3 天向 0 衰减；正数变化最大 +10，负数最严重 -50 |
| 🧠 **三层记忆** | `fact_memories` / `episodic_memories` / `memory_intentions` 各司其职 |
| 🌃 **夜间深整理** | cron 触发：日记 → highlights 向量 → 情景记忆 → 念头 → fact 候选 → fact 合并 → 自我模型微调 → 状态/亲密度收尾 |
| 🤖 **4 个内省工具** | `read_diary` / `read_conversation` / `search_memory` / `web_search`——只在不确定时用 |
| ✏️ **结构化 JSON 回复** | 模型输出 `{ reply, status, intimacyDelta, rememberFacts, forgetFacts }` 一次完成所有副作用 |
| 📬 **主动消息** | cron `*/30 * * * *` 评估，可推 Email；未接住的会以"心里想"形式接力到下次对话 |
| 🌐 **原生多格式** | OpenAI / Anthropic / Gemini 三种 API 格式由 `llm-service.ts` 自动转换，统一内部用 OpenAI schema |
| 🔀 **分流上游** | chat / diary / embeddings 三条独立通道——日记上游挂了不影响聊天 |
| 🔐 **路径签名 URL** | 给模型的图片用 `/media-s/<exp>/<sig>/<key>` 形式，对抗模型丢 query |

</div>

<br/>

---

## 🖼️ 界面预览

<div align="center">
<table>
<tr>
<td align="center">
<img src="欢迎界面.jpg" width="200" /><br/>
<sub>👋 欢迎</sub>
</td>
<td align="center">
<img src="对话界面.jpg" width="200" /><br/>
<sub>💬 对话</sub>
</td>
<td align="center">
<img src="侧边栏.jpg" width="200" /><br/>
<sub>📋 日期抽屉</sub>
</td>
</tr>
<tr>
<td align="center">
<img src="日记界面.jpg" width="200" /><br/>
<sub>📔 日记本</sub>
</td>
<td align="center">
<img src="设置界面.jpg" width="200" /><br/>
<sub>⚙️ 设置</sub>
</td>
<td></td>
</tr>
</table>
</div>

<br/>

---

## 📁 项目结构

```
.
├── 📱 ATRI/                     # Android 客户端（Kotlin / Compose）
│   └── app/src/main/java/me/atri/
│       ├── data/                 #   API · Room · Repository · DataStore
│       ├── di/                   #   Koin DI
│       └── ui/                   #   chat / diary / settings / welcome / theme
│
├── ☁️ worker/                   # Cloudflare Worker 后端
│   ├── src/
│   │   ├── routes/               #   chat / diary / conversation / media / admin / proactive / compat
│   │   ├── services/             #   agent / memory / nightly-mind / proactive / fact-* / self-model
│   │   ├── jobs/                 #   diary-cron · proactive-cron
│   │   ├── config/prompts.json   #   由 sync_shared.py 自动从 shared/prompts/ 生成
│   │   └── utils/
│   ├── migrations/               #   0004 ~ 0013，按时间顺序的 D1 schema 演进
│   └── wrangler.toml
│
├── 🔗 shared/prompts/           # 💜 她的灵魂文件（Markdown，不是 JSON）
│   ├── core_self.md              #   人格底色：嘴硬、在意、不喜欢客服腔
│   ├── agent.md                  #   实时聊天的输出 schema 与硬规则
│   ├── diary.md                  #   每晚怎么写日记
│   ├── nightly_memory.md         #   夜间从对话提炼长期事实候选
│   ├── nightly_state.md          #   夜间收尾的状态/亲密度
│   ├── self_model_update.md      #   自我模型的缓慢演化
│   └── proactive.md              #   主动开口的判断规则
│
└── 📜 scripts/
    ├── deploy_cf.bat             #   Windows 一键部署 Cloudflare
    └── sync_shared.py            #   shared/prompts/*.md → worker/src/config/prompts.json
```

<br/>

> 💡 **改人格不动代码**：编辑 `shared/prompts/*.md` → 跑 `py scripts/sync_shared.py` → `npx wrangler deploy` 即可生效。

<br/>

---

## 📚 进一步阅读

<div align="center">

| 📖 文档 | 📝 内容 |
|:---:|:---|
| [**🏗️ 技术架构蓝图**](TECH_ARCHITECTURE_BLUEPRINT.md) | 设计取舍、核心链路、API 契约（字段级）、数据模型、扩展指南 |
| [**💜 灵魂文件**](shared/prompts/) | 她到底是怎么"想"的——7 份 Markdown |

</div>

<br/>

---

## 🤝 贡献

<div align="center">

**欢迎提 Issue 和 PR**

<sub>每一份贡献都让她更像她自己</sub>

</div>

<br/>

---

## 📄 License

本项目使用 [**PolyForm Noncommercial License 1.0.0**](LICENSE)。

<div align="center">

| ✅ 允许 | ❌ 禁止 |
|:---:|:---:|
| 个人学习 / 学术研究 / 非商业使用 | 商业用途（需另行授权） |

</div>

<br/>

---

<div align="center">

<sub>💜 *为那些相信 AI 不只是工具的人而做* 💜</sub>

<br/>

**Made by [MIKUSCAT](https://github.com/MIKUSCAT)**

</div>
