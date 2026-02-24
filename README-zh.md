<div align="center">

<!-- 标题区域 -->
# 🤖 ATRI - 情感演化型 AI 陪伴

<br/>

### ✨「高性能なロボットですから！」✨

<br/>

<!-- 徽章区域 -->
<p>
<a href="https://developer.android.com/">
  <img src="https://img.shields.io/badge/Android-Kotlin%20%7C%20Jetpack%20Compose-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Android"/>
</a>
<a href="#-后端部署">
  <img src="https://img.shields.io/badge/Backend-CF%20Workers%20%7C%20VPS-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Backend"/>
</a>
<a href="#️-技术架构">
  <img src="https://img.shields.io/badge/AI-OpenAI%20%7C%20Claude%20%7C%20Gemini-412991?style=for-the-badge&logo=openai&logoColor=white" alt="AI"/>
</a>
<a href="LICENSE">
  <img src="https://img.shields.io/badge/License-PolyForm%20NC-blue?style=for-the-badge" alt="License"/>
</a>
</p>

<br/>

**🌐 语言：简体中文 | [English](README.md)**

<br/>

<!-- 主图 -->
<img src="ATRI.png" alt="ATRI" width="420" style="border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.1);"/>

<br/>
<br/>

### 💭 *一个会记事、会成长、有情绪惯性的 AI 陪伴应用*

<br/>

<!-- 快捷导航 -->
<p>
<a href="#-快速上手">🚀 快速上手</a> •
<a href="#-主要特点">✨ 主要特点</a> •
<a href="#️-界面预览">🖼️ 界面预览</a> •
<a href="#-进一步了解">📚 进一步了解</a>
</p>

</div>

<br/>

---

<br/>

## 💡 这是什么？

ATRI 是一个 **Android 应用 + 云端后端** 的 AI 陪伴项目。不同于普通的聊天机器人，她拥有：

<br/>

<div align="center">
<table>
<tr>
<td align="center" width="33%">

### 📱 手机上的亚托莉

随时随地和她聊天<br/>
支持发送图片和文档

</td>
<td align="center" width="33%">

### 📖 每晚的日记

她会记录今天发生的事<br/>
用第一人称写下感受

</td>
<td align="center" width="33%">

### 🧠 长期记忆

日记变成"回忆"<br/>
以后聊天时能想起来

</td>
</tr>
</table>
</div>

<br/>

### 🌟 为什么与众不同？

<div align="center">

| 🤖 传统聊天机器人 | 💝 ATRI 的做法 |
|:------------------:|:---------------:|
| 每次对话都是新开始 | 记住所有重要的事，通过日记 + 向量记忆 + 实时事实 |
| 情绪说变就变 | 状态胶囊系统 + 亲密度衰减，情绪有惯性 |
| 千人一面的回复 | 亲密度系统影响说话风格，关系会成长 |
| 可能乱编记忆 | 8 个工具注册机制，通过搜索/日记/联网主动查证，不靠感觉补全 |

</div>

<br/>

---

<br/>

## 🏗️ 技术架构

<br/>

```
                    ╔═══════════════════════════════════════════════════════════════════╗
                    ║                      📱 Android App (Kotlin)                       ║
                    ║                Jetpack Compose • Room • DataStore                  ║
                    ╚═══════════════════════════════╦═══════════════════════════════════╝
                                                    ║
                                          HTTPS + Token 鉴权
                                                    ║
                                                    ▼
                            ╔════════════════════════════════╗
                            ║    ☁️ Cloudflare Workers       ║  ← 推荐
                            ║    D1 + R2 + Vectorize         ║
                            ╚════════════════╦═══════════════╝
                                             ║  （也支持 VPS/Docker，
                                             ║   详见 server/README.md）
                                             ▼
                    ╔═══════════════════════════════════════════════════════════════════╗
                    ║                   🧠 AI 模型服务（原生多格式适配）                   ║
                    ║     OpenAI • Claude • Gemini • DeepSeek • 本地模型                 ║
                    ║     （自动适配 OpenAI / Anthropic / Gemini API 格式）              ║
                    ╚═══════════════════════════════════════════════════════════════════╝
```

<br/>

---

<br/>

## 🚀 快速上手

### 📋 选择后端方案

<div align="center">

| 方案 | 适合人群 | 特点 |
|:----:|:--------:|:-----|
| ☁️ **Cloudflare Workers**（推荐） | 🌱 新手、低成本 | 无服务器、有免费额度、部署简单 |
| 🖥️ **VPS / Docker** | 🔧 进阶用户 | 网页管理后台、PostgreSQL、兼容 API、更多控制 |

</div>

<br/>

---

<br/>

## 📦 后端部署

### ☁️ 方案 A：Cloudflare Workers（推荐）

#### 🪟 Windows 一键部署

