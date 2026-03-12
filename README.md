# ॐ OmWhisper

> Your voice, transcribed instantly. Private by design.

A lightning-fast, privacy-first voice transcription tool for macOS. Powered by OpenAI Whisper, running entirely on your device.

## Features

- **100% On-device** — Audio never leaves your Mac
- **Real-time** — Words appear as you speak (~340ms latency)
- **Offline** — No internet required
- **Lightweight** — ~10MB app, lives in your menu bar
- **Apple Silicon optimized** — Core ML acceleration

## Tech Stack

- **App:** Tauri 2 + React + TypeScript
- **Engine:** whisper.cpp via whisper-rs (Rust)
- **Audio:** cpal + Silero VAD
- **Distribution:** Direct .dmg download

## Getting Started

See [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md) for full environment setup.

```bash
# Install dependencies
npm install

# Download a test model
mkdir -p models
curl -L -o models/ggml-tiny.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin

# Run in development
cargo tauri dev
```

## Project Docs

- [Project Blueprint](docs/PROJECT_BLUEPRINT.md) — Vision, roadmap, pricing, tech stack
- [Architecture](docs/ARCHITECTURE.md) — System design and module details
- [Setup Guide](docs/SETUP_GUIDE.md) — Dev environment setup

## License

Proprietary — All rights reserved.
whisper.cpp is used under the MIT License.
