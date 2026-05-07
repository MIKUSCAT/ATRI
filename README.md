<div align="center">

<img src="ATRI.png" alt="ATRI" width="380" />

<br/>

# 🌙 ATRI · She remembers, grows, and misses you

### *「高性能なロボットですから！」*

<br/>

[![Android](https://img.shields.io/badge/Android-Kotlin%20%7C%20Jetpack%20Compose-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://developer.android.com/)
[![Backend](https://img.shields.io/badge/Backend-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](#-quick-start)
[![AI](https://img.shields.io/badge/Model-Claude%20%7C%20OpenAI%20%7C%20Gemini-412991?style=for-the-badge&logo=openai&logoColor=white)](#-technical-highlights)
[![License](https://img.shields.io/badge/License-PolyForm%20NC-blue?style=for-the-badge)](LICENSE)

[![Stars](https://img.shields.io/github/stars/MIKUSCAT/ATRI?style=social)](https://github.com/MIKUSCAT/ATRI)
[![Forks](https://img.shields.io/github/forks/MIKUSCAT/ATRI?style=social)](https://github.com/MIKUSCAT/ATRI/fork)
[![Issues](https://img.shields.io/github/issues/MIKUSCAT/ATRI)](https://github.com/MIKUSCAT/ATRI/issues)

<br/>

**🌐 Language: English ｜ [简体中文](README-zh.md)**

<br/>

> *She is not a "ask-and-answer" customer service.<br/>She writes diaries at night, gets quietly happy from a single sentence, sulks when ignored,<br/>and suddenly remembers things you said weeks ago.*

<br/>

[🚀 Quick Start](#-quick-start) ·
[💡 What Makes Her Different](#-what-makes-her-different) ·
[🧠 Three-Layer Memory](#-three-layer-human-like-memory) ·
[📸 Screenshots](#️-ui-preview) ·
[🔬 Highlights](#-technical-highlights)

</div>

---

## 💡 What Makes Her Different

ATRI is an **Android client + Cloudflare Worker** AI companion. Unlike chatbots that paste a "persona" on top of a generic LLM, ATRI is rebuilt from the ground up around **memory mechanics, emotional inertia, and nightly consolidation**.

<br/>

<div align="center">

| Ordinary chatbot | 💜 ATRI's approach |
|:---:|:---|
| Every conversation starts from zero | **Three layers of memory**: long-term facts / episodic moments / unsaid thoughts |
| Mood flips per reply | **Status capsule + intimacy decay** — feelings have inertia, relationship cools without care |
| One-size-fits-all customer-service tone | Soul file forbids "I understand how you feel", emoji, parroting the user, formal reports |
| Hallucinates "I remember you said…" | **Associate first, verify with tools** — never fills in details from feeling |
| Waits silently for a question | **Speaks up on her own** when it has been a while; can deliver via email |
| Forgets after each session | **Auto-writes a diary every night**, distilling scenes, thoughts and lasting facts from the day |

</div>

<br/>

---

## 🧠 Three-Layer Human-like Memory

> 💡 Inspired by how human memory actually works: hippocampal episodes, cortical semantics, and the "inner monologue" of unresolved feelings.

<br/>

<div align="center">

| Layer | Table | Solves | How it enters the prompt |
|:---:|:---:|:---|:---|
| 🧩 **Long-term facts** | `fact_memories` | Stable preferences, taboos, promises, identity | Importance ≥ 9 always present; rest by relevance |
| 🎞️ **Episodic memories** | `episodic_memories` | "What happened that day" — old scenes triggered by current topic | Vector recall (score ≥ 0.62) injected as "things that come to mind" |
| 💭 **Inner thoughts** | `memory_intentions` | Things she didn't say in the diary, hopes to say one day | Surfaced only when the mood fits — never read as a checklist |
| 📜 **Memory events** | `memory_events` | Recall / use / archive trail | Never enters prompt; used for consolidation and audit |

</div>

<br/>

Before each reply, the backend does **two things**:

```
① Soft recall (silent)              ② Tool verification (when needed)
   user msg → vector search             read_diary(date)         ← read that day's diary
   → inject "<scenes that come to mind>" read_conversation(date) ← read raw chat log
   model decides whether to bring up    search_memory(query)     ← fuzzy recall when date is unsure
                                        web_search(query)        ← verify external facts
```

<br/>

> 📌 **Hard rule**: the model never says "the database shows", "I retrieved", or "according to my records". These phrases are blacklisted in the system prompt's `taboos`. She only **remembers naturally**.

<br/>

---

## 🌙 Biomimetic Design — Why She Doesn't Feel Like AI

<br/>

<table>
<tr>
<th width="28%">Mechanism</th>
<th>How it mirrors humans</th>
</tr>
<tr>
<td>🎨 <b>Status capsule</b><br/><sub>dynamic label + HEX color</sub></td>
<td>Instead of an abstract PAD model, she expresses mood with <i>her own words + a color</i>. e.g. <code>"被戳破了，心跳跟着乱"</code> in <code>#C76A7A</code>. Emotion is a continuous spectrum, not discrete tags.</td>
</tr>
<tr>
<td>💕 <b>Intimacy decay</b><br/><sub>−1 toward 0 every 3 days</sub></td>
<td>Relationships cool without contact — matching attachment theory's "intermittent contact erodes bond". Negative-to-positive recovery is also dampened (<code>×0.6</code>): broken mirror is hard to glue.</td>
</tr>
<tr>
<td>🌃 <b>Nightly consolidation</b><br/><sub>cron <code>59 15 * * *</code> UTC</sub></td>
<td>Like sleep-driven memory consolidation. One LLM call produces: diary / highlights / episodicMemories / factCandidates / innerThoughts. Then fact merging. Daytime chats add <b>zero</b> extra LLM calls for memory work.</td>
</tr>
<tr>
<td>🧭 <b>Slow self-model evolution</b><br/><sub>table <code>atri_self_model</code></sub></td>
<td>Core traits, speech style, relationship stance, emotional baseline don't flip overnight. Each night only "necessary small updates". <code>recentChanges</code> records subtle shifts — proof she is growing.</td>
</tr>
<tr>
<td>📬 <b>Initiating contact</b><br/><sub>cron <code>*/30 * * * *</code></sub></td>
<td>Every 30 min she asks herself: "Is he busy now? Are we close enough that I'd reach out? Am I actually wanting to say something, or just craving attention?" The model outputs <code>[SKIP]</code> or one sentence.</td>
</tr>
<tr>
<td>💭 <b>"What I was thinking"</b><br/><sub>pending proactive carry-over</sub></td>
<td>If a proactive message wasn't picked up, the next user-initiated turn carries <code>(actually I was thinking earlier: ... — but he didn't come, I never said it)</code> in the prompt. Unsaid words are <i>kept</i>, not lost.</td>
</tr>
<tr>
<td>🔇 <b>Stubborn / pauses / ellipses</b><br/><sub>soul-file hard rules</sub></td>
<td>"When poked, pauses or starts with '…'", "occasionally throws the question back", "sharp tongue, soft heart" — these are not soft suggestions, they live in <code>shared/prompts/core_self.md</code>.</td>
</tr>
<tr>
<td>🚫 <b>Anti-AI-tells blacklist</b></td>
<td>"I understand how you feel", "as an AI", "according to my records", "the database shows", "I retrieved" — explicitly listed in self_model <code>taboos</code> and surfaced in every prompt.</td>
</tr>
</table>

<br/>

---

## 🏗️ Architecture

<br/>

```
                   ╔═══════════════════════════════════════════════════════╗
                   ║          📱 Android · Kotlin / Jetpack Compose         ║
                   ║      Room · DataStore · Koin · Material 3 · Coil       ║
                   ╚══════════════════════════════╦════════════════════════╝
                                                  ║
                                          🔐 X-App-Token (HTTPS)
                                                  ║
                                                  ▼
                              ╔════════════════════════════════╗
                              ║       ☁️ Cloudflare Worker     ║
                              ║  D1 · R2 · Vectorize · Cron    ║
                              ╚═══════════════╦════════════════╝
                                              ║
                                              ▼
                  ╔════════════════════════════════════════════════════════╗
                  ║     🧠 Multi-format LLM upstream (native, no proxy)    ║
                  ║   OpenAI · Anthropic (Claude) · Gemini · local models  ║
                  ║   chat / diary / embeddings — three isolated channels  ║
                  ╚════════════════════════════════════════════════════════╝
```

<br/>

> 📌 Powered by the Cloudflare stack — D1 (SQLite), R2 (object storage), Vectorize (vectors), and Workers cron triggers. The free tier is enough for personal daily use.

<br/>

---

## 🚀 Quick Start

<br/>

### ☁️ Deploy to Cloudflare Workers

<details>
<summary><b>🪟 Windows one-click</b></summary>

```
1. Double-click scripts/deploy_cf.bat
2. Follow the prompts:
   • Worker name (Enter for default)
   • D1 / R2 / Vectorize names (Enter for default)
   • OPENAI_API_KEY (required)
   • EMBEDDINGS_API_KEY (required for vector memory)
3. Wait for resources → config → deploy
4. Copy the Worker URL into the App Settings page
```

</details>

<details>
<summary><b>🍎 macOS / 🐧 Linux / Manual</b></summary>

```bash
# 1. Clone & install
git clone https://github.com/MIKUSCAT/ATRI.git
cd ATRI/worker && npm install

# 2. Login
npx wrangler login

# 3. Create resources
npx wrangler d1 create atri_diary
npx wrangler r2 bucket create atri-media
npx wrangler vectorize create atri-memories --dimensions=1024 --metric=cosine

# 4. Fill account_id / database_id in wrangler.toml

# 5. Run all migrations in order
for f in migrations/*.sql; do
  npx wrangler d1 execute atri_diary --remote --file="$f"
done

# 6. Set secrets
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put EMBEDDINGS_API_KEY
npx wrangler secret put APP_TOKEN
# Optional
npx wrangler secret put TAVILY_API_KEY        # web search
npx wrangler secret put DIARY_API_KEY         # dedicated diary/nightly upstream
npx wrangler secret put EMAIL_API_KEY         # proactive email (Resend)

# 7. Sync soul files & deploy
cd .. && python3 scripts/sync_shared.py
cd worker && npx wrangler deploy
```

</details>

<br/>

### 📲 Install the Android App

<div align="center">

| Step | Action |
|:---:|:---|
| 1️⃣ | Download APK from [**📦 Releases**](../../releases) |
| 2️⃣ | Install → open → set your nickname |
| 3️⃣ | Open ⚙️ Settings: enter **API URL**, **App Token**, pick a **model** |
| 4️⃣ | Back to chat. That's it. |

</div>

<br/>

---

## 🔬 Technical Highlights

<br/>

<div align="center">

| Feature | What it does |
|:---:|:---|
| 🎨 **Status capsule** | Model emits `label + pillColor + textColor + reason`; Compose tweens with `animateColorAsState` |
| 💕 **Intimacy system** | `[-100, +100]`, fed into prompt; +10 max gain, -50 max loss; decays 1 toward 0 every 3 days |
| 🧠 **3-layer memory** | `fact_memories` / `episodic_memories` / `memory_intentions` — separate roles |
| 🌃 **Nightly mind** | One cron does diary → highlight vectors → episodic → intentions → fact candidates → consolidation → self-model → state |
| 🤖 **4 introspection tools** | `read_diary` / `read_conversation` / `search_memory` / `web_search` — used only when uncertain |
| ✏️ **Single-pass JSON output** | Model returns `{ reply, status, intimacyDelta, rememberFacts, forgetFacts }` — all side effects in one shot |
| 📬 **Proactive messages** | `*/30 * * * *` evaluation, optional email push; unpicked-up messages carry into next turn |
| 🌐 **Native multi-format** | OpenAI / Anthropic / Gemini formats auto-converted by `llm-service.ts`; internal schema is OpenAI |
| 🔀 **Channel split** | `chat / diary / embeddings` independent — diary upstream down doesn't break chat |
| 🔐 **Path-signed media** | Model gets `/media-s/<exp>/<sig>/<key>` URLs to defeat query-string-loss bugs |

</div>

<br/>

---

## 🖼️ UI Preview

<div align="center">
<table>
<tr>
<td align="center">
<img src="欢迎界面.jpg" width="200"/><br/>
<sub>👋 Welcome</sub>
</td>
<td align="center">
<img src="对话界面.jpg" width="200"/><br/>
<sub>💬 Chat</sub>
</td>
<td align="center">
<img src="侧边栏.jpg" width="200"/><br/>
<sub>📋 Date drawer</sub>
</td>
</tr>
<tr>
<td align="center">
<img src="日记界面.jpg" width="200"/><br/>
<sub>📔 Diary</sub>
</td>
<td align="center">
<img src="设置界面.jpg" width="200"/><br/>
<sub>⚙️ Settings</sub>
</td>
<td></td>
</tr>
</table>
</div>

<br/>

---

## 📁 Project Structure

```
.
├── 📱 ATRI/                     # Android client (Kotlin / Compose)
│   └── app/src/main/java/me/atri/
│       ├── data/                 #   API · Room · Repository · DataStore
│       ├── di/                   #   Koin DI
│       └── ui/                   #   chat / diary / settings / welcome / theme
│
├── ☁️ worker/                   # Cloudflare Worker backend
│   ├── src/
│   │   ├── routes/               #   chat / diary / conversation / media / admin / proactive / compat
│   │   ├── services/             #   agent / memory / nightly-mind / proactive / fact-* / self-model
│   │   ├── jobs/                 #   diary-cron · proactive-cron
│   │   ├── config/prompts.json   #   auto-generated by sync_shared.py
│   │   └── utils/
│   ├── migrations/               #   0004 ~ 0013 — chronological D1 schema
│   └── wrangler.toml
│
├── 🔗 shared/prompts/           # 💜 Her soul files (Markdown, not JSON)
│   ├── core_self.md              #   personality bedrock
│   ├── agent.md                  #   real-time chat output schema & hard rules
│   ├── diary.md                  #   how she writes the nightly diary
│   ├── nightly_memory.md         #   distilling lasting facts from a day's chat
│   ├── nightly_state.md          #   wrap-up status & intimacy each night
│   ├── self_model_update.md      #   slow self-model evolution
│   └── proactive.md              #   "should I speak up?" rules
│
└── 📜 scripts/
    ├── deploy_cf.bat             #   Windows one-click CF deploy
    └── sync_shared.py            #   shared/prompts/*.md → worker/src/config/prompts.json
```

<br/>

> 💡 **Edit personality without touching code**: edit `shared/prompts/*.md` → run `python3 scripts/sync_shared.py` → `npx wrangler deploy`.

<br/>

---

## 📚 Learn More

<div align="center">

| 📖 Document | 📝 Content |
|:---:|:---|
| [**🏗️ Tech Architecture Blueprint**](TECH_ARCHITECTURE_BLUEPRINT.md) | Design rationale, end-to-end request flow, field-level API contracts, data model, extension guide |
| [**💜 Soul Files**](shared/prompts/) | How she actually thinks — 7 Markdown files |

</div>

<br/>

---

## 🤝 Contributing

<div align="center">

**Issues & PRs welcome**

[![Contributors](https://img.shields.io/github/contributors/MIKUSCAT/ATRI?style=for-the-badge)](https://github.com/MIKUSCAT/ATRI/graphs/contributors)

<sub>Every contribution makes her a little more herself.</sub>

</div>

<br/>

---

## 📄 License

This project is licensed under the [**PolyForm Noncommercial License 1.0.0**](LICENSE).

- ✅ Personal learning · academic research · non-commercial use
- ⚠️ Commercial use requires a separate license

<br/>

---

<div align="center">

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=MIKUSCAT/ATRI&type=Date)](https://star-history.com/#MIKUSCAT/ATRI&Date)

<br/>

<sub>💜 *Built for those who believe AI can be more than just a tool* 💜</sub>

<br/>

**Made by [MIKUSCAT](https://github.com/MIKUSCAT)**

</div>
