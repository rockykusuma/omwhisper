# Built-in LLM Backend for Smart Dictation

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Add a `built_in` llama.cpp backend to Smart Dictation so users without Ollama can use AI cleanup out of the box.

---

## Problem

Smart Dictation currently requires either Ollama (external install + running process) or a Cloud API key. Both have friction. Most new users land on `Disabled` and never experience AI cleanup. This feature closes that gap.

---

## Solution

Add a `built_in` backend that uses `llama-cpp-2` (Rust crate wrapping llama.cpp) with Metal GPU support. Users download a single ~400MB GGUF model inside OmWhisper — no external tools needed. If Ollama is already configured, nothing changes.

---

## Implementation Spike (Before Any Other Code)

Before writing any feature code, validate that `llama-cpp-2` with `features = ["metal"]` compiles and dispatches to Metal on Apple Silicon. The crate requires linking against `Metal.framework`, `MetalKit.framework`, and `Accelerate.framework`. If the crate's build script does not emit these automatically, `build.rs` must add:

```rust
println!("cargo:rustc-link-lib=framework=Metal");
println!("cargo:rustc-link-lib=framework=MetalKit");
println!("cargo:rustc-link-lib=framework=Accelerate");
```

Confirm Metal dispatch is active (not silently falling back to CPU) before proceeding with the rest of the implementation.

The `build.rs` link flags must be emitted conditionally:

```rust
#[cfg(target_os = "macos")]
{
    println!("cargo:rustc-link-lib=framework=Metal");
    println!("cargo:rustc-link-lib=framework=MetalKit");
    println!("cargo:rustc-link-lib=framework=Accelerate");
}
```

---

## Section 1: Settings & Data Model

### `settings.rs` — three new fields

```rust
ai_backend: String,      // adds "built_in" alongside "disabled"/"ollama"/"cloud"
llm_model_name: String,  // active GGUF filename, default: "qwen2.5-0.5b-instruct-q4_k_m.gguf"
llm_nudge_shown: bool,   // one-time banner flag, default: false
```

### `src/types/index.ts` — two new fields on `AppSettings`

```typescript
llm_model_name: string;
llm_nudge_shown: boolean;
```

**Default model:** Qwen2.5-0.5B-Instruct Q4_K_M
**Download URL:** `https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf`
**Size:** ~400MB
**SHA256:** Compute and hardcode during implementation spike (download, run `sha256sum`, embed in catalog).
**Memory footprint:** ~900MB total with Whisper small.en (within 2GB budget)

### LLM model storage paths

**Production:**
```
~/Library/Application Support/com.omwhisper.app/models/llm/
```
**Dev fallback** (mirrors `whisper/models.rs` pattern):
```
{project_root}/models/llm/
```
Resolution order: check app data dir first, fall back to project-root dev path. Kept separate from Whisper models.

---

## Section 2: Rust Backend

### Tauri-managed state (separate from `TranscriptionState`)

`LlmEngine` must NOT live inside `TranscriptionState` / the existing `SharedState` mutex. Inference blocks the calling thread for several seconds — holding the shared mutex during inference would deadlock the shortcut handlers.

Instead, register a separate Tauri-managed state:

```rust
// In lib.rs setup:
app.manage(Arc::new(Mutex::new(Option::<LlmEngine>::None)));
```

Commands that need the engine take it as a separate `tauri::State<Arc<Mutex<Option<LlmEngine>>>>` parameter.

### Engine load timing — eager on backend selection

`LlmEngine` is loaded **eagerly** when the user switches `ai_backend` to `"built_in"`, and on app launch if `ai_backend == "built_in"` and the model file exists. This avoids a cold-load stall mid-dictation.

If `polish_text_cmd` is called and the engine is `None` (model not downloaded, or load failed), return error string `"llm_not_ready"` — the frontend maps this to a toast: *"AI model not ready — check AI Models settings."*

### New file: `src-tauri/src/ai/llm.rs`

Placed under `src-tauri/src/ai/` to stay consistent with the existing module layout (`ai/mod.rs`, `ai/ollama.rs`, `ai/cloud.rs`). Exposed via `pub mod llm;` in `ai/mod.rs`.

```rust
pub struct LlmEngine {
    model: llama_cpp_2::LlamaModel,
    context: llama_cpp_2::LlamaContext,
}

impl LlmEngine {
    pub fn new(model_path: &Path) -> Result<Self>   // loads GGUF, enables Metal
    pub fn polish(&self, raw: &str, style: &str, vocab: &[String]) -> Result<String>
}
```

- Max output tokens: 256 (bounds latency regardless of input length)
- Metal GPU via `llama-cpp-2`'s `metal` feature flag

### New Tauri commands in `commands.rs`

| Command | Returns | Purpose |
|---------|---------|---------|
| `download_llm_model(name: String)` | `Result<(), String>` | Streams download, emits `llm-download-progress` events, verifies SHA256 |
| `delete_llm_model(name: String)` | `Result<(), String>` | Deletes GGUF file from disk |
| `get_llm_models()` | `Vec<LlmModelInfo>` | Lists downloaded models |
| `get_llm_models_disk_usage()` | `u64` | Total bytes used by LLM models |
| `load_llm_engine(name: String)` | `Result<(), String>` | Loads model into managed state; called by frontend on backend selection and on app start |

