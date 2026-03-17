# Windows Support Sub-project 3: Disable Built-in LLM on Windows — Design Spec

**Date:** 2026-03-17
**Branch:** feature/windows-support
**Status:** Approved

---

## Goal

Prevent the built-in on-device LLM backend (`llama-cpp-2` / Metal) from being compiled, registered, or shown to users on Windows. On Windows, Smart Dictation remains available via Ollama and Cloud API backends only.

This is Sub-project 3 of 5 in the Windows support effort.

---

## Background

The built-in LLM backend uses `llama-cpp-2` with `features = ["metal"]` for Metal GPU acceleration on Apple Silicon. Metal is a macOS-only graphics/compute API — the `metal` feature will not compile on Windows.

Current problems on Windows:
- `llama-cpp-2 = { version = "0.1.138", features = ["metal"] }` is an unconditional dep → build fails on Windows.
- `LlmEngine::new()` calls `with_n_gpu_layers(u32::MAX)` to offload all layers to Metal → meaningless on non-Apple hardware.
- `LlmEngineState` is registered as a Tauri managed state unconditionally → will panic if `LlmEngine` type is unavailable.
- The eager LlmEngine load at startup runs unconditionally → Windows build fails.
- The AI settings UI exposes "Built-in" as a backend option unconditionally → Windows users would see a non-functional option.

---

## Scope

This sub-project covers:
- Gating the `llama-cpp-2` Cargo dependency as macOS-only
- Gating `LlmEngine`, `build_polish_system_prompt`, and their tests behind `#[cfg(target_os = "macos")]`
- Gating `LlmEngineState`, `load_llm_engine`, `unload_llm_engine`, the `built_in` branch in `polish_text_cmd`, and their `lib.rs` wiring behind `#[cfg(target_os = "macos")]`
- Hiding the "Built-in" option in the AI settings UI on Windows

**Out of scope:**
- CPU-only built-in inference on Windows (deferred indefinitely; Ollama + Cloud cover Windows users)
- Changes to `ai/mod.rs`, `ai/ollama.rs`, `ai/cloud.rs` — these are platform-neutral HTTP backends, unaffected
- Changes to `settings.rs` — `ai_backend`, `llm_model_name` fields remain in the struct; Windows simply never acts on them
- Forced reset of `ai_backend` to `"disabled"` on Windows startup — if a user has `"built_in"` in `settings.json`, `polish_text_cmd` returns a clear error rather than silently resetting

---

## Architecture

Five files change. No new files.

### Guard choice: `#[cfg(target_os = "macos")]`

Metal is permanently macOS-only. Unlike PTT (which used `not(windows)` to leave a Linux door open), the built-in LLM backend uses Metal GPU offload that can never work on non-Apple hardware without a complete rewrite. Using `target_os = "macos"` is the accurate, honest guard and avoids pretending Linux support is plausible.

---

## Files Changed

### 1. `src-tauri/Cargo.toml`

Move `llama-cpp-2` from `[dependencies]` into a new `[target.'cfg(target_os = "macos")'.dependencies]` section:

**Remove from `[dependencies]`:**
```toml
llama-cpp-2 = { version = "0.1.138", features = ["metal"] }
```

**Add after the existing `[target.'cfg(target_os = "windows")'.dependencies]` section:**
```toml
[target.'cfg(target_os = "macos")'.dependencies]
llama-cpp-2 = { version = "0.1.138", features = ["metal"] }
```

This prevents `llama-cpp-2` from being resolved or compiled on Windows (or Linux).

---

### 2. `src-tauri/src/ai/llm.rs`

The top portion of `llm.rs` (model catalog, path utilities, download, delete, import, list) does **not** use `llama-cpp-2` and remains ungated — it compiles on all platforms.

The bottom portion (lines 209–403) uses `llama-cpp-2` and must be gated. Wrap the following in `#[cfg(target_os = "macos")]` blocks:

**Block A — `use llama_cpp_2` import + `LlmEngine` struct + `unsafe impl Send/Sync` + `impl LlmEngine`:**

```rust
#[cfg(target_os = "macos")]
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
    sampling::LlamaSampler,
};

#[cfg(target_os = "macos")]
pub struct LlmEngine {
    backend: LlamaBackend,
    model: LlamaModel,
}

#[cfg(target_os = "macos")]
unsafe impl Send for LlmEngine {}
#[cfg(target_os = "macos")]
unsafe impl Sync for LlmEngine {}

#[cfg(target_os = "macos")]
impl LlmEngine {
    // ... existing impl unchanged ...
}
```

**Block B — `build_polish_system_prompt` function:**

```rust
#[cfg(target_os = "macos")]
fn build_polish_system_prompt(style: &str, vocab: &[String]) -> String {
    // ... existing body unchanged ...
}
```

**Block C — The two tests that call `build_polish_system_prompt`:**

In the `#[cfg(test)]` module, wrap `polish_prompt_contains_style_instruction` and `polish_prompt_includes_vocabulary` with `#[cfg(target_os = "macos")]`. The other seven tests (model catalog, path, download URL) remain ungated.

