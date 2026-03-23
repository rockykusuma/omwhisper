# OmWhisper — Architecture Deep Dive

This document explains how OmWhisper works internally, so you understand what you're building before writing code.

---
layout: default

## System Overview

OmWhisper is a Tauri 2 desktop app. That means:
- The **UI** runs in a native webview (not Electron's Chromium — much lighter)
- The **backend logic** runs in Rust as a native process
- They communicate via **Tauri IPC** (invoke commands from JS, get results back)

All the heavy lifting — audio capture, speech recognition, license validation — happens in Rust. The React frontend is purely for display and user interaction.

---
layout: default

## Core Modules

### 1. Audio Pipeline (`src-tauri/src/audio/`)

**Responsibility:** Capture microphone audio and produce clean speech segments.

**How it works:**

```
Microphone → cpal (raw PCM) → Resampler (to 16kHz) → VAD → Speech Chunks
```

**cpal** is a cross-platform Rust crate for audio I/O. On macOS it uses CoreAudio under the hood. It gives us raw PCM samples from the microphone.

**Resampling** is necessary because whisper-rs expects 16kHz mono float32 audio. Most microphones capture at 44.1kHz or 48kHz. We'll use the `rubato` crate for high-quality resampling.

**VAD (Voice Activity Detection)** using Silero VAD determines which parts of the audio contain speech. This is critical because:
- Feeding silence to Whisper causes hallucinated text
- We only want to process speech segments, saving CPU
- It defines natural "utterance" boundaries

**Output:** Clean speech segments as `Vec<f32>` buffers, each representing 2-5 seconds of speech.

```rust
// Simplified pseudocode
pub struct AudioPipeline {
    stream: cpal::Stream,
    vad: SileroVad,
    buffer: Arc<Mutex<Vec<f32>>>,
}

impl AudioPipeline {
    pub fn start(&mut self) -> Receiver<Vec<f32>> {
        // Returns a channel that emits speech segments
    }

    pub fn stop(&mut self) {
        // Stops capture
    }
}
```

### 2. Whisper Engine (`src-tauri/src/whisper/`)

**Responsibility:** Convert speech audio into text.

**How it works:**

```
Speech Chunks → whisper-rs → Timestamped Text Segments
```

The engine loads a GGML model file and processes audio chunks. Key design decisions:

**Chunk processing strategy:** Whisper natively processes 30-second windows. For real-time feel, we process shorter overlapping windows:
- Accumulate 3 seconds of speech audio
- Process it through Whisper
- Display "interim" results (may change)
- When VAD detects end of utterance, process the full utterance for "final" results
- Final results replace interim results in the UI

**Threading:** Whisper inference is CPU-intensive. Run it on a dedicated thread pool (not Tokio's async runtime) to avoid blocking the UI.

```rust
pub struct WhisperEngine {
    ctx: WhisperContext,
    model_path: PathBuf,
}

impl WhisperEngine {
    pub fn new(model_path: &Path) -> Result<Self>;
    pub fn transcribe(&self, audio: &[f32]) -> Result<Vec<Segment>>;
}

pub struct Segment {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub is_final: bool,
}
```

### 3. Model Manager (`src-tauri/src/whisper/models.rs`)

**Responsibility:** Download, store, and manage Whisper model files.

**Model storage location:** `~/Library/Application Support/com.omwhisper.app/models/`

**Features:**
- Download models from Hugging Face with progress reporting
- Verify downloads with SHA256 checksums
- List available vs. downloaded models
- Delete models to free space
- Report download progress to frontend

```rust
pub struct ModelInfo {
    pub name: String,           // "small.en"
    pub size_bytes: u64,        // 466_000_000
    pub sha256: String,
    pub is_downloaded: bool,
    pub is_english_only: bool,
}

pub async fn download_model(name: &str, progress: impl Fn(f64)) -> Result<PathBuf>;
pub fn list_models() -> Vec<ModelInfo>;
pub fn delete_model(name: &str) -> Result<()>;
```

### 4. License Manager (`src-tauri/src/license/`)

**Responsibility:** Validate and store license keys.

**How it works with Lemon Squeezy:**

1. User purchases on your landing page → Lemon Squeezy emails them a license key
2. User enters key in OmWhisper → app calls Lemon Squeezy API to validate
3. On success, store the key + validation timestamp in macOS Keychain
4. On each app launch, check if last validation was <7 days ago
5. If >7 days, re-validate online (with 30-day grace period for offline)

**Free tier enforcement:**
- Track daily usage in a local SQLite database
- Reset at midnight local time
- No server needed — we trust the user's clock (good enough for a $12 product)

```rust
pub enum LicenseStatus {
    Free { minutes_remaining_today: u32 },
    Licensed { key: String, valid_until: DateTime },
    Expired { key: String },
}

pub fn check_license() -> Result<LicenseStatus>;
pub async fn activate_license(key: &str) -> Result<LicenseStatus>;
pub fn deactivate_license() -> Result<()>;
```

### 5. Tauri Commands (`src-tauri/src/commands.rs`)

**Responsibility:** Bridge between React frontend and Rust backend.

These are the functions the frontend can call:

```rust
#[tauri::command]
async fn start_transcription(model: String) -> Result<(), String>;

#[tauri::command]
async fn stop_transcription() -> Result<(), String>;

#[tauri::command]
async fn get_available_models() -> Result<Vec<ModelInfo>, String>;

#[tauri::command]
async fn download_model(name: String) -> Result<(), String>;

#[tauri::command]
async fn activate_license(key: String) -> Result<LicenseStatus, String>;

#[tauri::command]
async fn get_license_status() -> Result<LicenseStatus, String>;

#[tauri::command]
async fn get_settings() -> Result<Settings, String>;

#[tauri::command]
async fn update_settings(settings: Settings) -> Result<(), String>;
```

**Events (Rust → Frontend):**
```rust
// Emitted when new transcription text is available
app.emit("transcription-update", Segment { ... });

// Emitted during model download
app.emit("download-progress", ProgressPayload { percent: 0.45 });

// Emitted when audio level changes (for visualizer)
app.emit("audio-level", AudioLevel { rms: 0.3 });
```

---
layout: default

## Frontend Architecture

### State Management (Zustand)

```typescript
interface AppState {
  // Transcription
  isRecording: boolean;
  segments: Segment[];
  interimText: string;

  // Models
  models: ModelInfo[];
  activeModel: string;
  downloadProgress: number | null;

  // License
  licenseStatus: LicenseStatus;

  // Settings
  settings: Settings;

  // Actions
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  activateLicense: (key: string) => Promise<void>;
}
```

### Key Components

**TranscriptionView** — Main window showing live transcription text. Interim text shown in gray, final text in white/black.

**FloatingOverlay** — Small, always-on-top window near the cursor showing current transcription. Think of it like a tooltip that follows your dictation.

**ModelManager** — Settings panel for downloading/selecting models. Shows size, accuracy tradeoff, download progress.

**Onboarding** — First-run flow: mic permission → model download → try it out → optional license activation.

**LicenseActivation** — Simple form: paste key, click activate, see confirmation.

---
layout: default

## Data Storage

| Data              | Location                                          | Format    |
|-------------------|---------------------------------------------------|-----------|
| Models            | ~/Library/Application Support/com.omwhisper/models | .bin      |
| Settings          | ~/Library/Application Support/com.omwhisper/       | JSON      |
| Usage stats       | ~/Library/Application Support/com.omwhisper/       | SQLite    |
| License key       | macOS Keychain                                      | Encrypted |
| Transcription log | ~/Library/Application Support/com.omwhisper/logs   | JSON      |

---
layout: default

## Performance Targets

| Metric                     | Target              | How to Measure              |
|----------------------------|---------------------|-----------------------------|
| App startup time           | < 1 second          | Time to menu bar icon       |
| Transcription latency      | < 500ms             | Speech end → text appears   |
| Memory usage (idle)        | < 50 MB             | Activity Monitor            |
| Memory usage (transcribing)| < 500 MB (small.en) | Activity Monitor            |
| CPU during transcription   | < 30% (M1/M2)      | Activity Monitor            |
| Battery impact             | Minimal when idle   | Energy tab in Activity Mon  |

---
layout: default

## Security Considerations

- **Audio never leaves the device** — all processing is local
- **License key stored in macOS Keychain** — not in plain text files
- **No telemetry by default** — opt-in only
- **No network calls except:** license validation (Lemon Squeezy API) and model downloads (Hugging Face)
- **Models verified by SHA256 checksum** after download
