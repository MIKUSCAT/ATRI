<div align="center">

<img src="ATRI.png" alt="ATRI" width="280" />

<br/>

# ✨ ATRI - Emotionally Evolving AI Companion ✨

### 💕 Your personal AI who remembers, reflects, and grows alongside you 💕

<br/>

[![Android](https://img.shields.io/badge/Android-Kotlin%20%7C%20Jetpack%20Compose-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://developer.android.com/)
[![Backend](https://img.shields.io/badge/Backend-CF%20Workers%20%7C%20VPS-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](#-backend-deployment)
[![AI](https://img.shields.io/badge/AI-OpenAI%20%7C%20Claude%20%7C%20Gemini-412991?style=for-the-badge&logo=openai&logoColor=white)](#-architecture)
[![License](https://img.shields.io/badge/License-PolyForm%20NC-blue?style=for-the-badge)](LICENSE)

<br/>

[![Stars](https://img.shields.io/github/stars/MIKUSCAT/ATRI?style=social)](https://github.com/MIKUSCAT/ATRI)
[![Forks](https://img.shields.io/github/forks/MIKUSCAT/ATRI?style=social)](https://github.com/MIKUSCAT/ATRI/fork)
[![Issues](https://img.shields.io/github/issues/MIKUSCAT/ATRI)](https://github.com/MIKUSCAT/ATRI/issues)

<br/>

**🌐 Language: English | [简体中文](README-zh.md)**

<br/>

> *"An AI companion that remembers, grows, and maintains emotional continuity"*

<br/>

[🚀 Quick Start](#-quick-start) •
[✨ Features](#-key-features) •
[📸 Screenshots](#️-ui-preview) •
[📚 Documentation](#-learn-more)

<br/>

---

</div>

## 💭 What is ATRI?

**ATRI** is an **Android app + cloud backend** AI companion project. Unlike ordinary chatbots, she has:

<br/>

<div align="center">
<table>
<tr>
<td align="center" width="33%">
<br/>
<img src="https://img.icons8.com/fluency/96/smartphone-tablet.png" width="48"/>
<h3>📱 ATRI on Your Phone</h3>
<p>Chat with her anytime, anywhere<br/>Send images and documents</p>
<br/>
</td>
<td align="center" width="33%">
<br/>
<img src="https://img.icons8.com/fluency/96/book.png" width="48"/>
<h3>📔 Nightly Diary</h3>
<p>She records what happened today<br/>Written from her perspective</p>
<br/>
</td>
<td align="center" width="33%">
<br/>
<img src="https://img.icons8.com/fluency/96/brain.png" width="48"/>
<h3>🧠 Long-term Memory</h3>
<p>Diaries become "memories"<br/>Recalled in future conversations</p>
<br/>
</td>
</tr>
</table>
</div>

<br/>

### 🎯 What Makes It Different?

<div align="center">

| 🤖 Traditional Chatbots | 💖 ATRI's Approach |
|:----------------------:|:------------------:|
| Every conversation starts fresh | Remembers everything important via diary + vector memory + real-time facts |
| Emotions change instantly | Status capsule system + intimacy decay, moods have inertia |
| One-size-fits-all responses | Intimacy system affects speaking style, relationships grow |
| May fabricate memories | Tool registration mechanism with 8 tools, actively verifies via search/diary/web |

</div>

<br/>

---

## 🏗️ Architecture

<div align="center">

```
┌─────────────────────────────────────────────────────────────────┐
│                     📱 Android App (Kotlin)                     │
│              Jetpack Compose • Room • DataStore                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 🔐 HTTPS + Token Auth
                           ▼
    ┌──────────────────────┴──────────────────────┐
    │                                             │
    ▼                                             ▼
┌───────────────────────┐         ┌───────────────────────────────┐
│  ☁️ Cloudflare Workers │   OR    │   🖥️ VPS / Zeabur Server      │
│  D1 + R2 + Vectorize  │         │  Fastify + PostgreSQL/pgvector│
└───────────────────────┘         └───────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              🤖 AI Model Service (Native Multi-Format)          │
│     OpenAI • Claude • Gemini • DeepSeek • Local Models          │
│     (OpenAI / Anthropic / Gemini API format auto-adapt)         │
└─────────────────────────────────────────────────────────────────┘
```

</div>

<br/>

---

## 🚀 Quick Start

### 📦 Choose Your Backend

<div align="center">

| | Option | Best For | Features |
|:--:|:------:|:---------|:---------|
| ☁️ | **Cloudflare Workers** | Beginners, low cost | Serverless, free tier, simple setup |
| 🖥️ | **VPS / Zeabur** | Advanced users | Web admin panel, PostgreSQL, compat API, more control |

</div>

<br/>

---

## 🔧 Backend Deployment

### ✅ Option A: Zeabur One-Click Deploy (Recommended)

<div align="center">

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/VR6HBL)

</div>

<br/>

1. **Click** the button above
2. **Fill in** only **2 variables**:
   - `DOMAIN` - Public domain bound to the API service (must match the publicly exposed domain)
   - `PASSWORD` - Your password (used for admin login and client auth)

   > 💡 `PASSWORD` can be a strong password (special characters like `@ : / # ?` are safe)
   >
   > ⚠️ **Important**: `DOMAIN` must match the actual public domain, otherwise the admin panel may fail with CORS / `bad_origin`

3. **Wait** for deployment to complete
4. **Visit** your domain to access the admin panel
5. **Configure** upstream API (OpenAI/Claude/Gemini) in the admin panel

> 📝 **Note**: The Android client and web frontend use the same public API paths on both backends (Cloudflare Workers and VPS/Zeabur), so switching backends is just changing the base URL.

<br/>

### ☁️ Option B: Cloudflare Workers

<details>
<summary><b>🪟 Windows One-Click Deploy</b></summary>

<br/>

1. Double-click `scripts/deploy_cf.bat`
2. Follow the prompts to enter:
   - Worker name (press Enter for default)
   - D1 database name (press Enter for default)
   - R2 bucket name (press Enter for default)
   - Vectorize index name (press Enter for default)
   - **OPENAI_API_KEY** (required)
   - **EMBEDDINGS_API_KEY** (required for vector memory)
3. The script will automatically create resources and deploy
4. Copy the Worker URL when done

</details>

<details>
<summary><b>🍎 macOS / 🐧 Linux Manual Deploy</b></summary>

<br/>

```bash
# 1. Clone and install
git clone https://github.com/MIKUSCAT/ATRI.git
cd ATRI/worker && npm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Create resources
npx wrangler d1 create atri_diary
npx wrangler r2 bucket create atri-media
npx wrangler vectorize create atri-memories --dimensions=1024 --metric=cosine

# 4. Update wrangler.toml with database_id from step 3

# 5. Initialize and deploy
npx wrangler d1 execute atri_diary --file=db/schema.sql
npx wrangler secret put OPENAI_API_KEY
cd .. && python3 scripts/sync_shared.py
cd worker && npx wrangler deploy
```

</details>

<br/>

### 🐳 Option C: Docker Compose (Self-hosted VPS)

```bash
cd server
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

> 📖 See [server/README.md](server/README.md) for detailed VPS deployment guide.

<br/>

---

## 📲 Install the Android App

<div align="center">

| Step | Action |
|:----:|:-------|
| 1️⃣ | Download APK from [**Releases**](../../releases) |
| 2️⃣ | Install and open the app |
| 3️⃣ | Set your nickname on the welcome screen |
| 4️⃣ | Go to Settings (⚙️) and configure: **API URL**, **App Token**, **Model** |

</div>

<br/>

---

## ✨ Key Features

<div align="center">

<table>
<tr>
<td align="center" width="20%">
<br/>
🎭<br/><br/>
<b>In-Character</b><br/>
<sub>Authentic personality<br/>defined in prompts.json</sub>
<br/><br/>
</td>
<td align="center" width="20%">
<br/>
💬<br/><br/>
<b>Context Memory</b><br/>
<sub>Today + yesterday's chats<br/>inform responses</sub>
<br/><br/>
</td>
<td align="center" width="20%">
<br/>
📓<br/><br/>
<b>Auto Diary</b><br/>
<sub>Nightly reflections<br/>from her perspective</sub>
<br/><br/>
</td>
<td align="center" width="20%">
<br/>
🧠<br/><br/>
<b>Long-term Memory</b><br/>
<sub>Vector-stored memories<br/>+ real-time facts</sub>
<br/><br/>
</td>
<td align="center" width="20%">
<br/>
🖼️<br/><br/>
<b>Rich Media</b><br/>
<sub>Send images or docs<br/>she understands them</sub>
<br/><br/>
</td>
</tr>
</table>

</div>

<br/>

### 🔬 Technical Highlights

<div align="center">

| Feature | Description |
|:-------:|:------------|
| 🎨 **Status Capsule** | Dynamic mood status with label text + color, model-driven updates via `set_status` tool |
| 💕 **Intimacy System** | Relationship temperature affects reply style, fades without maintenance |
| 🔧 **8 Registered Tools** | `search_memory` `read_diary` `read_conversation` `web_search` `set_status` `update_intimacy` `remember_fact` `forget_fact` |
| 🌐 **Native Multi-Format** | Natively supports OpenAI, Anthropic (Claude), and Gemini API formats |
| 🔀 **Split Architecture** | Chat and diary can use different upstreams independently |
| 🌐 **Web Admin Panel** | (VPS) Runtime config, prompt editing, encrypted secrets management |
| 🔌 **Compat API** | (VPS) OpenAI / Anthropic / Gemini compatible endpoints for third-party clients |

</div>

<br/>

---

## 🖼️ UI Preview

<div align="center">

<table>
<tr>
<td align="center">
<img src="欢迎界面.jpg" width="200"/><br/>
<b>👋 Welcome</b>
</td>
<td align="center">
<img src="对话界面.jpg" width="200"/><br/>
<b>💬 Chat</b>
</td>
<td align="center">
<img src="侧边栏.jpg" width="200"/><br/>
<b>📋 Sidebar</b>
</td>
</tr>
<tr>
<td align="center">
<img src="日记界面.jpg" width="200"/><br/>
<b>📔 Diary</b>
</td>
<td align="center">
<img src="设置界面.jpg" width="200"/><br/>
<b>⚙️ Settings</b>
</td>
<td align="center">
</td>
</tr>
</table>

</div>

<br/>

---

## 📁 Project Structure

```
.
├── 📱 ATRI/                 # Android App (Kotlin / Jetpack Compose)
│   ├── app/src/main/
│   │   ├── java/me/atri/
│   │   │   ├── data/        # Data layer (API, DB, Repository, DataStore)
│   │   │   ├── di/          # Dependency Injection (Koin)
│   │   │   ├── ui/          # UI layer (Compose screens & components)
│   │   │   └── utils/       # Utilities
│   │   └── res/             # Resources
│   └── build.gradle.kts
│
├── ☁️ worker/               # Cloudflare Worker Backend
│   ├── src/
│   │   ├── routes/          # API routes
│   │   ├── services/        # Core services
│   │   └── utils/           # Utility functions
│   ├── db/schema.sql        # Database schema
│   └── wrangler.toml        # Worker config
│
├── 🖥️ server/               # VPS Backend (Fastify + PostgreSQL + pgvector)
│   ├── src/
│   │   ├── routes/          # API routes (chat, diary, conversation, media, admin, admin-ui, models, compat)
│   │   ├── services/        # Core services (agent, LLM, memory, diary, profile, runtime-settings)
│   │   ├── jobs/            # Scheduled jobs (diary-cron, diary-scheduler, memory-rebuild)
│   │   ├── runtime/         # Environment & types
│   │   ├── admin/           # Admin log buffer
│   │   ├── config/          # Default prompts
│   │   ├── utils/           # Utilities (auth, media-signature, attachments, sanitize)
│   │   └── scripts/         # Build & import scripts
│   ├── admin-ui/            # Web admin panel (static assets)
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── zeabur.yaml          # Zeabur deployment config
│
├── 🔗 shared/               # Shared Config
│   └── prompts.json         # Personality and prompts
│
└── 📜 scripts/              # Deployment Scripts
    ├── deploy_cf.bat        # Windows CF deploy
    └── sync_shared.py       # Sync prompts
```

<br/>

---

## 📚 Learn More

<div align="center">

| 📄 Document | 📝 Content |
|:------------|:-----------|
| [**🏛️ Tech Architecture Blueprint**](TECH_ARCHITECTURE_BLUEPRINT.md) | Design philosophy, data flow, API contracts |
| [**🚀 VPS Deployment Guide**](server/README.md) | Docker, Zeabur, 1Panel, Baota deployment |
| [**🎭 Personality Definition**](shared/prompts.json) | ATRI's personality and prompts |

</div>

<br/>

---

## 🤝 Contributing

<div align="center">

**Contributions are welcome!**

Feel free to open issues or submit pull requests.

<br/>

[![Contributors](https://img.shields.io/github/contributors/MIKUSCAT/ATRI?style=for-the-badge)](https://github.com/MIKUSCAT/ATRI/graphs/contributors)

</div>

<br/>

---

## 📄 License

<div align="center">

This project is licensed under the [**PolyForm Noncommercial License 1.0.0**](LICENSE).

</div>

- ✅ Personal learning, research, non-commercial use allowed
- ⚠️ Commercial use requires separate authorization

<br/>

---

<div align="center">

<br/>

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=MIKUSCAT/ATRI&type=Date)](https://star-history.com/#MIKUSCAT/ATRI&Date)

<br/>

---

<br/>

**🌟 If this project helps you, consider giving it a Star 🌟**

<br/>

<sub>💖 Built with love for those who believe AI can be more than just a tool 💖</sub>

<br/>

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=100&section=footer" width="100%"/>

</div>