---

### 3. `src-tauri/src/commands.rs`

Three changes:

**Change A — Gate `LlmEngineState` type alias:**
```rust
#[cfg(target_os = "macos")]
type LlmEngineState = std::sync::Arc<std::sync::Mutex<Option<crate::ai::llm::LlmEngine>>>;
```

**Change B — Gate `load_llm_engine` and `unload_llm_engine` commands:**
```rust
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn load_llm_engine(...) -> Result<(), String> { ... }

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn unload_llm_engine(...) -> Result<(), String> { ... }
```

**Change C — Gate the `built_in` branch in `polish_text_cmd`:**

Replace the current ungated `built_in` intercept with a macOS-only block. On non-macOS, a `built_in` backend setting returns a clear error:

```rust
#[cfg(target_os = "macos")]
if settings.ai_backend == "built_in" {
    let engine_state = app.state::<LlmEngineState>();
    let vocab = settings.custom_vocabulary.clone();
    let result: anyhow::Result<String> = {
        let guard = engine_state.lock().unwrap();
        match guard.as_ref() {
            Some(engine) => engine.polish(&text, &style, &vocab),
            None => return Err("llm_not_ready".to_string()),
        }
    };
    return result.map_err(|e: anyhow::Error| e.to_string());
}

#[cfg(not(target_os = "macos"))]
if settings.ai_backend == "built_in" {
    return Err("On-Device LLM is not available on Windows".to_string());
}
```

---

### 4. `src-tauri/src/lib.rs`

Four changes:

**Change A — Gate the import of `load_llm_engine`/`unload_llm_engine` (around line 29–30):**
```rust
#[cfg(target_os = "macos")]
use crate::commands::{load_llm_engine, unload_llm_engine};
```
(Or wrap the relevant portion of the existing use statement.)

**Change B — Gate `LlmEngine` managed state registration (around lines 144–150):**
```rust
#[cfg(target_os = "macos")]
let builder = builder.manage(std::sync::Arc::new(std::sync::Mutex::new(
    Option::<crate::ai::llm::LlmEngine>::None,
)));
```

Note: `tauri::Builder::default()` uses a builder pattern. Since `.manage(...)` is a chained call, the macOS gate needs to be applied to that specific `.manage(...)` call without breaking the chain. The idiomatic approach is to assign the intermediate builder to a variable:

```rust
let builder = tauri::Builder::default()
    .manage(shared_state.clone());

#[cfg(target_os = "macos")]
let builder = builder.manage(std::sync::Arc::new(std::sync::Mutex::new(
    Option::<crate::ai::llm::LlmEngine>::None,
)));

let builder = builder
    .plugin(tauri_plugin_shell::init())
    // ... rest of chain ...
```

**Change C — Gate the eager LlmEngine load block (around lines 568–591):**
```rust
#[cfg(target_os = "macos")]
{
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        // ... existing eager load body unchanged ...
    });
}
```

**Change D — Gate `load_llm_engine, unload_llm_engine` entries in `generate_handler!` (around lines 684–685):**

In the `generate_handler!([...])` list, wrap the two entries:
```rust
            #[cfg(target_os = "macos")]
            load_llm_engine,
            #[cfg(target_os = "macos")]
            unload_llm_engine,
```

---

### 5. `src/components/AiModelsView.tsx`

In the `SmartDictationTab` component, add `platform` state and filter `"built_in"` from the backend list on Windows.

**Change A — Add `platform` state after existing `useState` declarations:**
```typescript
const [platform, setPlatform] = useState<string>("macos");

useEffect(() => {
  invoke<string>("get_platform").then(setPlatform).catch(() => {});
}, []);
```

Default `"macos"` ensures the built-in option is visible during the brief async fetch on macOS.

**Change B — Filter backend list in the selector:**

Change:
```tsx
{(["disabled", "built_in", "ollama", "cloud"] as const).map((b) => (
```

To:
```tsx
{(["disabled", "built_in", "ollama", "cloud"] as const)
  .filter((b) => !(b === "built_in" && platform === "windows"))
  .map((b) => (
```

No other UI changes needed — the `built_in` panel (shown when `settings.ai_backend === "built_in"`) will never appear on Windows since the option is filtered out.

---

## Behavior After This Change

| Scenario | Before | After |
|----------|--------|-------|
| Windows build — compile | Fails (`metal` feature) | Succeeds |
| Windows runtime — `"built_in"` in settings.json | Panic / crash | Returns `"On-Device LLM is not available on Windows"` |
| Windows runtime — AI settings UI | Shows "Built-in" option | "Built-in" option hidden |
| macOS — all LLM behavior | Unchanged | Unchanged |
| Linux build | Fails (`metal` feature) | Succeeds (llama-cpp-2 not compiled) |

---

## Out of Scope

- CPU-only inference on Windows or Linux
- Resetting `ai_backend` on Windows startup
- Changes to `ai/mod.rs`, `ai/ollama.rs`, `ai/cloud.rs`
- Changes to `settings.rs`
