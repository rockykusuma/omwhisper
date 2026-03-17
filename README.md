# ॐ OmWhisper

> Your voice, transcribed instantly. Private by design.

A fast, privacy-first voice transcription app for **macOS and Windows**. Powered by OpenAI Whisper, running entirely on your device — no internet required, no audio ever leaves your machine.

---

## Features

- **100% On-device** — Audio never leaves your device
- **Real-time** — Words appear as you speak (~340ms latency)
- **Offline** — No internet required after model download
- **Menu bar** — Lives quietly in your menu bar, out of the way
- **Auto-paste** — Transcription is pasted directly into the focused app
- **Smart Dictation** — Voice → Whisper → LLM polish → Paste (AI-powered cleanup)
- **Push-to-Talk** — Hold a key to record, release to stop (macOS)
- **Custom Vocabulary** — Bias Whisper toward domain-specific words
- **History** — Searchable SQLite log of all transcriptions
- **Metal GPU** — Apple Silicon accelerated on macOS (CPU on Windows)

---

## Platform Support

| Feature | macOS | Windows |
|---------|-------|---------|
| Real-time transcription | ✅ Metal GPU | ✅ CPU |
| Auto-paste | ✅ Accessibility API | ✅ SendInput |
| Push-to-Talk | ✅ (CGEventTap) | ❌ Toggle only |
| Smart Dictation (AI) | ✅ Ollama + Cloud + Built-in LLM | ✅ Ollama + Cloud |
| Built-in on-device LLM | ✅ llama.cpp Metal | ❌ |
| Installer | `.dmg` / `.app` | `.exe` (NSIS) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App framework | Tauri 2 |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Backend | Rust |
| Transcription | whisper-rs 0.14 (whisper.cpp) |
| Audio capture | cpal 0.15 |
| AI polish | Ollama / OpenAI / Groq / llama-cpp-2 |
| History | SQLite (rusqlite) |
| License | Lemon Squeezy |

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+
- [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/)

### Run in Development

```bash
# Install frontend dependencies
npm install

# Download a Whisper model (tiny is fastest, good for testing)
mkdir -p models
curl -L -o models/ggml-tiny.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin

# Start dev server
cargo tauri dev
```

> **macOS — auto-paste setup**: After each `cargo build`, re-sign the binary so macOS Accessibility permission sticks:
> ```bash
> codesign --force --sign - --identifier "com.omwhisper.app" src-tauri/target/debug/omwhisper
> ```

### Build for Release

**macOS:**
```bash
cargo tauri build
# or
bash scripts/build-release.sh
```

**Windows:** Built automatically by GitHub Actions on every `v*` tag push. Download the `.exe` from the [Actions artifacts](https://github.com/rockykusuma/omwhisper/actions).

---

## Whisper Models

Models are downloaded through the in-app Model Manager. Available models:

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny.en | 75 MB | Fastest | Good |
| base.en | 142 MB | Fast | Better |
| small / small.en | 466 MB | Moderate | Great |
| large-v3-turbo | 1.5 GB | Slower | Best |

Models are stored in `~/Library/Application Support/com.omwhisper.app/models/` (macOS) or `%APPDATA%\com.omwhisper.app\models\` (Windows).

---

## Smart Dictation

**Shortcut:** `Cmd+Shift+B` (macOS) / `Ctrl+Shift+B` (Windows)

Voice → Whisper transcription → LLM polish → auto-paste. Supports:

- **On-device (macOS):** Built-in llama.cpp Metal backend — no internet needed
- **Ollama:** Any locally running Ollama model
- **Cloud:** OpenAI, Groq, or any OpenAI-compatible API

Six built-in polish styles: Professional, Casual, Concise, Translate, Email, Meeting Notes. Custom styles supported.

---

## License

Proprietary — All rights reserved.
[whisper.cpp](https://github.com/ggerganov/whisper.cpp) is used under the MIT License.
