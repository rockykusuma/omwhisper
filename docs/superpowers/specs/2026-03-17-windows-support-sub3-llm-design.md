# Windows Support Sub-project 3: Disable Built-in LLM on Windows — Design Spec

**Date:** 2026-03-17
**Branch:** feature/windows-support
**Status:** Approved

---

## Goal

Prevent the built-in on-device LLM backend (`llama-cpp-2` / Metal) from being compiled, registered, or shown to users on Windows or Linux. On non-macOS, Smart Dictation remains available via Ollama and Cloud API backends only.

This is Sub-project 3 of 5 in the Windows support effort.

---

## Background

The built-in LLM backend uses `llama-cpp-2` with `features = ["metal"]` for Metal GPU acceleration on Apple Silicon. Metal is a macOS-only graphics/compute API — the `metal` feature will not compile on Windows or Linux.

Note: `whisper-rs` also has `features = ["metal"]` in `Cargo.toml`. This is addressed in Sub-project 5 (Whisper Windows build). This spec covers only `llama-cpp-2`.

Current problems on Windows:
- `llama-cpp-2 = { version = "0.1.138", features = ["metal"] }` is an unconditional dep → build fails on Windows.
- `LlmEngine::new()` calls `with_n_gpu_layers(u32::MAX)` to offload all layers to Metal → meaningless on non-Apple hardware.
- `LlmEngineState` is registered as a Tauri managed state unconditionally → will fail to compile when `LlmEngine` type is unavailable.
- The eager LlmEngine load at startup runs unconditionally → fails on Windows.
- The AI settings UI exposes "Built-in" as a backend option unconditionally → Windows/Linux users would see a non-functional option.

---

## Scope

This sub-project covers:
- Gating the `llama-cpp-2` Cargo dependency as macOS-only
- Gating `LlmEngine`, `build_polish_system_prompt`, and their tests behind `#[cfg(target_os = "macos")]`
- Gating `LlmEngineState`, `load_llm_engine`, `unload_llm_engine`, the `built_in` branch in `polish_text_cmd`, and their `lib.rs` wiring behind `#[cfg(target_os = "macos")]`
- Hiding the "Built-in" option in the AI settings UI on non-macOS platforms

**Out of scope:**
- `whisper-rs` Metal gating — covered by Sub-project 5
- CPU-only built-in inference on Windows or Linux (deferred indefinitely; Ollama + Cloud cover those platforms)
- Changes to `ai/mod.rs`, `ai/ollama.rs`, `ai/cloud.rs` — these are platform-neutral HTTP backends, unaffected
- Changes to `settings.rs` — `ai_backend`, `llm_model_name` fields remain in the struct; non-macOS simply never acts on them
- Forced reset of `ai_backend` to `"disabled"` on Windows startup — if a user has `"built_in"` in `settings.json`, `polish_text_cmd` returns a clear error rather than silently resetting

---

## Architecture

Five files change. No new files.

### Guard choice: `#[cfg(target_os = "macos")]`

Metal is permanently macOS-only. Unlike PTT (which used `not(windows)` to leave a Linux door open), the built-in LLM backend uses Metal GPU offload that can never work on non-Apple hardware without a complete rewrite. Using `target_os = "macos"` is the accurate, honest guard. The frontend filter uses `platform !== "macos"` (not `platform === "windows"`) for consistency — Linux users should not see a "Built-in" option that the backend doesn't compile for either.

---

## Files Changed

### 1. `src-tauri/Cargo.toml`

Move `llama-cpp-2` from `[dependencies]` into a new `[target.'cfg(target_os = "macos")'.dependencies]` section.

**Remove from `[dependencies]`:**
```toml
llama-cpp-2 = { version = "0.1.138", features = ["metal"] }
```

**Add after the existing `[target.'cfg(target_os = "windows")'.dependencies]` section:**
```toml
[target.'cfg(target_os = "macos")'.dependencies]
llama-cpp-2 = { version = "0.1.138", features = ["metal"] }
```

This prevents `llama-cpp-2` from being resolved or compiled on Windows or Linux.

