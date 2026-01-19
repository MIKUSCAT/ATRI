<div align="center">

# ATRI Server

### VPS 后端 · 自带网页控制台 · 一键部署

[![Fastify](https://img.shields.io/badge/Fastify-4.x-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20+%20pgvector-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-PolyForm%20NC-blue?style=for-the-badge)](../LICENSE)

<br/>

**🌐 Language: 简体中文 | [English](README-en.md)**

<br/>

<!--
  Zeabur 一键部署按钮（等模板发布后替换链接）
  生成方式：npx zeabur@latest template deploy -f zeabur.yaml
-->
[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates?q=atri)

<br/>

**从 Cloudflare Workers 迁移而来，接口完全兼容，Android 客户端无需修改**

[🚀 快速开始](#-快速开始) •
[✨ 功能特性](#-功能特性) •
[🧩 管理后台](#-管理后台admin) •
[📚 部署文档](#-部署文档)

<br/>

[← 返回主项目](../README-zh.md)

</div>

---

## 💡 这是什么？

这是 ATRI 项目的 **VPS 部署版本后端**，提供与 Cloudflare Workers 版本完全相同的 API 接口，但运行在你自己的服务器上。

<table>
<tr>
<td align="center" width="33%">
<h3>🖥️ 自托管</h3>
运行在你自己的 VPS<br/>
数据完全掌控
</td>
<td align="center" width="33%">
<h3>🎛️ 网页控制台</h3>
内置 /admin 管理后台<br/>
热更新配置无需重启
</td>
<td align="center" width="33%">
<h3>🔌 多上游支持</h3>
OpenAI / Anthropic / Gemini<br/>
自由切换 AI 服务商
</td>
</tr>
</table>

### 🆚 与 Cloudflare Workers 版本对比

| 特性 | Cloudflare Workers | VPS Server |
|------|:------------------:|:----------:|
| 部署难度 | ⭐ 简单 | ⭐⭐ 中等 |
| 运行成本 | 免费额度内零成本 | 需要服务器 |
| 数据存储 | D1 + R2 + Vectorize | PostgreSQL + pgvector |
| 网页控制台 | ❌ | ✅ |
| 上游格式 | 仅 OpenAI 兼容 | OpenAI / Anthropic / Gemini |
| 自定义程度 | 受限于 Workers 环境 | 完全可控 |

---

## ✨ 功能特性

<table>
<tr>
<td align="center" width="20%">
<h3>💬</h3>
<b>AI 对话</b><br/>
<sub>流式响应<br/>多模型支持</sub>
</td>
<td align="center" width="20%">
<h3>🧠</h3>
<b>向量记忆</b><br/>
<sub>pgvector 实现<br/>语义检索</sub>
</td>
<td align="center" width="20%">
<h3>📖</h3>
<b>日记生成</b><br/>
<sub>每日自动摘要<br/>支持手动触发</sub>
</td>
<td align="center" width="20%">
<h3>🖼️</h3>
<b>媒体管理</b><br/>
<sub>图片/文档上传<br/>签名访问控制</sub>
</td>
<td align="center" width="20%">
<h3>🔍</h3>
<b>联网搜索</b><br/>
<sub>Tavily 集成<br/>可选开启</sub>
</td>
</tr>
</table>

---

## 🛠️ 技术栈

| 组件 | 技术 |
|:----:|------|
| 框架 | Fastify 4.x |
| 语言 | TypeScript 5.x |
| 数据库 | PostgreSQL 16 + pgvector |
| 容器 | Docker + Docker Compose |
| 运行时 | Node.js 20 |

---

## 📖 部署文档

根据你的环境选择对应的部署指南：

| 文档 | 适用场景 | 难度 |
|:-----|:---------|:----:|
| 📘 [**Zeabur 部署**](ZEABUR_DEPLOYMENT.md) | 自动域名，点开直达控制台 | ⭐ |
| 📗 [**宝塔面板部署**](BAOTA_DEPLOYMENT.md) | 国内新手推荐，图文详解 | ⭐⭐ |
| 📙 [**1Panel 部署**](1PANEL_DEPLOYMENT.md) | 1Panel 用户 | ⭐⭐ |
| 📕 [**SSH 命令行部署**](DEPLOYMENT.md) | 熟悉 Linux 的用户 | ⭐⭐⭐ |

> **遇到问题？** 查看 [常见问题](#-常见问题) 或运行 [故障诊断脚本](diagnose.sh)

---

## 🚀 快速开始

### 📋 前置要求

| 需要 | 版本 |
|:----:|------|
| Docker | 20.10+ |
| Docker Compose | v2.0+ |
| 内存 | 至少 1GB 可用 |

### 一、克隆并配置

```bash
# 1. 克隆项目
git clone https://github.com/MIKUSCAT/ATRI.git
cd ATRI/server

# 2. 复制配置文件
cp .env.example .env

# 3. 编辑配置
nano .env  # 或用你喜欢的编辑器
```

### 二、启动服务

```bash
# 启动（后台运行）
docker compose up -d --build

# 检查状态
docker compose ps

# 测试健康检查
curl http://localhost:3111/health
# 预期响应：{"ok":true}
```

### 三、配置定时任务

日记生成需要定时触发：

```bash
# 编辑 crontab
crontab -e

# 添加（每天 23:59 执行）
59 23 * * * cd /path/to/server && docker compose exec -T api npm run cron:diary >> /var/log/atri-cron.log 2>&1
```

---

## ⚙️ 环境变量

### 必需配置

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串（和 `POSTGRES_*` 二选一） | `postgres://atri:password@db:5432/atri` |
| `POSTGRES_HOST` | 数据库主机（和 `DATABASE_URL` 二选一） | `db` |
| `POSTGRES_PORT` | 数据库端口 | `5432` |
| `POSTGRES_USER` | 数据库用户名 | `atri` |
| `POSTGRES_PASSWORD` | 数据库密码 | `password` |
| `POSTGRES_DB` | 数据库名 | `atri` |
| `OPENAI_API_URL` | 聊天 API 地址（不带 /v1） | `https://api.openai.com` |
| `OPENAI_API_KEY` | 聊天 API 密钥 | `sk-xxx` |
| `EMBEDDINGS_API_URL` | 嵌入向量 API 地址 | `https://api.siliconflow.cn/v1` |
| `EMBEDDINGS_API_KEY` | 嵌入向量 API 密钥 | 从 SiliconFlow 获取 |
| `EMBEDDINGS_MODEL` | 嵌入向量模型 | `BAAI/bge-m3` |

### 可选配置

| 变量名 | 说明 | 默认值 |
|--------|------|:------:|
| `HOST` | 监听地址 | `0.0.0.0` |
| `PORT` | 监听端口 | `3111` |
| `APP_TOKEN` | 客户端鉴权令牌 | - |
| `ADMIN_API_KEY` | 管理后台登录密钥 | - |
| `ADMIN_CONFIG_ENCRYPTION_KEY` | 配置加密密钥 | - |
| `ADMIN_PUBLIC` | 允许公网访问后台 | `0` |
| `TAVILY_API_KEY` | Tavily 搜索 API | - |
| `DIARY_API_URL` | 日记生成 API（可独立配置） | 同 `OPENAI_API_URL` |
| `DIARY_MODEL` | 日记生成模型 | - |

> ⚠️ **安全提示**：不要将 `.env` 文件提交到 Git 仓库

---

## 🧩 管理后台（/admin）

内置网页控制台，支持热更新配置、在线修改提示词、查看错误日志。

<table>
<tr>
<td align="center" width="25%">
<h3>⚙️</h3>
<b>运行时配置</b><br/>
<sub>上游 API / 模型<br/>保存即生效</sub>
</td>
<td align="center" width="25%">
<h3>📝</h3>
<b>提示词编辑</b><br/>
<sub>在线修改人格<br/>无需重启</sub>
</td>
<td align="center" width="25%">
<h3>📊</h3>
<b>自检工具</b><br/>
<sub>DB / API 连通性<br/>一键诊断</sub>
</td>
<td align="center" width="25%">
<h3>📋</h3>
<b>错误日志</b><br/>
<sub>实时日志流<br/>应用层错误</sub>
</td>
</tr>
</table>

### 启用方式

1. 配置环境变量：
   ```env
   ADMIN_API_KEY=你的登录密码
   ADMIN_CONFIG_ENCRYPTION_KEY=加密密钥（推荐 openssl rand -base64 32）
   ```

2. **本地访问**（推荐，更安全）：
   ```bash
   # SSH 隧道
   ssh -L 3111:127.0.0.1:3111 user@your-server
   # 然后访问 http://localhost:3111/admin
   ```

3. **公网访问**（Zeabur 等场景）：
   ```env
   ADMIN_PUBLIC=1
   PUBLIC_BASE_URL=https://your-domain.com
   ADMIN_ALLOWED_ORIGINS=https://your-domain.com
   ```

### 访问限制

默认只允许以下来源 IP：
- `127.0.0.1` / `::1`（本地）
- `172.17.0.1`（Docker 默认网关）

如需添加其他 IP：
```env
ADMIN_ALLOWED_IPS=172.18.0.1,10.0.0.1
```

---

## 📡 API 接口

| 路径 | 方法 | 说明 |
|------|:----:|------|
| `/health` | GET | 健康检查 |
| `/api/v1/chat` | POST | AI 对话（流式） |
| `/conversation/*` | - | 对话历史管理 |
| `/diary/*` | - | 日记相关接口 |
| `/upload` | POST | 媒体上传 |
| `/media/*` | GET | 媒体文件访问 |
| `/models` | GET | 可用模型列表 |
| `/admin/*` | - | 管理后台 |

### 认证方式

```
# 客户端 API 调用
X-App-Token: <APP_TOKEN>

# 管理接口
Authorization: Bearer <ADMIN_API_KEY>
```

---

## 📦 数据迁移

### 从 Cloudflare D1 迁移

如果你之前使用 Cloudflare Workers + D1：

```bash
# 1. 在 Cloudflare Dashboard 导出 SQLite 文件

# 2. 放置文件
mkdir -p data/import
cp your-database.sqlite data/import/

# 3. 执行导入
SQLITE_PATH=/data/import/your-database.sqlite docker compose exec -T api npm run import:d1
```

> ⚠️ Vectorize 的向量数据无法直接迁移，导入脚本会重新生成向量嵌入

---

## 🔧 开发指南

### 本地开发

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（热重载）
npm run typecheck  # 类型检查
npm run build      # 构建生产版本
```

### 项目结构

```
server/
├── src/
│   ├── index.ts          # 应用入口
│   ├── app.ts            # Fastify 配置
│   ├── admin-ui/         # 管理后台前端
│   ├── config/           # 配置文件
│   ├── jobs/             # 定时任务
│   ├── routes/           # API 路由
│   ├── services/         # 业务逻辑
│   └── utils/            # 工具函数
├── db/
│   └── init.sql          # 数据库初始化
├── docker-compose.yml
├── Dockerfile
└── zeabur.yaml           # Zeabur 模板
```

### 数据库表结构

| 表名 | 说明 |
|------|------|
| `conversation_logs` | 对话记录 |
| `user_states` | 用户情感状态 |
| `diary_entries` | 日记条目 |
| `user_settings` | 用户设置 |
| `user_profiles` | 用户画像 |
| `memory_vectors` | 记忆向量（1024 维） |

---

## ❓ 常见问题

<details>
<summary><b>数据库连接失败</b></summary>

数据库连接支持两种方式：

1）`DATABASE_URL`（格式如下）
```
postgres://用户名:密码@主机:端口/数据库名
```

2）`POSTGRES_*`（推荐，强密码带特殊字符也不怕）
```env
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_USER=atri
POSTGRES_PASSWORD=你的密码
POSTGRES_DB=atri
```

> 如果你用 `DATABASE_URL` 且密码里有 `@ : / # ?` 这类字符，记得先 URL 编码；不想折腾就用 `POSTGRES_*`。

</details>

<details>
<summary><b>容器启动后立即退出</b></summary>

```bash
docker compose logs api
```

常见原因：环境变量配置错误、端口被占用、内存不足

</details>

<details>
<summary><b>向量搜索不工作</b></summary>

确保使用 `pgvector/pgvector:pg16` 镜像，不是普通的 postgres 镜像。

</details>

<details>
<summary><b>后台打不开（404）</b></summary>

1. 检查 `ADMIN_API_KEY` 是否已配置
2. 公网访问需要设置 `ADMIN_PUBLIC=1`
3. 检查 `ADMIN_ALLOWED_ORIGINS` 是否包含你的域名

</details>

<details>
<summary><b>如何更新到新版本</b></summary>

```bash
git pull
docker compose down
docker compose up -d --build
```

</details>

<details>
<summary><b>如何备份数据</b></summary>

```bash
# 备份数据库
docker compose exec db pg_dump -U atri atri > backup.sql

# 备份媒体文件
tar -czf media-backup.tar.gz data/media/
```

</details>

<details>
<summary><b>向量维度说明</b></summary>

本项目使用 **1024 维**向量，配合 `BAAI/bge-m3`。更换模型需要修改 `db/init.sql` 中的维度定义。

| 模型 | 维度 |
|------|:----:|
| `BAAI/bge-m3` | 1024 |
| `text-embedding-3-small` | 1536 |
| `text-embedding-3-large` | 3072 |

</details>

---

## 📄 许可证

本项目使用 [PolyForm Noncommercial License 1.0.0](../LICENSE) 授权。

- ✅ 个人学习、研究、非商业使用
- ❌ 商业用途需要另行获得授权

---

<div align="center">

<br/>

**[← 返回主项目](../README-zh.md)** · **[English Version →](README-en.md)**

<br/>

<sub>Built with ❤️ by MIKUSCAT</sub>

</div>
