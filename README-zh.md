<div align="center">

# ATRI - 情感演化型 AI 陪伴

### 「高性能なロボットですから！」

[![Android](https://img.shields.io/badge/Android-Kotlin%20%7C%20Jetpack%20Compose-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://developer.android.com/)
[![Backend](https://img.shields.io/badge/Backend-CF%20Workers%20%7C%20VPS-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](#-后端部署)
[![AI](https://img.shields.io/badge/AI-OpenAI%20Compatible-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com/)
[![License](https://img.shields.io/badge/License-PolyForm%20NC-blue?style=for-the-badge)](LICENSE)

<br/>

**语言：简体中文 | [English](README.md)**

<br/>

<img src="ATRI.png" alt="ATRI" width="420" />

<br/>

**一个会记事、会成长、有情绪惯性的 AI 陪伴应用**

[快速上手](#-快速上手) •
[主要特点](#-主要特点) •
[界面预览](#️-界面预览) •
[进一步了解](#-进一步了解)

</div>

---

## 这是什么？

ATRI 是一个 **Android 应用 + 云端后端** 的 AI 陪伴项目。不同于普通的聊天机器人，她拥有：

<table>
<tr>
<td align="center" width="33%">
<h3>手机上的亚托莉</h3>
随时随地和她聊天<br/>
支持发送图片和文档
</td>
<td align="center" width="33%">
<h3>每晚的日记</h3>
她会记录今天发生的事<br/>
用第一人称写下感受
</td>
<td align="center" width="33%">
<h3>长期记忆</h3>
日记变成"回忆"<br/>
以后聊天时能想起来
</td>
</tr>
</table>

### 为什么与众不同？

| 传统聊天机器人 | ATRI 的做法 |
|----------------|-------------|
| 每次对话都是新开始 | 记住所有重要的事，通过日记和向量记忆 |
| 情绪说变就变 | PAD 三维情绪模型 + 自然衰减，情绪有惯性 |
| 千人一面的回复 | 亲密度系统影响说话风格，关系会成长 |
| 可能乱编记忆 | 工具注册机制，需要时主动查证，不靠感觉补全 |

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Android App (Kotlin)                        │
│              Jetpack Compose • Room • DataStore                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS + Token 鉴权
                           ▼
    ┌──────────────────────┴──────────────────────┐
    │                                             │
    ▼                                             ▼
┌───────────────────────┐         ┌───────────────────────────────┐
│  Cloudflare Workers   │   或    │      VPS / Zeabur 服务器       │
│  D1 + R2 + Vectorize  │         │  PostgreSQL + pgvector + Node │
└───────────────────────┘         └───────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AI 模型服务（可切换）                          │
│        OpenAI • Claude • Gemini • DeepSeek • 本地模型           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 快速上手

### 选择后端方案

| 方案 | 适合人群 | 特点 |
|:----:|----------|------|
| **Cloudflare Workers** | 新手、低成本 | 无服务器、有免费额度、部署简单 |
| **VPS / Zeabur** | 进阶用户 | 网页管理后台、PostgreSQL、更多控制 |

---

## 后端部署

### 方案 A：Zeabur 一键部署（推荐）

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/MIKUSCAT/ATRI?referralCode=MIKUSCAT)

1. 点击上方按钮
2. 只需填写 **2 个变量**：
   - `DOMAIN` - Zeabur 自动生成
   - `PASSWORD` - 你的密码（用于管理后台登录和客户端鉴权）

   > `PASSWORD` 可以放心用强密码（带 `@ : / # ?` 这类特殊字符也没问题）
3. 等待部署完成
4. 访问你的域名进入管理后台
5. 在后台配置上游 API（OpenAI/Claude/Gemini）

补充：Android 客户端和 Web 前端都不用改代码——Cloudflare Worker 版和 VPS/Zeabur 版对外 API 路径保持一致（比如 `/api/v1/chat`、`/upload`、`/diary`），你只需要在客户端把“后端地址”切到对应域名即可。

### 方案 B：Cloudflare Workers

<details>
<summary><b>Windows 一键部署</b></summary>

1. 双击运行 `scripts/deploy_cf.bat`
2. 按提示依次输入：
   - Worker 名字（直接回车用默认）
   - D1 数据库名字（直接回车用默认）
   - R2 存储桶名字（直接回车用默认）
   - Vectorize 索引名字（直接回车用默认）
   - **OPENAI_API_KEY**（必填）
   - **EMBEDDINGS_API_KEY**（向量记忆用，必填）
3. 脚本会自动创建资源、配置、部署
4. 完成后复制 Worker 地址

</details>

<details>
<summary><b>macOS / Linux 手动部署</b></summary>

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

# 4. 把第 3 步输出的 database_id 填入 wrangler.toml

# 5. 初始化并部署
npx wrangler d1 execute atri_diary --file=db/schema.sql
npx wrangler secret put OPENAI_API_KEY
cd .. && python3 scripts/sync_shared.py
cd worker && npx wrangler deploy
```

</details>

### 方案 C：Docker Compose（自托管 VPS）

```bash
cd server
cp .env.example .env
# 编辑 .env 填入配置
docker-compose up -d
```

详细 VPS 部署指南见 [server/README.md](server/README.md)。

---

## 安装 Android 客户端

1. 去 [**Releases**](../../releases) 下载 APK
2. 安装并打开应用
3. 在欢迎页设置你的昵称
4. 进入设置（齿轮图标）配置：
   - **API 地址**：你的后端地址
   - **App Token**：你设置的 APP_TOKEN
   - **模型**：根据上游 API 选择

---

## 主要特点

<table>
<tr>
<td align="center" width="20%">
<b>原作人格</b><br/>
<sub>完整复刻的人格与语气<br/>定义于 prompts.json</sub>
</td>
<td align="center" width="20%">
<b>上下文记忆</b><br/>
<sub>当天对话自动融入<br/>后续回复</sub>
</td>
<td align="center" width="20%">
<b>自动日记</b><br/>
<sub>每晚生成亚托莉<br/>视角的日记</sub>
</td>
<td align="center" width="20%">
<b>长期记忆</b><br/>
<sub>日记转化为向量记忆<br/>需要时自动唤醒</sub>
</td>
<td align="center" width="20%">
<b>多媒体支持</b><br/>
<sub>发送图片或文档<br/>一起查看理解</sub>
</td>
</tr>
</table>

### 技术亮点

| 特性 | 说明 |
|------|------|
| **PAD 情绪模型** | 三维情绪坐标（愉悦度/兴奋度/掌控度）+ 自然衰减 |
| **亲密度系统** | 关系温度影响回复风格，不维护会慢慢淡 |
| **工具注册机制** | 模型主动查证记忆，不靠感觉乱编 |
| **分流架构** | 聊天和日记可以用不同上游，互不影响 |
| **网页管理后台** | （仅 VPS）通过浏览器配置一切 |

---

## 界面预览

<table>
<tr>
<td align="center">
<img src="欢迎界面.jpg" width="200"/><br/>
<b>欢迎界面</b>
</td>
<td align="center">
<img src="对话界面.jpg" width="200"/><br/>
<b>对话界面</b>
</td>
<td align="center">
<img src="侧边栏.jpg" width="200"/><br/>
<b>侧边栏</b>
</td>
</tr>
<tr>
<td align="center">
<img src="日记界面.jpg" width="200"/><br/>
<b>日记界面</b>
</td>
<td align="center">
<img src="设置界面.jpg" width="200"/><br/>
<b>设置界面</b>
</td>
<td></td>
</tr>
</table>

---

## 项目结构

```
.
├── ATRI/                    # Android 应用
│   ├── app/src/main/
│   │   ├── java/me/atri/
│   │   │   ├── data/        # 数据层（API、DB、Repository）
│   │   │   ├── di/          # 依赖注入
│   │   │   ├── ui/          # UI 层（Compose）
│   │   │   └── utils/       # 工具类
│   │   └── res/             # 资源文件
│   └── build.gradle.kts
│
├── worker/                  # Cloudflare Worker 后端
│   ├── src/
│   │   ├── routes/          # API 路由
│   │   ├── services/        # 核心服务
│   │   └── utils/           # 工具函数
│   ├── db/schema.sql        # 数据库结构
│   └── wrangler.toml        # Worker 配置
│
├── server/                  # VPS 后端（Node.js + PostgreSQL）
│   ├── src/
│   │   ├── routes/          # API 路由
│   │   ├── services/        # 核心服务
│   │   └── admin-ui/        # 网页管理后台
│   ├── db/init.sql          # 数据库结构
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── zeabur.yaml          # Zeabur 部署配置
│
├── shared/                  # 共享配置
│   └── prompts.json         # 人格定义和提示词
│
└── scripts/                 # 部署脚本
    ├── deploy_cf.bat        # Windows CF 部署
    └── sync_shared.py       # 同步提示词
```

---

## 进一步了解

| 文档 | 内容 |
|:-----|:-----|
| [**技术架构蓝图**](TECH_ARCHITECTURE_BLUEPRINT.md) | 设计思路、数据流、API 契约 |
| [**VPS 部署指南**](server/README.md) | Docker、Zeabur、1Panel、宝塔部署 |
| [**人格定义**](shared/prompts.json) | 亚托莉的人格和提示词 |

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

## License

本项目使用 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权。

- 个人学习、研究、非商业使用允许
- 商业用途需要另行获得授权

---

<div align="center">

**如果这个项目对你有帮助，欢迎给一个 Star**

<sub>Built with love for those who believe AI can be more than just a tool</sub>

</div>
