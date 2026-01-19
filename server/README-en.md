<div align="center">

# ATRI Server

### VPS Backend · Built-in Web Console · One-Click Deploy

[![Fastify](https://img.shields.io/badge/Fastify-4.x-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20+%20pgvector-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-PolyForm%20NC-blue?style=for-the-badge)](../LICENSE)

<br/>

**🌐 Language: English | [简体中文](README.md)**

<br/>

<!--
  Deploy on Zeabur button (replace link after publishing template)
  Generate: npx zeabur@latest template deploy -f zeabur.yaml
-->
[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates?q=atri)

<br/>

**Migrated from Cloudflare Workers, fully API-compatible, Android client works without modification**

[🚀 Quick Start](#-quick-start) •
[✨ Features](#-features) •
[🧩 Admin Console](#-admin-console-admin) •
[📚 Deployment Docs](#-deployment-docs)

<br/>

[← Back to Main Project](../README.md)

</div>

---

## 💡 What is This?

This is the **VPS deployment version** of the ATRI project backend. It provides the exact same API interface as the Cloudflare Workers version, but runs on your own server.

<table>
<tr>
<td align="center" width="33%">
<h3>🖥️ Self-Hosted</h3>
Runs on your own VPS<br/>
Full data ownership
</td>
<td align="center" width="33%">
<h3>🎛️ Web Console</h3>
Built-in /admin dashboard<br/>
Hot-reload config without restart
</td>
<td align="center" width="33%">
<h3>🔌 Multi-Upstream</h3>
OpenAI / Anthropic / Gemini<br/>
Switch AI providers freely
</td>
</tr>
</table>

### 🆚 Comparison with Cloudflare Workers

| Feature | Cloudflare Workers | VPS Server |
|---------|:------------------:|:----------:|
| Deployment Difficulty | ⭐ Easy | ⭐⭐ Medium |
| Running Cost | Free within quota | Requires server |
| Data Storage | D1 + R2 + Vectorize | PostgreSQL + pgvector |
| Web Console | ❌ | ✅ |
| Upstream Format | OpenAI-compatible only | OpenAI / Anthropic / Gemini |
| Customization | Limited by Workers env | Fully controllable |

---

## ✨ Features

<table>
<tr>
<td align="center" width="20%">
<h3>💬</h3>
<b>AI Chat</b><br/>
<sub>Streaming response<br/>Multi-model support</sub>
</td>
<td align="center" width="20%">
<h3>🧠</h3>
<b>Vector Memory</b><br/>
<sub>pgvector powered<br/>Semantic retrieval</sub>
</td>
<td align="center" width="20%">
<h3>📖</h3>
<b>Diary Generation</b><br/>
<sub>Daily auto-summary<br/>Manual trigger supported</sub>
</td>
<td align="center" width="20%">
<h3>🖼️</h3>
<b>Media Management</b><br/>
<sub>Image/doc upload<br/>Signed URL access</sub>
</td>
<td align="center" width="20%">
<h3>🔍</h3>
<b>Web Search</b><br/>
<sub>Tavily integration<br/>Optional feature</sub>
</td>
</tr>
</table>

---

## 🛠️ Tech Stack

| Component | Technology |
|:---------:|------------|
| Framework | Fastify 4.x |
| Language | TypeScript 5.x |
| Database | PostgreSQL 16 + pgvector |
| Container | Docker + Docker Compose |
| Runtime | Node.js 20 |

---

## 📖 Deployment Docs

Choose the deployment guide for your environment:

| Document | Scenario | Difficulty |
|:---------|:---------|:----------:|
| 📘 [**Zeabur Deploy**](ZEABUR_DEPLOYMENT.md) | Auto domain, instant console access | ⭐ |
| 📗 [**BaoTa Panel**](BAOTA_DEPLOYMENT.md) | Recommended for Chinese users | ⭐⭐ |
| 📙 [**1Panel Deploy**](1PANEL_DEPLOYMENT.md) | 1Panel users | ⭐⭐ |
| 📕 [**SSH Command Line**](DEPLOYMENT.md) | Linux-savvy users | ⭐⭐⭐ |

> **Having issues?** Check [FAQ](#-faq) or run the [diagnostic script](diagnose.sh)

---

## 🚀 Quick Start

### 📋 Prerequisites

| Requirement | Version |
|:-----------:|---------|
| Docker | 20.10+ |
| Docker Compose | v2.0+ |
| Memory | At least 1GB available |

### Step 1: Clone and Configure

```bash
# 1. Clone the project
git clone https://github.com/MIKUSCAT/ATRI.git
cd ATRI/server

# 2. Copy config file
cp .env.example .env

# 3. Edit configuration
nano .env  # or use your preferred editor
```

### Step 2: Start Services

```bash
# Start (background)
docker compose up -d --build

# Check status
docker compose ps

# Test health endpoint
curl http://localhost:3111/health
# Expected response: {"ok":true}
```

### Step 3: Configure Cron Job

Diary generation requires scheduled triggering:

```bash
# Edit crontab
crontab -e

# Add (runs daily at 23:59)
59 23 * * * cd /path/to/server && docker compose exec -T api npm run cron:diary >> /var/log/atri-cron.log 2>&1
```

---

## ⚙️ Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string (or use `POSTGRES_*`) | `postgres://atri:password@db:5432/atri` |
| `POSTGRES_HOST` | DB host (alternative to `DATABASE_URL`) | `db` |
| `POSTGRES_PORT` | DB port | `5432` |
| `POSTGRES_USER` | DB username | `atri` |
| `POSTGRES_PASSWORD` | DB password | `password` |
| `POSTGRES_DB` | DB name | `atri` |
| `OPENAI_API_URL` | Chat API URL (without /v1) | `https://api.openai.com` |
| `OPENAI_API_KEY` | Chat API key | `sk-xxx` |
| `EMBEDDINGS_API_URL` | Embeddings API URL | `https://api.siliconflow.cn/v1` |
| `EMBEDDINGS_API_KEY` | Embeddings API key | Get from SiliconFlow |
| `EMBEDDINGS_MODEL` | Embeddings model | `BAAI/bge-m3` |

### Optional

| Variable | Description | Default |
|----------|-------------|:-------:|
| `HOST` | Listen address | `0.0.0.0` |
| `PORT` | Listen port | `3111` |
| `APP_TOKEN` | Client auth token | - |
| `ADMIN_API_KEY` | Admin console login key | - |
| `ADMIN_CONFIG_ENCRYPTION_KEY` | Config encryption key | - |
| `ADMIN_PUBLIC` | Allow public admin access | `0` |
| `TAVILY_API_KEY` | Tavily search API | - |
| `DIARY_API_URL` | Diary generation API (independent config) | Same as `OPENAI_API_URL` |
| `DIARY_MODEL` | Diary generation model | - |

> ⚠️ **Security Note**: Never commit `.env` file to Git repository

---

## 🧩 Admin Console (/admin)

Built-in web console supporting hot-reload config, online prompt editing, and error log viewing.

<table>
<tr>
<td align="center" width="25%">
<h3>⚙️</h3>
<b>Runtime Config</b><br/>
<sub>Upstream API / Model<br/>Save to apply</sub>
</td>
<td align="center" width="25%">
<h3>📝</h3>
<b>Prompt Editor</b><br/>
<sub>Edit personality online<br/>No restart needed</sub>
</td>
<td align="center" width="25%">
<h3>📊</h3>
<b>Self-Check Tools</b><br/>
<sub>DB / API connectivity<br/>One-click diagnosis</sub>
</td>
<td align="center" width="25%">
<h3>📋</h3>
<b>Error Logs</b><br/>
<sub>Real-time log stream<br/>Application errors</sub>
</td>
</tr>
</table>

### How to Enable

1. Configure environment variables:
   ```env
   ADMIN_API_KEY=your-login-password
   ADMIN_CONFIG_ENCRYPTION_KEY=encryption-key (recommend: openssl rand -base64 32)
   ```

2. **Local Access** (recommended, more secure):
   ```bash
   # SSH tunnel
   ssh -L 3111:127.0.0.1:3111 user@your-server
   # Then visit http://localhost:3111/admin
   ```

3. **Public Access** (for Zeabur, etc.):
   ```env
   ADMIN_PUBLIC=1
   PUBLIC_BASE_URL=https://your-domain.com
   ADMIN_ALLOWED_ORIGINS=https://your-domain.com
   ```

### Access Restrictions

Default allowed source IPs:
- `127.0.0.1` / `::1` (localhost)
- `172.17.0.1` (Docker default gateway)

To add other IPs:
```env
ADMIN_ALLOWED_IPS=172.18.0.1,10.0.0.1
```

---

## 📡 API Endpoints

| Path | Method | Description |
|------|:------:|-------------|
| `/health` | GET | Health check |
| `/api/v1/chat` | POST | AI chat (streaming) |
| `/conversation/*` | - | Conversation history |
| `/diary/*` | - | Diary endpoints |
| `/upload` | POST | Media upload |
| `/media/*` | GET | Media file access |
| `/models` | GET | Available models list |
| `/admin/*` | - | Admin console |

### Authentication

```
# Client API calls
X-App-Token: <APP_TOKEN>

# Admin endpoints
Authorization: Bearer <ADMIN_API_KEY>
```

---

## 📦 Data Migration

### From Cloudflare D1

If you previously used Cloudflare Workers + D1:

```bash
# 1. Export SQLite file from Cloudflare Dashboard

# 2. Place file
mkdir -p data/import
cp your-database.sqlite data/import/

# 3. Run import
SQLITE_PATH=/data/import/your-database.sqlite docker compose exec -T api npm run import:d1
```

> ⚠️ Vectorize data cannot be directly migrated; the import script will regenerate vector embeddings

---

## 🔧 Development Guide

### Local Development

```bash
npm install        # Install dependencies
npm run dev        # Dev server (hot reload)
npm run typecheck  # Type checking
npm run build      # Production build
```

### Project Structure

```
server/
├── src/
│   ├── index.ts          # App entry
│   ├── app.ts            # Fastify config
│   ├── admin-ui/         # Admin console frontend
│   ├── config/           # Config files
│   ├── jobs/             # Scheduled jobs
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   └── utils/            # Utilities
├── db/
│   └── init.sql          # Database init
├── docker-compose.yml
├── Dockerfile
└── zeabur.yaml           # Zeabur template
```

### Database Tables

| Table | Description |
|-------|-------------|
| `conversation_logs` | Chat records |
| `user_states` | User emotional states |
| `diary_entries` | Diary entries |
| `user_settings` | User settings |
| `user_profiles` | User profiles |
| `memory_vectors` | Memory vectors (1024 dim) |

---

## ❓ FAQ

<details>
<summary><b>Database connection failed</b></summary>

Database connection supports two options:

1) `DATABASE_URL` (format)
```
postgres://username:password@host:port/database
```

2) `POSTGRES_*` (recommended; works even if your password contains special characters)
```env
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_USER=atri
POSTGRES_PASSWORD=your_password
POSTGRES_DB=atri
```

> If you use `DATABASE_URL` and your password contains characters like `@ : / # ?`, URL-encode it first; otherwise use `POSTGRES_*`.

</details>

<details>
<summary><b>Container exits immediately after start</b></summary>

```bash
docker compose logs api
```

Common causes: wrong env vars, port occupied, insufficient memory

</details>

<details>
<summary><b>Vector search not working</b></summary>

Make sure you're using `pgvector/pgvector:pg16` image, not regular postgres.

</details>

<details>
<summary><b>Admin console returns 404</b></summary>

1. Check if `ADMIN_API_KEY` is configured
2. Public access requires `ADMIN_PUBLIC=1`
3. Check if `ADMIN_ALLOWED_ORIGINS` includes your domain

</details>

<details>
<summary><b>How to update to new version</b></summary>

```bash
git pull
docker compose down
docker compose up -d --build
```

</details>

<details>
<summary><b>How to backup data</b></summary>

```bash
# Backup database
docker compose exec db pg_dump -U atri atri > backup.sql

# Backup media files
tar -czf media-backup.tar.gz data/media/
```

</details>

<details>
<summary><b>Vector dimensions explained</b></summary>

This project uses **1024-dimensional** vectors with `BAAI/bge-m3`. To change models, modify the dimension in `db/init.sql`.

| Model | Dimensions |
|-------|:----------:|
| `BAAI/bge-m3` | 1024 |
| `text-embedding-3-small` | 1536 |
| `text-embedding-3-large` | 3072 |

</details>

---

## 📄 License

This project is licensed under [PolyForm Noncommercial License 1.0.0](../LICENSE).

- ✅ Personal learning, research, non-commercial use
- ❌ Commercial use requires separate authorization

---

<div align="center">

<br/>

**[← Back to Main Project](../README.md)** · **[中文版 →](README.md)**

<br/>

<sub>Built with ❤️ by MIKUSCAT</sub>

</div>