---

### 2. `src-tauri/src/ai/llm.rs`

The top portion of `llm.rs` (model catalog, path utilities, download, delete, import, list — approximately lines 1–206) does **not** use `llama-cpp-2` and remains ungated — it compiles on all platforms.

The bottom portion (starting at the `use llama_cpp_2` import, approximately line 209) uses `llama-cpp-2` and must be gated. Each top-level item needs its own `#[cfg]` attribute — Rust does not support wrapping multiple top-level items in a single cfg block (only `mod {}` or a block expression supports that).

**Block A — `use llama_cpp_2` import:**
```rust
#[cfg(target_os = "macos")]
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
    sampling::LlamaSampler,
};
```

**Block B — `LlmEngine` struct + `unsafe impl Send` + `unsafe impl Sync` + `impl LlmEngine`:**
```rust
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

**Block C — `build_polish_system_prompt` function:**
```rust
#[cfg(target_os = "macos")]
fn build_polish_system_prompt(style: &str, vocab: &[String]) -> String {
    // ... existing body unchanged ...
}
```

**Block D — Two tests that call `build_polish_system_prompt`:**

In the `#[cfg(test)]` module, add `#[cfg(target_os = "macos")]` to `polish_prompt_contains_style_instruction` and `polish_prompt_includes_vocabulary`. The other seven tests (model catalog, path utilities, download URL) remain ungated and run on all platforms.

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
pub async fn load_llm_engine(
    name: String,
    engine_state: tauri::State<'_, LlmEngineState>,
) -> Result<(), String> { /* existing body unchanged */ }

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn unload_llm_engine(
    engine_state: tauri::State<'_, LlmEngineState>,
) -> Result<(), String> { /* existing body unchanged */ }
```

**Change C — Gate the `built_in` branch in `polish_text_cmd`:**

Note: `use crate::ai::llm as llm_models;` at line 321 of `commands.rs` is intentionally left **ungated** — it aliases the catalog/download/delete functions in the top portion of `llm.rs` (lines 1–206), which are platform-neutral and remain ungated. Only `LlmEngine` and the inference engine code below line 207 are gated.

The `built_in` intercept block (currently ungated) references `LlmEngineState`, which is macOS-only. Replace the existing block with a two-branch cfg split:

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
    return Err("On-Device LLM is not available on this platform".to_string());
}
```

The `app.state::<LlmEngineState>()` call inside the first block is safe because both it and the `LlmEngineState` type are gated behind the same `#[cfg(target_os = "macos")]`.

---

### 4. `src-tauri/src/lib.rs`

Four changes. The current code uses a long chained builder expression (`tauri::Builder::default().manage(...).plugin(...).setup(...)`). Changes B requires breaking that chain into intermediate `let builder` bindings — this restructures the builder from a single-expression chain into a multi-statement form.

**Change A — Gate `load_llm_engine`/`unload_llm_engine` imports:**

These two items are currently inside a compound `use crate::commands::{...}` block alongside ~30 other symbols (around lines 15–33). Extract them into a separate gated `use` statement and remove them from the compound block:

```rust
// In the existing compound use block, REMOVE: load_llm_engine, unload_llm_engine

// Add a separate gated import:
#[cfg(target_os = "macos")]
use crate::commands::{load_llm_engine, unload_llm_engine};
```

**Change B — Gate `LlmEngine` managed state registration:**

The current code has `.manage(Arc::new(Mutex::new(Option::<crate::ai::llm::LlmEngine>::None)))` chained inline on `tauri::Builder::default()`. Break the chain into intermediate variables:

```rust
let builder = tauri::Builder::default()
    .manage(shared_state.clone());

#[cfg(target_os = "macos")]
let builder = builder.manage(std::sync::Arc::new(std::sync::Mutex::new(
    Option::<crate::ai::llm::LlmEngine>::None,
)));

let builder = builder
    .plugin(tauri_plugin_shell::init())
    // ... rest of the chain continues unchanged ...
```

The chain must be split at the `.manage(LlmEngine)` call point and reassembled. All other `.plugin()`, `.setup()`, and terminal calls continue on the final `builder` variable.

