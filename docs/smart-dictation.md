---
layout: default
title: Smart Dictation
nav_order: 4
---
layout: default

# Smart Dictation

Smart Dictation takes your raw voice transcription and polishes it through an LLM before pasting — fixing grammar, formatting, tone, or even translating it, depending on the style you choose.

**Shortcut:** `Cmd+Shift+B` (macOS) · `Ctrl+Shift+B` (Windows)

---
layout: default

## How It Works

1. Press the Smart Dictation hotkey
2. Speak naturally
3. Press again to stop
4. OmWhisper transcribes with Whisper, then sends the raw text to your configured AI backend
5. The polished result is pasted into your focused app

The overlay shows a ✦ indicator during AI processing.

---
layout: default

## AI Backends

Configure in **Settings → AI**.

### On-Device LLM (macOS only)

Uses a built-in llama.cpp model running locally with Metal acceleration. No internet, no API key needed.

- First use requires downloading the model (~few GB) via **Settings → AI → On-Device**
- Completely private — nothing leaves your machine

### Ollama

Run any open-source model locally via [Ollama](https://ollama.com).

**Setup:**
1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull a model: `ollama pull llama3.2` (or any model you prefer)
3. In OmWhisper: **Settings → AI → Backend → On-Device (Ollama)**
4. Select your model from the dropdown

Ollama must be running when you use Smart Dictation. OmWhisper shows a status indicator — if it shows offline, start Ollama from your terminal: `ollama serve`.

### Cloud API

Connect to OpenAI, Groq, or any OpenAI-compatible API.

**Setup:**
1. **Settings → AI → Backend → Cloud API**
2. Select a provider preset (OpenAI, Groq) or enter a custom URL
3. Paste your API key
4. Click **Test Connection** to verify

Your API key is stored in your system keychain — never in plain text.

---
layout: default

## Polish Styles

Six built-in styles ship with OmWhisper:

| Style | What it does |
|-------|-------------|
| **Professional** | Clean, formal business tone |
| **Casual** | Natural, conversational language |
| **Concise** | Trims filler, keeps the point |
| **Translate** | Translates to your target language |
| **Email** | Formats as a ready-to-send email |
| **Meeting Notes** | Structured bullet-point summary |

### Custom Styles

Create your own in **Settings → AI → Polish Styles → Add Style**. Write any system prompt — OmWhisper will apply it to every Smart Dictation run when that style is active.

---
layout: default

## Tips

- Use **regular transcription** (`Cmd+Shift+V`) for speed, Smart Dictation (`Cmd+Shift+B`) when quality matters
- The "Concise" style is great for Slack/chat messages
- "Email" style works best when you dictate the full message in one take
- If AI polish fails (network issue, model not running), OmWhisper pastes the raw transcription as a fallback