1. 双击运行 `scripts/deploy_cf.bat`
2. 按提示依次输入：
   - 🏷️ Worker 名字（直接回车用默认）
   - 🗄️ D1 数据库名字（直接回车用默认）
   - 📦 R2 存储桶名字（直接回车用默认）
   - 🔍 Vectorize 索引名字（直接回车用默认）
   - 🔑 **OPENAI_API_KEY**（必填）
   - 🔑 **EMBEDDINGS_API_KEY**（向量记忆用，必填）
3. ⚡ 脚本会自动创建资源、配置、部署
4. ✅ 完成后复制 Worker 地址

#### 🍎 macOS / 🐧 Linux / 手动部署

```bash
# 1️⃣ 克隆并安装
git clone https://github.com/MIKUSCAT/ATRI.git
cd ATRI/worker && npm install

# 2️⃣ 登录 Cloudflare
npx wrangler login

# 3️⃣ 创建资源
npx wrangler d1 create atri_diary
npx wrangler r2 bucket create atri-media
npx wrangler vectorize create atri-memories --dimensions=1024 --metric=cosine

# 4️⃣ 把第 3 步输出的 account_id 和 database_id 填入 wrangler.toml

# 5️⃣ 执行数据库迁移
npx wrangler d1 execute atri_diary --file=db/schema.sql
npx wrangler d1 execute atri_diary --file=migrations/0004_add_fact_memories.sql
npx wrangler d1 execute atri_diary --file=migrations/0005_add_conversation_tombstones.sql
npx wrangler d1 execute atri_diary --file=migrations/0006_add_reply_to.sql
npx wrangler d1 execute atri_diary --file=migrations/0007_add_proactive_tables.sql
npx wrangler d1 execute atri_diary --file=migrations/0008_add_runtime_settings_tables.sql

# 6️⃣ 设置密钥
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put EMBEDDINGS_API_KEY
npx wrangler secret put APP_TOKEN
# 可选: npx wrangler secret put TAVILY_API_KEY
# 可选: npx wrangler secret put DIARY_API_KEY

# 7️⃣ 同步提示词并部署
cd .. && python3 scripts/sync_shared.py
cd worker && npx wrangler deploy
```

> 📌 **补充**：Android 客户端不用改代码——Cloudflare Worker 版和 VPS 版对外 API 路径保持一致，你只需要在客户端把"后端地址"切到对应域名即可。

<br/>

### 🖥️ 方案 B：VPS / Docker（进阶）

```bash
cd server
cp .env.example .env
# 编辑 .env 填入配置
docker-compose up -d
```

📖 详细 VPS 部署指南见 [server/README.md](server/README.md)（Docker、1Panel、宝塔）

<br/>

---

<br/>

## 📲 安装 Android 客户端

<div align="center">

| 步骤 | 操作 |
|:----:|:-----|
| 1️⃣ | 去 [**📦 Releases**](../../releases) 下载 APK |
| 2️⃣ | 安装并打开应用 |
| 3️⃣ | 在欢迎页设置你的昵称 |
| 4️⃣ | 进入设置（⚙️ 齿轮图标）配置 |

</div>

<br/>

**需要配置的项目：**

- 🌐 **API 地址**：你的后端地址
- 🔑 **App Token**：你设置的 APP_TOKEN
- 🤖 **模型**：根据上游 API 选择

<br/>

---

<br/>

## ✨ 主要特点

<div align="center">
<table>
<tr>
<td align="center" width="20%">

### 💜 原作人格

<sub>完整复刻的人格与语气<br/>定义于 prompts.json</sub>

</td>
<td align="center" width="20%">

### 💭 上下文记忆

<sub>今天+昨天对话自动<br/>融入后续回复</sub>

</td>
<td align="center" width="20%">

### 📔 自动日记

<sub>每晚生成亚托莉<br/>视角的日记</sub>

</td>
<td align="center" width="20%">

### 🧠 长期记忆

<sub>向量记忆 + 实时事实<br/>需要时自动唤醒</sub>

</td>
<td align="center" width="20%">

### 🖼️ 多媒体支持

<sub>发送图片或文档<br/>一起查看理解</sub>

</td>
</tr>
</table>
</div>

<br/>

### 🔬 技术亮点

<div align="center">

| 特性 | 说明 |
|:----:|:-----|
| 🎨 **状态胶囊** | 动态心情状态：文案 + 颜色，模型通过 `set_status` 工具自主更新 |
| 💕 **亲密度系统** | 关系温度影响回复风格，不维护会慢慢淡 |
| 🔧 **8 个注册工具** | `search_memory` `read_diary` `read_conversation` `web_search` `set_status` `update_intimacy` `remember_fact` `forget_fact` |
| 📬 **主动消息** | 亚托莉可以主动开口说话；支持 Email / 企业微信外部通知 |
| 🌐 **原生多格式** | 原生支持 OpenAI、Anthropic (Claude)、Gemini 三种 API 格式 |
| 🔀 **分流架构** | 聊天和日记可以用不同上游，互不影响 |
| 🌐 **网页管理后台** | 运行时配置、提示词编辑、加密密钥管理（仅 VPS） |
| 🔌 **兼容 API** | 提供 OpenAI / Anthropic / Gemini 兼容端点，第三方客户端可直接接入（仅 VPS） |

