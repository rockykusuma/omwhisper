# OmWhisper — Development Environment Setup

This guide walks you through setting up everything needed to start building OmWhisper on your Mac.

---

## Step 1: Install System Dependencies

### Xcode Command Line Tools
```bash
xcode-select --install
```
This gives you the C/C++ compilers needed to build whisper.cpp.

### Homebrew (if not already installed)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### CMake (required for whisper.cpp compilation)
```bash
brew install cmake
```

---

## Step 2: Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

After installation, restart your terminal or run:
```bash
source "$HOME/.cargo/env"
```

Verify:
```bash
rustc --version    # Should show 1.75+
cargo --version
```

---

## Step 3: Install Node.js

Using nvm (recommended):
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.zshrc
nvm install 22
nvm use 22
```

Verify:
```bash
node --version    # Should show v22.x
npm --version
```

---

## Step 4: Install Tauri CLI

```bash
cargo install tauri-cli --version "^2"
```

This takes a few minutes on first install. Verify:
```bash
cargo tauri --version
```

---

## Step 5: Create the Tauri Project

```bash
# From your projects directory
cargo tauri init --app-name omwhisper \
  --window-title OmWhisper \
  --frontend-dist ../dist \
  --dev-url http://localhost:5173 \
  --before-dev-command "npm run dev" \
  --before-build-command "npm run build"
```

Or if starting from our repo:
```bash
git clone https://github.com/yourusername/omwhisper.git
cd omwhisper
npm install
```

---

## Step 6: Download a Whisper Model

For development, start with the tiny English model (75MB):
```bash
mkdir -p models
curl -L -o models/ggml-tiny.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin
```

For better accuracy during testing, grab the small English model (466MB):
```bash
curl -L -o models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

---

## Step 7: Verify the Setup

```bash
# Start the dev server
cargo tauri dev
```

This will:
1. Start the Vite dev server (frontend) on port 5173
2. Compile the Rust backend
3. Open the Tauri window

First build takes 3-5 minutes (whisper-rs compiles whisper.cpp from source). Subsequent builds are much faster.

---

## Troubleshooting

### "whisper-rs failed to compile"
Make sure CMake is installed:
```bash
brew install cmake
```

And ensure Xcode CLT is up to date:
```bash
sudo xcode-select --reset
xcode-select --install
```

### "cpal: no audio host available"
Grant microphone permission to your terminal app (Terminal or iTerm) in:
System Settings → Privacy & Security → Microphone

### Slow first compile
This is normal. whisper.cpp is compiled from C++ source on first build.
After the first build, incremental compilation is fast (~5-10 seconds).

### "Port 5173 already in use"
Kill any existing dev servers:
```bash
lsof -i :5173 | grep LISTEN | awk '{print $2}' | xargs kill
```

---

## Recommended IDE Setup

### VS Code Extensions
- **rust-analyzer** — Rust language server (essential)
- **Tauri** — Tauri-specific tooling
- **ES7+ React/Redux/React-Native snippets** — React helpers
- **Tailwind CSS IntelliSense** — Tailwind autocomplete
- **Error Lens** — Inline error display

### VS Code settings.json additions
```json
{
  "rust-analyzer.cargo.features": "all",
  "editor.formatOnSave": true,
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  }
}
```

---

## Next Steps

Once your environment is working:

1. **Read the Project Blueprint** (`docs/PROJECT_BLUEPRINT.md`)
2. **Start with v0.1 tasks** — get audio capture and basic whisper-rs transcription working
3. **Test with a .wav file first** before attempting live mic capture
4. **Iterate** — the audio pipeline is the hardest part, everything else builds on it
