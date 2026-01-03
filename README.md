<div align="center">

# 🤖 ATRI - Emotionally Evolving AI Companion

### Your personal AI who remembers, reflects, and grows alongside you

[![Android](https://img.shields.io/badge/Android-Kotlin%20%7C%20Jetpack%20Compose-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://developer.android.com/)
[![Cloudflare](https://img.shields.io/badge/Backend-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![AI](https://img.shields.io/badge/AI-OpenAI%20Compatible-412991?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com/)
[![License](https://img.shields.io/badge/License-PolyForm%20NC-blue?style=for-the-badge)](LICENSE)

<br/>

**🌐 Language: English | [简体中文](README-zh.md)**

<br/>

<img src="ATRI.png" alt="ATRI" width="420" />

<br/>

**An AI companion that remembers, grows, and maintains emotional continuity**

[🚀 Quick Start](#-quick-start) •
[✨ Features](#-key-features) •
[🖼️ Screenshots](#️-ui-preview) •
[📚 Documentation](#-learn-more)

</div>

---

## 💡 What is ATRI?

ATRI is an **Android app + cloud backend** AI companion project. Unlike ordinary chatbots, she has:

<table>
<tr>
<td align="center" width="33%">
<h3>📱 ATRI on Your Phone</h3>
Chat with her anytime, anywhere<br/>
Send images and documents
</td>
<td align="center" width="33%">
<h3>📔 Nightly Diary</h3>
She records what happened today<br/>
Written from her perspective
</td>
<td align="center" width="33%">
<h3>🧠 Long-term Memory</h3>
Diaries become "memories"<br/>
Recalled in future conversations
</td>
</tr>
</table>

### 🌟 What Makes It Different?

| Traditional Chatbots | ATRI's Approach |
|----------------------|-----------------|
| Every conversation starts fresh | 📚 Remembers everything important via diary + vector memory |
| Emotions change instantly | 🎭 PAD 3D emotion model + natural decay, emotions have inertia |
| One-size-fits-all responses | 💕 Intimacy system affects speaking style, relationships grow |
| May fabricate memories | 🔍 Tool registration mechanism, actively verifies when needed |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     📱 Android App (Kotlin)                      │
│              Jetpack Compose • Room • DataStore                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS + Token Auth
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│               ☁️ Cloudflare Worker (TypeScript)                  │
│    ┌─────────┐    ┌─────────┐    ┌─────────────────────┐        │
│    │   D1    │    │   R2    │    │     Vectorize       │        │
│    │Database │    │ Storage │    │   Vector Database   │        │
│    └─────────┘    └─────────┘    └─────────────────────┘        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ OpenAI-Compatible API
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   🤖 AI Model Service (Swappable)                │
│        OpenAI • Claude • Gemini • DeepSeek • Local Models        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 📋 Prerequisites

| Requirement | Description |
|:-----------:|-------------|
| 💻 | Computer (Windows / macOS / Linux) |
| ☁️ | [Cloudflare account](https://dash.cloudflare.com/sign-up) (free) |
| 🔑 | OpenAI API Key or compatible API |
| 📦 | [Node.js 18+](https://nodejs.org/) |
| 🐍 | [Python 3.8+](https://www.python.org/downloads/) |

### 1️⃣ Deploy the Backend

<details>
<summary><b>🪟 Option A: Windows One-Click Deploy (Recommended for beginners)</b></summary>

1. Double-click `scripts/deploy_cf.bat`
2. Follow the prompts to enter:
   - Worker name (press Enter for default)
   - D1 database name (press Enter for default)
   - R2 bucket name (press Enter for default)
   - Vectorize index name (press Enter for default)
   - **OPENAI_API_KEY** (required)
   - Other optional secrets (can skip)
3. The script will automatically create resources and deploy
4. Copy the Worker URL when done

</details>

<details>
<summary><b>🍎 Option B: macOS / Linux Manual Deploy</b></summary>

```bash
# 1. Clone the project
git clone https://github.com/your-username/ATRI.git
cd ATRI

# 2. Install dependencies
cd worker && npm install

# 3. Login to Cloudflare
npx wrangler login

# 4. Create D1 database
npx wrangler d1 create atri_diary
# Copy the database_id from output and paste into worker/wrangler.toml

# 5. Initialize database tables
npx wrangler d1 execute atri_diary --file=db/schema.sql

# 6. Create R2 bucket
npx wrangler r2 bucket create atri-media

# 7. Create Vectorize index
npx wrangler vectorize create atri-memories --dimensions=1024 --metric=cosine

# 8. Set secrets
npx wrangler secret put OPENAI_API_KEY

# 9. Sync prompts and deploy
cd .. && python3 scripts/sync_shared.py
cd worker && npx wrangler deploy
```

</details>

After successful deployment, you'll see the Worker URL:
```
✨ https://atri-worker.your-subdomain.workers.dev
```

#### 🔐 Configure Secrets

| Secret | Description | Required |
|--------|-------------|:--------:|
| `OPENAI_API_KEY` | Chat model API key | ✅ |
| `EMBEDDINGS_API_KEY` | Embeddings API key (defaults to `OPENAI_API_KEY`) | ❌ |
| `APP_TOKEN` | Client access token to protect API | Recommended |

### 2️⃣ Install the Android App

📥 Download APK from [**Releases**](../../releases)

<details>
<summary><b>Build a signed release APK (recommended)</b></summary>

1. Go to `ATRI/`
2. Copy `keystore.properties.example` -> `keystore.properties` (do not commit it)
3. Generate a keystore (Windows example):
   - `keytool -genkeypair -v -keystore keystore\\atri-release.jks -alias atri -keyalg RSA -keysize 2048 -validity 10000`
4. Fill passwords in `ATRI/keystore.properties`
5. Build:
   - `cd ATRI && .\\gradlew.bat :app:assembleRelease`

Output: `ATRI/app/build/outputs/apk/release/app-release.apk`

</details>

### 3️⃣ Initial Setup

| Step | Action |
|:----:|--------|
| 1 | **Welcome Screen**: Set your nickname and avatar |
| 2 | **Settings** (tap ⚙️ icon): Enter Worker URL and App Token |
| 3 | **Select Model**: Choose a model based on your API |
| 4 | **Start Chatting** ✨ |

---

## ⚠️ Troubleshooting

<details>
<summary><b>❓ Deploy script says "node not found"</b></summary>

Install Node.js 18+: https://nodejs.org/

</details>

<details>
<summary><b>❓ Deploy script says "Python not found"</b></summary>

Install Python 3.8+: https://www.python.org/downloads/

</details>

<details>
<summary><b>❓ wrangler login keeps spinning</b></summary>

Check your network connection. You may need a VPN in some regions.

</details>

<details>
<summary><b>❓ Chat not responding</b></summary>

1. Verify Worker URL is correct
2. Check if OPENAI_API_KEY is valid
3. Check Worker logs in Cloudflare dashboard

</details>

<details>
<summary><b>❓ Diary not generating</b></summary>

Diaries are generated daily at 23:59 Beijing time. There must be conversation records for that day. You can also manually trigger regeneration on the diary page.

</details>

<details>
<summary><b>❓ How to use other AI services?</b></summary>

Any OpenAI-compatible API works:
1. Edit `OPENAI_API_URL` in `worker/wrangler.toml`
2. Optional: Configure separate `DIARY_API_URL` / `DIARY_MODEL` (diary generation can use a different model)
3. Embeddings (vector memory): by default it's `https://api.siliconflow.cn/v1` + `BAAI/bge-m3`
   - Set `EMBEDDINGS_API_KEY` (or reuse `OPENAI_API_KEY`)
   - Optional: override `EMBEDDINGS_API_URL` / `EMBEDDINGS_MODEL`
4. Redeploy: `cd worker && npx wrangler deploy`

</details>

---

## ✨ Key Features

<table>
<tr>
<td align="center" width="20%">
<h3>🎭</h3>
<b>In-Character</b><br/>
<sub>Authentic personality<br/>defined in prompts.json</sub>
</td>
<td align="center" width="20%">
<h3>💬</h3>
<b>Context Memory</b><br/>
<sub>Today's conversations<br/>inform responses</sub>
</td>
<td align="center" width="20%">
<h3>📖</h3>
<b>Auto Diary</b><br/>
<sub>Nightly reflections<br/>from her perspective</sub>
</td>
<td align="center" width="20%">
<h3>🧠</h3>
<b>Long-term Memory</b><br/>
<sub>Vector-stored memories<br/>awakened when needed</sub>
</td>
<td align="center" width="20%">
<h3>🖼️</h3>
<b>Rich Media</b><br/>
<sub>Send images or docs<br/>she understands them</sub>
</td>
</tr>
</table>

### 🔬 Technical Highlights

| Feature | Description |
|---------|-------------|
| **PAD Emotion Model** | 3D emotion coordinates (Pleasure/Arousal/Dominance) + natural decay |
| **Intimacy System** | Relationship temperature affects reply style, fades without maintenance |
| **Tool Registration** | Model actively verifies memories, doesn't fabricate |
| **Split Architecture** | Chat and diary can use different upstreams independently |
| **Signed Access Control** | Path-based signatures solve model dropping query params |

---

## 🖼️ UI Preview

<table>
<tr>
<td align="center">
<img src="欢迎界面.jpg" width="200"/><br/>
<b>Welcome</b><br/>
<sub>Set nickname and avatar</sub>
</td>
<td align="center">
<img src="对话界面.jpg" width="200"/><br/>
<b>Chat</b><br/>
<sub>Immersive chat experience</sub>
</td>
<td align="center">
<img src="侧边栏.jpg" width="200"/><br/>
<b>Sidebar</b><br/>
<sub>Status and quick actions</sub>
</td>
</tr>
<tr>
<td align="center">
<img src="日记界面.jpg" width="200"/><br/>
<b>Diary</b><br/>
<sub>View ATRI's diary entries</sub>
</td>
<td align="center">
<img src="设置界面.jpg" width="200"/><br/>
<b>Settings</b><br/>
<sub>Configure backend and model</sub>
</td>
<td></td>
</tr>
</table>

---

## 📁 Project Structure

```
.
├── ATRI/                    # 📱 Android App
│   ├── app/src/main/
│   │   ├── java/me/atri/
│   │   │   ├── data/        # Data layer (API, DB, Repository)
│   │   │   ├── di/          # Dependency Injection (Hilt)
│   │   │   ├── ui/          # UI layer (Compose)
│   │   │   └── utils/       # Utilities
│   │   └── res/             # Resources
│   └── build.gradle.kts
│
├── worker/                  # ☁️ Cloudflare Worker
│   ├── src/
│   │   ├── routes/          # API routes
│   │   ├── services/        # Core services
│   │   ├── jobs/            # Scheduled jobs
│   │   └── utils/           # Utility functions
│   ├── db/schema.sql        # Database schema
│   └── wrangler.toml        # Worker config
│
├── shared/                  # 📝 Shared Config
│   └── prompts.json         # Personality and prompts
│
└── scripts/                 # 🔧 Deployment Scripts
    ├── deploy_cf.bat        # Windows one-click deploy
    └── sync_shared.py       # Sync prompts
```

---

## 📚 Learn More

| Document | Content |
|:---------|:--------|
| 📘 [**Tech Architecture Blueprint**](TECH_ARCHITECTURE_BLUEPRINT.md) | Design philosophy, data flow, API contracts, extension guide |
| 📝 [**Personality Definition**](shared/prompts.json) | ATRI's personality, diary generation, memory system prompts |
| 🗄️ [**Database Schema**](worker/db/schema.sql) | D1 database table definitions |

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

Before contributing code, we recommend reading the [Tech Architecture Blueprint](TECH_ARCHITECTURE_BLUEPRINT.md) to understand the system design.

---

## 📄 License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

**In short**:
- ✅ Personal learning, research, non-commercial use
- ❌ Commercial use requires separate authorization

---

<div align="center">

<br/>

**If this project helps you, consider giving it a ⭐**

<br/>

<sub>Built with ❤️ for those who believe AI can be more than just a tool</sub>

</div>
