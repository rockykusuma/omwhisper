# Contributing to OmWhisper

Thanks for your interest in contributing! Here's everything you need to get started.

## Development Setup

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Xcode Command Line Tools on macOS)

### Run Locally

```bash
# Install frontend dependencies
npm install

# Download a Whisper model (required to run the app)
mkdir -p models
curl -L -o models/ggml-tiny.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin

# Start dev server
cargo tauri dev
```

First build compiles `whisper.cpp` — expect ~5–10 minutes.

### macOS: Auto-Paste Setup

After each `cargo build`, re-sign the binary so macOS Accessibility permission persists:

```bash
codesign --force --sign - --identifier "com.omwhisper.app" src-tauri/target/debug/omwhisper
```

Then grant Accessibility in **System Settings → Privacy & Security → Accessibility**.

## Project Structure

```
src/                  # React + TypeScript frontend
src-tauri/src/        # Rust backend
  commands.rs         # All Tauri IPC commands
  settings.rs         # App settings
  history.rs          # SQLite transcription history
  audio/              # Microphone capture (cpal)
  whisper/            # Whisper.cpp integration
  ai/                 # Ollama + Cloud API
  paste.rs            # Clipboard + auto-paste
scripts/              # Build helpers
.github/workflows/    # CI (Windows NSIS build)
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test on your platform (`cargo tauri dev`)
4. Open a pull request with a clear description

## Platform Notes

| | macOS | Windows |
|---|---|---|
| GPU acceleration | Metal (automatic) | CPU only |
| Push-to-Talk | CGEventTap | Not supported |
| Built-in LLM | llama.cpp Metal | Not supported |
| Release build | `bash scripts/build-release.sh` | GitHub Actions CI |

## Reporting Issues

Use [GitHub Issues](https://github.com/rockykusuma/omwhisper/issues). Include:
- macOS / Windows version
- App version (Settings → About)
- Steps to reproduce
- Debug info (Settings → About → Copy Debug Info)

## License

By contributing, you agree your contributions will be licensed under the [MIT License](./LICENSE).