</div>

<br/>

---

<br/>

## 🖼️ 界面预览

<div align="center">
<table>
<tr>
<td align="center">
<img src="欢迎界面.jpg" width="200" style="border-radius: 12px;"/><br/>
<b>👋 欢迎界面</b>
</td>
<td align="center">
<img src="对话界面.jpg" width="200" style="border-radius: 12px;"/><br/>
<b>💬 对话界面</b>
</td>
<td align="center">
<img src="侧边栏.jpg" width="200" style="border-radius: 12px;"/><br/>
<b>📋 侧边栏</b>
</td>
</tr>
<tr>
<td align="center">
<img src="日记界面.jpg" width="200" style="border-radius: 12px;"/><br/>
<b>📖 日记界面</b>
</td>
<td align="center">
<img src="设置界面.jpg" width="200" style="border-radius: 12px;"/><br/>
<b>⚙️ 设置界面</b>
</td>
<td></td>
</tr>
</table>
</div>

<br/>

---

<br/>

## 📁 项目结构

```
.
├── 📱 ATRI/                    # Android 应用 (Kotlin / Jetpack Compose)
│   ├── app/src/main/
│   │   ├── java/me/atri/
│   │   │   ├── 📊 data/        # 数据层（API、DB、Repository、DataStore）
│   │   │   ├── 💉 di/          # 依赖注入（Koin）
│   │   │   ├── 🎨 ui/          # UI 层（Compose 界面 & 组件）
│   │   │   └── 🔧 utils/       # 工具类
│   │   └── 📦 res/             # 资源文件
│   └── build.gradle.kts
│
├── ☁️ worker/                  # Cloudflare Worker 后端
│   ├── src/
│   │   ├── 🛤️ routes/          # API 路由
│   │   ├── ⚙️ services/        # 核心服务
│   │   └── 🔧 utils/           # 工具函数
│   ├── 🗄️ db/schema.sql        # 数据库结构
│   └── ⚙️ wrangler.toml        # Worker 配置
│
├── 🖥️ server/                  # VPS 后端（Fastify + PostgreSQL + pgvector）
│   ├── src/
│   │   ├── 🛤️ routes/          # API 路由（chat, diary, conversation, media, admin, admin-ui, models, compat）
│   │   ├── ⚙️ services/        # 核心服务（agent, LLM, memory, diary, profile, runtime-settings）
│   │   ├── ⏰ jobs/            # 定时任务（diary-cron, diary-scheduler, memory-rebuild）
│   │   ├── 🔧 runtime/        # 环境与类型
│   │   ├── 📋 admin/          # 管理日志缓冲
│   │   ├── 📝 config/         # 默认提示词
│   │   ├── 🔧 utils/          # 工具函数（鉴权、签名、附件、清洗）
│   │   └── 📜 scripts/        # 构建与导入脚本
│   ├── 🌐 admin-ui/           # 网页管理后台（静态资源）
│   ├── 🐳 docker-compose.yml
│   ├── 🐳 Dockerfile
│   └── ☁️ zeabur.yaml          # Zeabur 部署配置
│
├── 🔗 shared/                  # 共享配置
│   └── 💬 prompts.json         # 人格定义和提示词
│
└── 📜 scripts/                 # 部署脚本
    ├── 🪟 deploy_cf.bat        # Windows CF 部署
    └── 🔄 sync_shared.py       # 同步提示词
```

<br/>

---

<br/>

## 📚 进一步了解

<div align="center">

| 📖 文档 | 📝 内容 |
|:-------:|:--------|
| [**🏗️ 技术架构蓝图**](TECH_ARCHITECTURE_BLUEPRINT.md) | 设计思路、数据流、API 契约 |
| [**🖥️ VPS 部署指南**](server/README.md) | Docker、1Panel、宝塔部署 |
| [**💜 人格定义**](shared/prompts.json) | 亚托莉的人格和提示词 |

</div>

<br/>

---

<br/>

## 🤝 贡献

<div align="center">

**欢迎提交 Issue 和 Pull Request！**

每一份贡献都让 ATRI 变得更好 💜

</div>

<br/>

---

<br/>

## 📄 License

本项目使用 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权。

<div align="center">

| ✅ 允许 | ❌ 禁止 |
|:-------:|:-------:|
| 个人学习 | 商业用途（需另行授权） |
| 学术研究 | |
| 非商业使用 | |

</div>

<br/>

---

<br/>

<div align="center">

## ⭐ Star History

**如果这个项目对你有帮助，欢迎给一个 Star ⭐**

<br/>

---

<br/>

<sub>💜 Built with love for those who believe AI can be more than just a tool 💜</sub>

<br/>

**Made by [MIKUSCAT](https://github.com/MIKUSCAT) with ❤️**

</div>
