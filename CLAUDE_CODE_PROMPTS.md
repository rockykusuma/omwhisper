# OmWhisper — Claude Code Starter Prompt

Copy-paste this as your first prompt in Claude Code after navigating to
your omwhisper/ project directory.

---

## PROMPT 1: Project Scaffold

```
Read all files in ./docs/ to understand the project. Then:

1. Initialize a Tauri 2 project with React + TypeScript frontend:
   - Use Vite as the bundler
   - Set app name to "omwhisper", window title to "OmWhisper"
   - Enable these Tauri features: tray-icon, global-shortcut

2. Set up the Rust backend (src-tauri/):
   - Add these dependencies to Cargo.toml: whisper-rs = "0.15", cpal = "0.15",
     serde with derive feature, serde_json, tokio with full features, anyhow,
     tracing
   - Create the module structure from ARCHITECTURE.md:
     src/audio/mod.rs, src/audio/capture.rs
     src/whisper/mod.rs, src/whisper/engine.rs, src/whisper/models.rs
     src/commands.rs

3. Set up the React frontend (src/):
   - Install: zustand, lucide-react
   - Install dev: tailwindcss, @tailwindcss/vite
   - Configure Tailwind
   - Create the component stubs from ARCHITECTURE.md:
     components/TranscriptionView.tsx
     hooks/useTranscription.ts
     stores/appStore.ts

4. Make sure `cargo tauri dev` compiles and opens a window showing
   "OmWhisper — Ready" with the app name.

Do NOT implement transcription yet. Just get the skeleton compiling and running.
```

---

## PROMPT 2: Basic Whisper Transcription

```
Now implement basic whisper-rs transcription:

1. In src-tauri/src/whisper/engine.rs:
   - Create a WhisperEngine struct that loads a GGML model file
   - Implement a transcribe() method that takes a file path to a .wav file,
     reads it, converts to 16kHz mono f32, runs whisper-rs, and returns
     the transcribed text with timestamps

2. In src-tauri/src/commands.rs:
   - Create a Tauri command `transcribe_file` that takes a file path string,
     uses WhisperEngine to transcribe it, and returns the text

3. In the React frontend:
   - Add a simple UI with a "Select Audio File" button
   - Use Tauri's dialog API to pick a .wav file
   - Call the transcribe_file command and display the result

Test with: models/ggml-tiny.en.bin model
Download a sample wav from whisper.cpp repo if needed.
```

---

## PROMPT 3: Live Microphone Capture

```
Add real-time microphone capture:

1. In src-tauri/src/audio/capture.rs:
   - Use cpal to capture audio from the default input device
   - Resample to 16kHz mono f32 (whisper-rs requirement)
   - Buffer audio in chunks of ~3 seconds
   - Send chunks via a channel to the transcription engine

2. In src-tauri/src/commands.rs:
   - Add start_transcription and stop_transcription commands
   - start_transcription should begin mic capture and pipe audio to WhisperEngine
   - Emit "transcription-update" events to the frontend with each new segment

3. In the React frontend:
   - Add a Record/Stop button
   - Listen to "transcription-update" events
   - Display transcribed text in real time

Handle microphone permissions gracefully — show a clear message if denied.
```

---

## PROMPT 4: Global Hotkey + System Tray

```
Add system tray and global hotkey:

1. Configure Tauri system tray:
   - Show OmWhisper icon in the menu bar
   - Right-click menu: Start/Stop, Settings, Quit
   - Left-click toggles recording

2. Register global hotkey (Cmd+Shift+V):
   - Toggle transcription on/off from anywhere
   - Show a small floating indicator when recording

3. Keep the main window hidden by default — the app should live in the
   menu bar. Show window only from tray menu or when there's transcription
   to display.
```

---

## Tips for Working with Claude Code

- Run each prompt separately and verify it works before moving to the next
- If compilation fails, paste the error and ask Claude Code to fix it
- After Prompt 1, always keep `cargo tauri dev` running to catch issues early
- The first Rust compile takes 3-5 minutes (whisper.cpp builds from source)
- If whisper-rs fails to compile, make sure cmake is installed: `brew install cmake`
