# ॐ Whisper

> Your voice, transcribed instantly. Private by design.

A fast, privacy-first voice transcription app for **macOS** and **Windows**. Powered by OpenAI Whisper running entirely on your device — no internet required, no audio ever leaves your machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](#platform-support)
[![Release](https://img.shields.io/github/v/release/rockykusuma/omwhisper)](https://github.com/rockykusuma/omwhisper/releases)

**[🌐 Website](https://www.omwhisper.in) · [⬇️ Download](https://www.omwhisper.in) · [📋 Releases](https://github.com/rockykusuma/omwhisper/releases)**

---

## Features

- **100% On-device** — Audio never leaves your device
- **Real-time** — Words appear as you speak (~340ms latency)
- **Offline** — No internet required after model download
- **Menu bar** — Lives quietly in your menu bar, out of the way
- **Auto-paste** — Transcription is pasted directly into the focused app
- **Smart Dictation** — Voice → Whisper → LLM polish → Paste (`Cmd+Shift+B`)
- **Push-to-Talk** — Hold Fn to record, release to stop (macOS)
- **Silero VAD** — Neural voice activity detection filters silence before Whisper inference
- **Live Text Streaming** — See partial transcription in the overlay as you speak
- **Custom Vocabulary** — Bias Whisper toward domain-specific words
- **History** — Searchable SQLite log of all transcriptions
- **Metal GPU** — Apple Silicon accelerated on macOS

---

## Download

| | Link |
|--|------|
| 🌐 Website | [omwhisper.in](https://www.omwhisper.in) |
| 📦 GitHub Releases | [github.com/rockykusuma/omwhisper/releases](https://github.com/rockykusuma/omwhisper/releases) |

- **macOS** — Download the `.dmg`, drag OmWhisper to Applications, and launch. The app ships with the `tiny.en` model — no initial download needed.
- **Windows** — Download the `.exe` installer and run it. CPU-only transcription, no additional setup needed.

---

## Platform Support

| Feature | macOS | Windows |
|---------|-------|---------|
| Real-time transcription | ✅ Metal GPU | ✅ CPU |
| Auto-paste | ✅ Accessibility API | ✅ SendInput |
| Silero VAD (neural) | ✅ | ✅ |
| Live Text Streaming | ✅ | ✅ |
| Moonshine engine | ✅ | ❌ |
| Push-to-Talk | ✅ CGEventTap (Fn key) | ❌ Toggle only |
| Smart Dictation (AI) | ✅ Ollama + Cloud + Built-in LLM | ✅ Ollama + Cloud |
| Built-in on-device LLM | ✅ llama.cpp Metal | ❌ |
| Installer | `.dmg` / `.app` | `.exe` (NSIS) |

---

## Getting Started (Development)

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+
- [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/)
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Windows: Visual Studio Build Tools + WebView2

### Run in Development

```bash
# Install frontend dependencies
npm install

# Download a Whisper model (tiny is fastest for dev)
mkdir -p models
curl -L -o models/ggml-tiny.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin

# Start dev server
cargo tauri dev
```

> First build compiles `whisper.cpp` with Metal — expect ~5–10 minutes.

### macOS: Auto-Paste Setup (Dev)

After each `cargo build`, re-sign the binary so macOS Accessibility permission persists:

```bash
codesign --force --sign - --identifier "com.omwhisper.app" src-tauri/target/debug/omwhisper
```

Then grant **Accessibility** in System Settings → Privacy & Security → Accessibility.

### Build for Release

**macOS** (requires Apple Developer certificate):
```bash
bash scripts/build-release.sh
```

**Windows** — Trigger manually via GitHub Actions → Build Windows → Run workflow.

---

## Transcription Models

**macOS:** Moonshine is the default engine — ultra-fast English transcription via a dedicated neural model. Download in-app via **AI Models → Moonshine**.

**Whisper** models are available for all languages and translation. The app ships with `tiny.en` bundled; larger models can be downloaded in-app via **AI Models**:

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| tiny.en | 75 MB | Fastest | Good |
| base.en | 142 MB | Fast | Better |
| small / small.en | 466 MB | Moderate | Great |
| large-v3-turbo | 1.5 GB | Slower | Best |

Models are stored at:
- macOS: `~/Library/Application Support/com.omwhisper.app/models/`
- Windows: `%APPDATA%\com.omwhisper.app\models\`

---

## Smart Dictation

**Shortcut:** `Cmd+Shift+B` (macOS) · `Ctrl+Shift+B` (Windows)

Voice → Whisper → LLM polish → auto-paste into the focused app.

Supported backends:
- **On-device (macOS):** Built-in llama.cpp Metal — no internet needed
- **Ollama:** Any locally running model
- **Cloud:** OpenAI, Groq, or any OpenAI-compatible API

Six built-in polish styles: Professional, Casual, Concise, Translate, Email, Meeting Notes. Custom styles supported.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App framework | Tauri 2 |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Backend | Rust |
| Transcription | whisper-rs 0.14 (whisper.cpp) · Moonshine (macOS) |
| Audio capture | cpal 0.15 |
| AI polish | Ollama / OpenAI / Groq / llama-cpp-2 |
| History | SQLite (rusqlite) |

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and guidelines.

---

## License

MIT — see [LICENSE](./LICENSE).

[whisper.cpp](https://github.com/ggerganov/whisper.cpp) is used under the MIT License.