**Change C — Gate the eager LlmEngine load block:**

The block starting with `// Eagerly load LlmEngine on launch if built_in backend is configured` (approximately lines 568–593) contains a fully-qualified reference to `crate::ai::llm::LlmEngine` that will not compile when `LlmEngine` is ungated. Wrap the entire block:

```rust
#[cfg(target_os = "macos")]
{
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        // ... existing body unchanged ...
    });
}
```

**Change D — Gate `load_llm_engine`/`unload_llm_engine` in `generate_handler!`:**

Tauri's `generate_handler!` procedural macro supports `#[cfg]` attributes on individual entries. Add per-item guards:

```rust
            #[cfg(target_os = "macos")]
            load_llm_engine,
            #[cfg(target_os = "macos")]
            unload_llm_engine,
```

---

### 5. `src/components/AiModelsView.tsx`

In the `SmartDictationTab` component, add `platform` state and filter `"built_in"` from the backend list on non-macOS platforms. The `get_platform` Tauri command was added in Sub-project 1 and returns `"macos"`, `"windows"`, or `"linux"`.

**Change A — Add `platform` state after existing `useState` declarations:**
```typescript
const [platform, setPlatform] = useState<string>("macos");

useEffect(() => {
  invoke<string>("get_platform").then(setPlatform).catch(() => {});
}, []);
```

Default `"macos"` ensures the built-in option is visible during the brief async fetch on macOS — no flash of hidden content.

**Change B — Filter backend list in the selector and handle ghost state:**

The backend buttons use `settings.ai_backend === b` to highlight the active option. If a user previously set `ai_backend = "built_in"` on macOS and their `settings.json` is loaded on Windows/Linux, `"built_in"` is filtered out but the stored value remains `"built_in"` — no button will appear highlighted (ghost state). Fix this at the same time by computing an `effectiveBackend` for display purposes:

```tsx
// Compute effective backend for display: treat built_in as disabled on non-macOS
const effectiveBackend = (settings.ai_backend === "built_in" && platform !== "macos")
  ? "disabled"
  : settings.ai_backend;
```

Then use `effectiveBackend` instead of `settings.ai_backend` in the active-state check on each button:

```tsx
{(["disabled", "built_in", "ollama", "cloud"] as const)
  .filter((b) => !(b === "built_in" && platform !== "macos"))
  .map((b) => (
    <button
      key={b}
      onClick={...}
      style={{
        background: effectiveBackend === b ? "rgba(139,92,246,0.15)" : "transparent",
        color: effectiveBackend === b ? "rgb(167,139,250)" : "var(--t3)",
      }}
    >
      ...
    </button>
  ))}
```

This only affects the highlighted styling — the actual `settings.ai_backend` value in state is not changed. On Windows, the `polish_text_cmd` backend returns a clear error for `"built_in"` (see commands.rs Change C), so Smart Dictation will not silently succeed.

Using `platform !== "macos"` (not `platform === "windows"`) ensures Linux users also don't see the "Built-in" option, consistent with the Rust-side `#[cfg(target_os = "macos")]` guard that prevents `llama-cpp-2` from compiling on Linux too.

---

## Behavior After This Change

| Scenario | Before | After |
|----------|--------|-------|
| Windows build — compile | Fails (`metal` feature) | Succeeds |
| Linux build — compile | Fails (`metal` feature) | Succeeds |
| Windows/Linux runtime — `"built_in"` in settings.json | Compile failure | Returns `"On-Device LLM is not available on this platform"` |
| Windows/Linux — AI settings UI | Shows "Built-in" option | "Built-in" option hidden |
| macOS — all LLM behavior | Unchanged | Unchanged |

---

## Out of Scope

- `whisper-rs` Metal gating — covered by Sub-project 5
- CPU-only inference on Windows or Linux
- Resetting `ai_backend` on non-macOS startup
- Changes to `ai/mod.rs`, `ai/ollama.rs`, `ai/cloud.rs`
- Changes to `settings.rs`
