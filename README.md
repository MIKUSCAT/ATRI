# ATRI - Emotionally Evolving AI Companion Project

> Language: English · [简体中文](README-zh.md)

<p align="center">
  <img src="ATRI.png" alt="ATRI" width="480" />
</p>

<p align="center">
  <strong>Your personal AI companion who remembers, reflects, and grows alongside you</strong>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-key-features">Features</a> •
  <a href="#-ui-preview">Screenshots</a> •
  <a href="#-learn-more">Documentation</a>
</p>

---

## 💡 What is ATRI?

ATRI is a **mobile companion app** that combines conversational AI with emotional memory. Built with:

| Component | Purpose |
|-----------|---------|
| 📱 **Android App** | Chat interface for daily conversations |
| ☁️ **Cloudflare Worker** | Lightweight, serverless backend |
| 📔 **Diary + Memory System** | Long-term emotional continuity |

Chat with ATRI throughout your day. Every night at midnight, she writes a diary entry reflecting on your conversations—and those memories shape future interactions.

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| Computer | Windows / macOS / Linux |
| Cloudflare account | Free signup: https://dash.cloudflare.com/sign-up |
| OpenAI API key | Or any OpenAI-compatible API |
| Node.js 18+ | Download: https://nodejs.org/ |
| Python 3.8+ | Download: https://www.python.org/downloads/ |

### Step 1: Deploy the Backend

#### Option A: Windows One-Click Deploy (Recommended for beginners)

1. Double-click `scripts/deploy_cf.bat`
2. Follow the prompts to enter:
   - Worker name (press Enter for default)
   - D1 database name (press Enter for default)
   - R2 bucket name (press Enter for default)
   - Vectorize index name (press Enter for default)
   - API URLs (press Enter for OpenAI defaults)
   - **OPENAI_API_KEY** (required)
   - Other optional secrets
3. The script will automatically create resources and deploy
4. Copy the Worker URL (e.g., `https://atri-worker.xxx.workers.dev`)

#### Option B: macOS / Linux Manual Deploy

```bash
# 1. Clone the project
git clone https://github.com/your-username/ATRI.git
cd ATRI

# 2. Install dependencies
cd worker
npm install

# 3. Login to Cloudflare
npx wrangler login

# 4. Create D1 database
npx wrangler d1 create atri_diary
# Copy the database_id from output and paste it into worker/wrangler.toml

# 5. Initialize database tables
npx wrangler d1 execute atri_diary --file=db/schema.sql

# 6. Create R2 bucket
npx wrangler r2 bucket create atri-media

# 7. Create Vectorize index
npx wrangler vectorize create atri-memories --dimensions=1024 --metric=cosine

# 8. Set secrets
npx wrangler secret put OPENAI_API_KEY
# Enter your API key when prompted

# 9. Sync prompts
cd ..
python3 scripts/sync_shared.py

# 10. Deploy
cd worker
npx wrangler deploy
```

After successful deployment, you'll see the Worker URL:
```
Published atri-worker (1.0.0)
  https://atri-worker.your-subdomain.workers.dev
```

#### Configure Secrets

| Secret | Description | Required |
|--------|-------------|:--------:|
| `OPENAI_API_KEY` | Chat model API key | ✅ |
| `EMBEDDINGS_API_KEY` | Embeddings key (uses OPENAI_API_KEY if empty) | ❌ |
| `APP_TOKEN` | App access token to protect API | Recommended |

**Set via command line:**
```bash
cd worker
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_TOKEN
```

### Step 2: Install the App

Download the pre-built APK: [`app-debug.apk`](app-debug.apk), or build from source in `ATRI/`.

### Step 3: Configure & Chat

1. **Welcome Screen** — Set your nickname and avatar
2. **Settings** (tap gear icon) — Configure:

   | Setting | Example | Description |
   |---------|---------|-------------|
   | Worker URL | `https://atri-worker.xxx.workers.dev` | Your deployed Worker URL |
   | App Token | `your-token` | Must match backend `APP_TOKEN` |
   | Model | `gpt-4` | Can be changed as needed |

3. **Start chatting!**

---

## ⚠️ Troubleshooting

### Q: Deploy script says "node not found"
**A:** Install Node.js 18+: https://nodejs.org/

### Q: Deploy script says "Python not found"
**A:** Install Python 3.8+: https://www.python.org/downloads/

### Q: wrangler login keeps spinning
**A:** Check your network connection. You may need a VPN in some regions.

### Q: Chat not responding
**A:**
1. Verify Worker URL is correct
2. Check if OPENAI_API_KEY is valid
3. Check Worker logs in Cloudflare dashboard

### Q: Diary not generating
**A:** Diaries are generated at 23:59 Beijing time daily. There must be conversation records for that day.

### Q: How to use other AI services (DeepSeek, Claude, etc.)?
**A:** Any OpenAI-compatible API works:
1. Edit `OPENAI_API_URL` in `worker/wrangler.toml` to your provider's URL
2. Redeploy: `cd worker && npx wrangler deploy`

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🎭 **In-Character Persona** | Authentic ATRI personality via `shared/prompts.json` |
| 🧠 **Working Memory** | Today's conversations automatically inform responses |
| 📝 **Nightly Diary** | Auto-generated reflections at 23:59 (Beijing time) |
| 💾 **Long-Term Memory** | Vector-stored diaries for meaningful recall |
| 📎 **Rich Attachments** | Support for images and documents in chat |

---

## 🖼️ UI Preview

<table>
  <tr>
    <td align="center">
      <img src="欢迎界面.jpg" alt="Welcome Screen" width="200"/><br/>
      <sub><b>Welcome</b></sub>
    </td>
    <td align="center">
      <img src="对话界面.jpg" alt="Chat Screen" width="200"/><br/>
      <sub><b>Chat</b></sub>
    </td>
    <td align="center">
      <img src="侧边栏.jpg" alt="Sidebar" width="200"/><br/>
      <sub><b>Sidebar</b></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="日记界面.jpg" alt="Diary Screen" width="200"/><br/>
      <sub><b>Diary</b></sub>
    </td>
    <td align="center">
      <img src="设置界面.jpg" alt="Settings Screen" width="200"/><br/>
      <sub><b>Settings</b></sub>
    </td>
    <td></td>
  </tr>
</table>

---

## 📚 Learn More

| Resource | Content |
|:---------|:--------|
| [`TECH_ARCHITECTURE_BLUEPRINT.md`](TECH_ARCHITECTURE_BLUEPRINT.md) | Architecture, API, storage, extensions |
| [`shared/prompts.json`](shared/prompts.json) | Character prompts and personality definitions |

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

## 📄 License

This project is licensed under the **MIT License**.

---

<p align="center">
  <sub>Built with ❤️ for those who believe AI can be more than just a tool</sub>
</p>
