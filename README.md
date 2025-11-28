<div align="center">

# 🌊 ATRI - My Dear Moments

**一个温暖的AI陪伴系统 | Android + Cloudflare Edge**

![ATRI应用截图](ATRI-APP.jpg)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Android](https://img.shields.io/badge/Android-26%2B-green.svg)](https://developer.android.com)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com)

*「我是高性能哒！」*

</div>

---

## ✨ 项目简介

ATRI 是一套完整的**AI陪伴系统**，由 Android 客户端和 Cloudflare Worker 后端组成。她不仅能和你聊天，还能：

- 💬 **自然对话** - 支持文字、图片、文档等多模态交流
- 📔 **自动日记** - 每天自动生成日记，记录你们的点滴
- 🧠 **长期记忆** - 基于向量数据库的记忆系统，真正"记住"你
- 🎭 **情感成长** - 5个阶段的关系发展，从陌生到亲密
- 🔒 **隐私优先** - 所有数据由你掌控，部署在你的Cloudflare账户

---

## 🚀 快速开始

### 前置要求

- **Node.js** 18+
- **Python** 3.8+
- **Android Studio** (或 Gradle 7.0+)
- **Cloudflare 账户** (免费计划即可)

### 三步部署

#### 1️⃣ 配置 Cloudflare 资源

在 [Cloudflare Dashboard](https://dash.cloudflare.com) 中创建：

```bash
# 创建 D1 数据库（对话和日记存储）
wrangler d1 create atri-database

# 创建 Vectorize 索引（记忆向量，1536维，cosine）
wrangler vectorize create atri-memories --dimensions=1536 --metric=cosine

# 创建 R2 存储桶（附件存储）
wrangler r2 bucket create atri-media
```

将这些资源的 ID 填入 `worker/wrangler.toml`：

```toml
account_id = "your_account_id"

[[d1_databases]]
binding = "DB"
database_name = "atri-database"
database_id = "your_database_id"

[[vectorize]]
binding = "VECTORIZE"
index_name = "atri-memories"

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "atri-media"
```

然后初始化数据库：

```bash
cd worker
wrangler d1 execute atri-database --file=./db/schema.sql
```

#### 2️⃣ 部署 Worker 后端

```bash
cd worker
npm install

# 设置 API 密钥
wrangler secret put OPENAI_API_KEY
wrangler secret put EMBEDDINGS_API_KEY

# 部署
npm run deploy
```

成功后你会得到一个 Worker 地址，例如：`https://atri-worker.yourname.workers.dev`

> 💡 **提示**：你可以使用任何兼容 OpenAI API 的服务，包括国内的API中转服务

#### 3️⃣ 构建 Android 应用

```bash
cd ATRI
./gradlew assembleDebug
```

安装 APK 后：
1. 首次启动时输入你的昵称
2. 进入**设置页**填入 Worker 地址（必须是 HTTPS）
3. 开始聊天！

---

## 📁 项目架构

```
ATRI/
├── ATRI/                    # Android 客户端
│   ├── app/src/main/java/me/atri/
│   │   ├── ui/              # Compose UI (聊天/日记/设置)
│   │   ├── data/            # Room + Retrofit + Repository
│   │   ├── di/              # Koin 依赖注入
│   │   └── utils/           # SSE解析、附件处理
│   └── app/build.gradle.kts
│
├── worker/                  # Cloudflare Worker 后端
│   ├── src/
│   │   ├── index.ts         # 路由入口 + Cron
│   │   ├── routes/          # API 路由
│   │   ├── services/        # OpenAI调用、记忆管理
│   │   └── jobs/            # 自动日记任务
│   ├── db/schema.sql        # D1 数据库结构
│   └── wrangler.toml        # Cloudflare 配置
│
├── shared/
│   └── prompts.json         # AI人格配置（亚托莉）
│
└── scripts/
    └── sync_shared.py       # 提示词同步脚本
```

---

## 🎯 核心功能

### 💬 智能对话系统

- **多模态支持**：文字、图片、文档一起发送
- **流式响应**：实时显示AI的思考和回复过程
- **上下文记忆**：自动检索相关的历史记忆
- **情感感知**：根据对话历史调整语气和态度

### 📔 自动日记生成

每天 UTC 15:59（北京时间 23:59），Worker 会自动：

1. 汇总当天的所有对话
2. 生成完整的日记（正文、高光时刻、心情）
3. 提取长期记忆并存入向量数据库
4. 生成每日学习总结

### 🧠 三层记忆系统

| 类型 | 存储位置 | 作用 |
|-----|---------|------|
| **工作记忆** | 对话上下文 | 当天的聊天内容 |
| **短期记忆** | D1 数据库 | 最近几天的日记和学习记录 |
| **长期记忆** | Vectorize | 重要的偏好、关系、禁忌等 |

### 🎭 关系成长系统

从陌生到亲密，5个阶段：

1. **初识** - 礼貌的距离感
2. **熟悉** - 开始期待聊天
3. **亲近** - 可以说"想你"
4. **依赖** - 关心生活细节
5. **不可或缺** - 彼此的默契和承诺

---

## 🛠️ 技术栈

<table>
<tr>
<td width="50%">

### Android 客户端

- **UI**: Jetpack Compose + Material3
- **架构**: MVVM + Repository
- **数据**: Room + DataStore
- **网络**: Retrofit + OkHttp SSE
- **DI**: Koin
- **图片**: Coil

</td>
<td width="50%">

### Worker 后端

- **运行时**: Cloudflare Workers
- **框架**: TypeScript + itty-router
- **数据���**: D1 (SQLite)
- **向量**: Vectorize
- **存储**: R2
- **AI**: OpenAI API (兼容)

</td>
</tr>
</table>

---

## 📡 API 接口

| 方法 | 路径 | 功能 |
|------|------|------|
| `POST` | `/chat` | 主聊天接口（SSE流式） |
| `POST` | `/conversation/log` | 保存对话记录 |
| `GET` | `/conversation/last` | 查询上次聊天时间 |
| `GET` | `/diary` | 获取指定日期日记 |
| `GET` | `/diary/list` | 获取日记列表 |
| `POST` | `/upload` | 上传附件到R2 |
| `GET` | `/media/:key` | 读取附件 |
| `POST` | `/admin/clear-user` | 清除用户数据（需密钥） |

---

## ⚙️ 高级配置

### 自定义 AI 人格

编辑 `shared/prompts.json` 后运行：

```bash
python scripts/sync_shared.py
```

### 自定义模型

在 `wrangler.toml` 中修改：

```toml
[vars]
OPENAI_API_URL = "https://your-api-endpoint.com/v1"
EMBEDDINGS_MODEL = "text-embedding-3-small"
```

然后设置对应的 API 密钥：

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put EMBEDDINGS_API_KEY
```

### 本地开发

```bash
# Worker 本地调试（需要 --remote 访问云端资源）
cd worker && npm run dev -- --remote

# Android 模拟器连接本地 Worker
# 在应用设置中填入：http://10.0.2.2:8787
```

### 查看日志

```bash
# 实时查看 Worker 日志
cd worker && wrangler tail

# 查询 D1 数据
wrangler d1 execute atri-database --command "SELECT * FROM diary_entries LIMIT 5"
```

---

## 🔧 常见问题

<details>
<summary><b>日记页显示"暂无记录"？</b></summary>

日记由 Cron 自动生成，如果当天对话量不足会跳过。确保：
- Worker 的 Cron 已启用（`wrangler.toml` 中配置）
- 每天至少有几轮对话
- 等待到北京时间 23:59 之后

</details>

<details>
<summary><b>聊天没有回复或中断？</b></summary>

1. 检查 Worker 地址是否正确（必须 HTTPS）
2. 确认 API 密钥已正确设置
3. 查看 `wrangler tail` 日志排查错误
4. 弱网环境下减少附件数量

</details>

<details>
<summary><b>如何更换 AI 模型？</b></summary>

修改 `wrangler.toml` 中的默认模型，然后重新部署：

```toml
[vars]
DEFAULT_MODEL = "gpt-4o"
```

</details>

<details>
<summary><b>如何彻底删除用户数据？</b></summary>

1. 设置管理密钥：`wrangler secret put ADMIN_API_KEY`
2. 调用清理接口：
   ```bash
   curl -X POST https://your-worker.dev/admin/clear-user \
     -H "Authorization: Bearer YOUR_ADMIN_KEY" \
     -H "Content-Type: application/json" \
     -d '{"userId":"user-id-here"}'
   ```

</details>

---

## 📚 更多文档

- **[技术架构蓝图](./TECH_ARCHITECTURE_BLUEPRINT.md)** - 深入了解数据流和实现细节
- **[Cloudflare 配置指南](./worker/README.md)** - Worker 部署的详细说明
- **[Android 开发指南](./ATRI/README.md)** - 客户端架构和扩展

---

## 🛣️ 开发计划

- [ ] 支持语音消息
- [ ] 多设备数据同步
- [ ] Web 客户端
- [ ] 自定义主题
- [ ] 插件系统

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源。

---

## 🙏 致谢

- 灵感来源：ANIPLEX《ATRI -My Dear Moments-》
- 技术支持：Cloudflare、Anthropic Claude、OpenAI

---

<div align="center">

**如果这个项目对你有帮助，请给一个 ⭐ Star！**

Made with ❤️ by the ATRI community

</div>
