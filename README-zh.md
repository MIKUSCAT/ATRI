<div align="center">

# 🤖 ATRI - 情感演化型 AI 陪伴

### 「高性能なロボットですから！」

[![Android](https://img.shields.io/badge/Android-Kotlin%20%7C%20Jetpack%20Compose-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://developer.android.com/)
[![Cloudflare](https://img.shields.io/badge/Backend-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![AI](https://img.shields.io/badge/AI-OpenAI%20Compatible-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com/)
[![License](https://img.shields.io/badge/License-PolyForm%20NC-blue?style=for-the-badge)](LICENSE)

<br/>

**🌐 Language: 简体中文 | [English](README.md)**

<br/>

<img src="ATRI.png" alt="ATRI" width="420" />

<br/>

**一个会记事、会成长、有情绪惯性的 AI 陪伴应用**

[🚀 快速上手](#-快速上手) •
[✨ 主要特点](#-主要特点) •
[🖼️ 界面预览](#️-界面预览) •
[📚 进一步了解](#-进一步了解)

</div>

---

## 💡 这是什么？

ATRI 是一个 **Android 应用 + 云端后端** 的 AI 陪伴项目。不同于普通的聊天机器人，她拥有：

<table>
<tr>
<td align="center" width="33%">
<h3>📱 手机上的亚托莉</h3>
随时随地和她聊天<br/>
支持发送图片和文档
</td>
<td align="center" width="33%">
<h3>📔 每晚的日记</h3>
她会记录今天发生的事<br/>
用第一人称写下感受
</td>
<td align="center" width="33%">
<h3>🧠 长期记忆</h3>
日记变成"回忆"<br/>
以后聊天时能想起来
</td>
</tr>
</table>

### 🌟 为什么与众不同？

| 传统聊天机器人 | ATRI 的做法 |
|----------------|-------------|
| 每次对话都是新开始 | 📚 记住所有重要的事，通过日记和向量记忆 |
| 情绪说变就变 | 🎭 PAD 三维情绪模型 + 自然衰减，情绪有惯性 |
| 千人一面的回复 | 💕 亲密度系统影响说话风格，关系会成长 |
| 可能乱编记忆 | 🔍 工具注册机制，需要时主动查证，不靠感觉补全 |

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     📱 Android App (Kotlin)                      │
│              Jetpack Compose • Room • DataStore                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS + Token 鉴权
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│               ☁️ Cloudflare Worker (TypeScript)                  │
│    ┌─────────┐    ┌─────────┐    ┌─────────────────────┐        │
│    │   D1    │    │   R2    │    │     Vectorize       │        │
│    │  数据库  │    │ 对象存储 │    │     向量数据库       │        │
│    └─────────┘    └─────────┘    └─────────────────────┘        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ OpenAI 兼容接口
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   🤖 AI 模型服务（可切换）                        │
│        OpenAI • Claude • Gemini • DeepSeek • 本地模型            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 快速上手

### 📋 准备清单

| 需要 | 说明 |
|:----:|------|
| 💻 | 一台电脑（Windows / macOS / Linux） |
| ☁️ | [Cloudflare 账号](https://dash.cloudflare.com/sign-up)（免费） |
| 🔑 | OpenAI API Key 或其他兼容 API |
| 📦 | [Node.js 18+](https://nodejs.org/) |
| 🐍 | [Python 3.8+](https://www.python.org/downloads/) |

### 1️⃣ 部署后端

<details>
<summary><b>🪟 方式一：Windows 一键部署（推荐新手）</b></summary>

1. 双击运行 `scripts/deploy_cf.bat`
2. 按提示依次输入：
   - Worker 名字（直接回车用默认）
   - D1 数据库名字（直接回车用默认）
   - R2 存储桶名字（直接回车用默认）
   - Vectorize 索引名字（直接回车用默认）
   - **OPENAI_API_KEY**（必填）
   - 其他可选密钥（可跳过）
3. 脚本会自动创建资源、配置、部署
4. 完成后复制 Worker 地址

</details>

<details>
<summary><b>🍎 方式二：macOS / Linux 手动部署</b></summary>

```bash
# 1. 克隆项目
git clone https://github.com/你的用户名/ATRI.git
cd ATRI

# 2. 安装依赖
cd worker && npm install

# 3. 登录 Cloudflare
npx wrangler login

# 4. 创建 D1 数据库
npx wrangler d1 create atri_diary
# 复制输出的 database_id，填入 worker/wrangler.toml

# 5. 初始化数据库表
npx wrangler d1 execute atri_diary --file=db/schema.sql

# 6. 创建 R2 存储桶
npx wrangler r2 bucket create atri-media

# 7. 创建 Vectorize 索引
npx wrangler vectorize create atri-memories --dimensions=1024 --metric=cosine

# 8. 设置密钥
npx wrangler secret put OPENAI_API_KEY

# 9. 同步提示词并部署
cd .. && python3 scripts/sync_shared.py
cd worker && npx wrangler deploy
```

</details>

部署成功后会显示 Worker 地址，例如：
```
✨ https://atri-worker.你的子域名.workers.dev
```

#### 🔐 配置 Secrets

| 变量名 | 用途 | 必填 |
|--------|------|:----:|
| `OPENAI_API_KEY` | 聊天模型密钥 | ✅ |
| `EMBEDDINGS_API_KEY` | 向量/嵌入密钥（默认复用 `OPENAI_API_KEY`） | ❌ |
| `APP_TOKEN` | 客户端访问令牌，保护 API | 建议 |

### 2️⃣ 安装 Android 客户端

📥 去 [**Releases**](../../releases) 下载 APK

<details>
<summary><b>自己打签名 release 包（推荐）</b></summary>

1. 进入 `ATRI/`
2. 复制 `keystore.properties.example` -> `keystore.properties`（不要提交到 git）
3. 生成 keystore（Windows 示例）：
   - `keytool -genkeypair -v -keystore keystore\\atri-release.jks -alias atri -keyalg RSA -keysize 2048 -validity 10000`
4. 把密码填进 `ATRI/keystore.properties`
5. 开始打包：
   - `cd ATRI && .\\gradlew.bat :app:assembleRelease`

产物位置：`ATRI/app/build/outputs/apk/release/app-release.apk`

</details>

### 3️⃣ 首次配置

| 步骤 | 操作 |
|:----:|------|
| 1 | **欢迎页**：设置你的昵称和头像 |
| 2 | **设置页面**（点击右上角 ⚙️）：填写 Worker 地址和 App Token |
| 3 | **选择模型**：根据你的 API 选择合适的模型 |
| 4 | **开始聊天** ✨ |

---

## ⚠️ 常见问题

<details>
<summary><b>❓ 部署脚本报错 "未找到 node"</b></summary>

请先安装 Node.js 18+：https://nodejs.org/

</details>

<details>
<summary><b>❓ 部署脚本报错 "未找到 Python"</b></summary>

请先安装 Python 3.8+：https://www.python.org/downloads/

</details>

<details>
<summary><b>❓ wrangler login 打开浏览器后一直转圈</b></summary>

检查网络环境，可能需要科学上网。

</details>

<details>
<summary><b>❓ 聊天没有响应</b></summary>

1. 检查 Worker 地址是否正确填写
2. 检查 OPENAI_API_KEY 是否有效
3. 在 Cloudflare 后台查看 Worker 日志

</details>

<details>
<summary><b>❓ 日记没有生成</b></summary>

日记在每天 23:59（北京时间）自动生成，需要当天有对话记录。也可以在日记页面手动触发重新生成。

</details>

<details>
<summary><b>❓ 如何使用其他 AI 服务？</b></summary>

只要兼容 OpenAI API 格式即可：
1. 修改 `worker/wrangler.toml` 里的 `OPENAI_API_URL`
2. 可选：配置独立的 `DIARY_API_URL` / `DIARY_MODEL`（日记生成可以用不同的模型）
3. 向量/嵌入（长期记忆）：默认用 `https://api.siliconflow.cn/v1` + `BAAI/bge-m3`
   - 设置 `EMBEDDINGS_API_KEY`（不配就复用 `OPENAI_API_KEY`）
   - 可选：覆盖 `EMBEDDINGS_API_URL` / `EMBEDDINGS_MODEL`
4. 重新部署：`cd worker && npx wrangler deploy`

</details>

---

## ✨ 主要特点

<table>
<tr>
<td align="center" width="20%">
<h3>🎭</h3>
<b>原作人格</b><br/>
<sub>完整复刻的人格与语气<br/>定义于 prompts.json</sub>
</td>
<td align="center" width="20%">
<h3>💬</h3>
<b>上下文记忆</b><br/>
<sub>当天对话自动融入<br/>后续回复</sub>
</td>
<td align="center" width="20%">
<h3>📖</h3>
<b>自动日记</b><br/>
<sub>每晚生成亚托莉<br/>视角的日记</sub>
</td>
<td align="center" width="20%">
<h3>🧠</h3>
<b>长期记忆</b><br/>
<sub>日记转化为向量记忆<br/>需要时自动唤醒</sub>
</td>
<td align="center" width="20%">
<h3>🖼️</h3>
<b>多媒体支持</b><br/>
<sub>发送图片或文档<br/>一起查看理解</sub>
</td>
</tr>
</table>

### 🔬 技术亮点

| 特性 | 说明 |
|------|------|
| **PAD 情绪模型** | 三维情绪坐标（愉悦度/兴奋度/掌控度）+ 自然衰减 |
| **亲密度系统** | 关系温度影响回复风格，不维护会慢慢淡 |
| **工具注册机制** | 模型主动查证记忆，不靠感觉乱编 |
| **分流架构** | 聊天和日记可以用不同上游，互不影响 |
| **签名访问控制** | 路径签名解决模型丢 query 的问题 |

---

## 🖼️ 界面预览

<table>
<tr>
<td align="center">
<img src="欢迎界面.jpg" width="200"/><br/>
<b>欢迎界面</b><br/>
<sub>设置昵称和头像</sub>
</td>
<td align="center">
<img src="对话界面.jpg" width="200"/><br/>
<b>对话界面</b><br/>
<sub>沉浸式聊天体验</sub>
</td>
<td align="center">
<img src="侧边栏.jpg" width="200"/><br/>
<b>侧边栏</b><br/>
<sub>状态与快捷入口</sub>
</td>
</tr>
<tr>
<td align="center">
<img src="日记界面.jpg" width="200"/><br/>
<b>日记界面</b><br/>
<sub>查看亚托莉的日记</sub>
</td>
<td align="center">
<img src="设置界面.jpg" width="200"/><br/>
<b>设置界面</b><br/>
<sub>配置后端和模型</sub>
</td>
<td></td>
</tr>
</table>

---

## 📁 项目结构

```
.
├── ATRI/                    # 📱 Android 应用
│   ├── app/src/main/
│   │   ├── java/me/atri/
│   │   │   ├── data/        # 数据层（API、DB、Repository）
│   │   │   ├── di/          # 依赖注入（Hilt）
│   │   │   ├── ui/          # UI 层（Compose）
│   │   │   └── utils/       # 工具类
│   │   └── res/             # 资源文件
│   └── build.gradle.kts
│
├── worker/                  # ☁️ Cloudflare Worker
│   ├── src/
│   │   ├── routes/          # API 路由
│   │   ├── services/        # 核心服务
│   │   ├── jobs/            # 定时任务
│   │   └── utils/           # 工具函数
│   ├── db/schema.sql        # 数据库结构
│   └── wrangler.toml        # Worker 配置
│
├── shared/                  # 📝 共享配置
│   └── prompts.json         # 人格定义和提示词
│
└── scripts/                 # 🔧 部署脚本
    ├── deploy_cf.bat        # Windows 一键部署
    └── sync_shared.py       # 同步提示词
```

---

## 📚 进一步了解

| 文档 | 内容 |
|:-----|:-----|
| 📘 [**技术架构蓝图**](TECH_ARCHITECTURE_BLUEPRINT.md) | 设计思路、数据流、API 契约、扩展指南 |
| 📝 [**人格定义**](shared/prompts.json) | 亚托莉的人格、日记生成、记忆系统提示词 |
| 🗄️ [**数据库结构**](worker/db/schema.sql) | D1 数据库表结构定义 |

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

在贡献代码前，建议先阅读 [技术架构蓝图](TECH_ARCHITECTURE_BLUEPRINT.md) 了解系统设计。

---

## 📄 License

本项目使用 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权。

**简单来说**：
- ✅ 个人学习、研究、非商业使用
- ❌ 商业用途需要另行获得授权

---

<div align="center">

<br/>

**如果这个项目对你有帮助，欢迎给一个 ⭐**

<br/>

<sub>Built with ❤️ for those who believe AI can be more than just a tool</sub>

</div>