### `LlmModelInfo` struct

```rust
#[derive(serde::Serialize)]
pub struct LlmModelInfo {
    pub name: String,           // filename, e.g. "qwen2.5-0.5b-instruct-q4_k_m.gguf"
    pub size_bytes: u64,
    pub size_label: String,     // e.g. "387 MB"
    pub is_downloaded: bool,
    pub is_active: bool,        // matches settings.llm_model_name
}
```

### Modified: `polish_text_cmd`

The current `polish_text_cmd` in `commands.rs` delegates to `crate::ai::polish(request, &settings)`, which has no `AppHandle` parameter and cannot access Tauri-managed state. The `built_in` branch must be intercepted **at the command level**, before calling `ai::polish`:

```rust
#[tauri::command]
pub async fn polish_text_cmd(app: tauri::AppHandle, ...) -> Result<String, String> {
    let settings = load_settings().await;
    if settings.ai_backend == "built_in" {
        let engine_state = app.state::<Arc<Mutex<Option<LlmEngine>>>>();
        let guard = engine_state.lock().unwrap();
        return match guard.as_ref() {
            Some(engine) => engine.polish(&raw, &style, &vocab),
            None => Err("llm_not_ready".to_string()),
        };
    }
    // existing delegation for ollama / cloud
    crate::ai::polish(request, &settings).await
}
```

`ai::polish` is not modified — it continues to handle `ollama` and `cloud` unchanged.

---

## Section 3: Smart Prompt / Auto-Detection Flow

On app launch in `lib.rs`, spawned as an async task after existing startup tasks:

```rust
tokio::time::timeout(Duration::from_secs(3), check_ollama_running())
```

Both timeout AND error are treated as "Ollama not running" for nudge purposes.

```
if llm_nudge_shown == false
   AND ai_backend == "disabled"
   AND (ollama_check times out OR returns not running)
→ emit "show-llm-nudge" to frontend
→ set llm_nudge_shown = true, save settings immediately
```

**Banner text:**
> **Enable AI cleanup** — Download a 400MB model to automatically fix punctuation, remove filler words, and polish your dictation. No internet required after download.
> `[ Download & Enable ]` `[ Not now ]`

**"Download & Enable":**
1. Sets `ai_backend = "built_in"`, saves settings
2. Calls `download_llm_model` with default model name
3. Navigates to AI Models → Smart Dictation tab to show download progress
4. On download complete, calls `load_llm_engine`

**"Not now":** Dismisses. `llm_nudge_shown` already `true` — banner never reappears.

**Users with Ollama or Cloud configured** (`ai_backend != "disabled"`) never see the nudge.

---

## Section 4: Frontend Changes

### `AiModelsView.tsx` — SmartDictation tab

**Backend selector** gains `built_in` between Disabled and Ollama:
```
Disabled | Built-in | On-Device (Ollama) | Cloud API
```

When `built_in` selected, show "Local Model" section:
- Lists downloaded GGUF models (`get_llm_models()`) with name, size, active indicator
- Download button for default model if not downloaded
- Download progress bar (reuses same pattern as Whisper model downloads, event: `llm-download-progress`)
- "Add custom model" — file picker via `tauri-plugin-dialog`. Selected file is **copied** into `models/llm/` (not referenced in-place — avoids broken references if user moves the file)

**Timeout setting row** is hidden when `built_in` is selected (it governs HTTP timeouts irrelevant to local inference).

**On backend switch to `built_in`:** call `load_llm_engine(settings.llm_model_name)` if model is downloaded.

### `App.tsx`

Listen for `show-llm-nudge` event. Render dismissible banner using same pattern as existing DMG warning and update banners.

### `Settings.tsx`

No changes required.

---

## Files Changed

| File | Type | Change |
|------|------|--------|
| `src-tauri/Cargo.toml` | Modify | Add `llama-cpp-2` with `metal` feature |
| `src-tauri/build.rs` | Modify (if needed) | Add Metal framework link flags if crate doesn't emit them |
| `src-tauri/src/settings.rs` | Modify | 3 new fields + defaults |
| `src-tauri/src/ai/llm.rs` | **New** | LlmEngine, LlmModelInfo, model path resolution |
| `src-tauri/src/ai/mod.rs` | Modify | Add `pub mod llm;` |
| `src-tauri/src/commands.rs` | Modify | 5 new commands + `polish_text_cmd` built-in branch |
| `src-tauri/src/lib.rs` | Modify | Register LlmEngine managed state, nudge check on startup, eager load on launch |
| `src/types/index.ts` | Modify | Add `llm_model_name` and `llm_nudge_shown` to `AppSettings` |
| `src/components/AiModelsView.tsx` | Modify | Built-in backend UI, local model section, load engine on switch |
| `src/App.tsx` | Modify | Nudge banner event handler |

---

## Constraints

- macOS only (Metal GPU via `llama-cpp-2`)
- Intel Mac fallback: CPU-only inference (slower, functional)
- Memory budget: Whisper small.en (~460MB) + Qwen2.5-0.5B (~400MB) = ~900MB — within 2GB target
- Entire pipeline works offline after initial model download
- GGUF format only
- Max output tokens: 256

## Out of Scope

- Streaming partial LLM output to UI
- Automatic model updates
- Windows/Linux support
- Bundling the model inside the app binary
