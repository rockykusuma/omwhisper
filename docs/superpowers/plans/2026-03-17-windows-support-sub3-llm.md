# Windows Support Sub-project 3: Disable Built-in LLM on Windows — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `llama-cpp-2` (Metal GPU) from compiling or running on Windows/Linux by gating all built-in LLM code behind `#[cfg(target_os = "macos")]` and hiding the "Built-in" backend option from the AI settings UI on non-macOS platforms.

**Architecture:** Five targeted changes — move the `llama-cpp-2` dep to a macOS-only Cargo section, gate the `LlmEngine` struct and inference code in `ai/llm.rs`, gate commands and managed state in `commands.rs` and `lib.rs`, and filter the "Built-in" UI option in `AiModelsView.tsx`. No new files. No new commands.

**Tech Stack:** Rust (`#[cfg(target_os = "macos")]` attribute), React/TypeScript (`useState`, `invoke`), Cargo target-specific deps

**Spec:** `docs/superpowers/specs/2026-03-17-windows-support-sub3-llm-design.md`

---

## Chunk 1: All changes (Rust + Frontend)

### Task 1: Gate llama-cpp-2 dep + LlmEngine in ai/llm.rs

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/ai/llm.rs:209–403`

**Context:** `llama-cpp-2` is currently declared unconditionally in `[dependencies]` at line 34 of `Cargo.toml`. The inference engine block in `ai/llm.rs` begins at line 207 (comment section header), with the `use llama_cpp_2` import at lines 209–215, followed by the `LlmEngine` struct (line 217), `unsafe impl Send/Sync` (lines 225–226), `impl LlmEngine` (line 228–306), `build_polish_system_prompt` function (lines 308–336), and tests at lines 340–403. The model catalog, path utilities, download/delete functions in lines 1–205 do NOT use `llama-cpp-2` and must remain ungated.

- [ ] **Step 1: Move llama-cpp-2 dep to macOS-only in Cargo.toml**

Find and remove this line from `[dependencies]`:
```toml
llama-cpp-2 = { version = "0.1.138", features = ["metal"] }
```

Add a new section after the existing `[target.'cfg(target_os = "windows")'.dependencies]` block:
```toml
[target.'cfg(target_os = "macos")'.dependencies]
llama-cpp-2 = { version = "0.1.138", features = ["metal"] }
```

- [ ] **Step 2: Gate the `use llama_cpp_2` import in ai/llm.rs**

Find the current import at lines 209–215:
```rust
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
    sampling::LlamaSampler,
};
```

Replace with:
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

- [ ] **Step 3: Gate `LlmEngine` struct + `unsafe impl` blocks**

Find (lines 217–226):
```rust
pub struct LlmEngine {
    backend: LlamaBackend,
    model: LlamaModel,
}

// Safety: llama-cpp-2 wraps C++ that is not Send by default, but we only call
// inference from within a spawn_blocking context (one thread at a time) and the
// managed Mutex prevents concurrent access. This is safe for our usage pattern.
unsafe impl Send for LlmEngine {}
unsafe impl Sync for LlmEngine {}
```

Replace with:
```rust
#[cfg(target_os = "macos")]
pub struct LlmEngine {
    backend: LlamaBackend,
    model: LlamaModel,
}

// Safety: llama-cpp-2 wraps C++ that is not Send by default, but we only call
// inference from within a spawn_blocking context (one thread at a time) and the
// managed Mutex prevents concurrent access. This is safe for our usage pattern.
#[cfg(target_os = "macos")]
unsafe impl Send for LlmEngine {}
#[cfg(target_os = "macos")]
unsafe impl Sync for LlmEngine {}
```

- [ ] **Step 4: Gate `impl LlmEngine` block**

Find (line 228):
```rust
impl LlmEngine {
```

Replace with:
```rust
#[cfg(target_os = "macos")]
impl LlmEngine {
```

- [ ] **Step 5: Gate `build_polish_system_prompt` function**

Find (line 308):
```rust
fn build_polish_system_prompt(style: &str, vocab: &[String]) -> String {
```

Replace with:
```rust
#[cfg(target_os = "macos")]
fn build_polish_system_prompt(style: &str, vocab: &[String]) -> String {
```

- [ ] **Step 6: Gate the two tests that call `build_polish_system_prompt`**

Find (lines 389–402):
```rust
    #[test]
    fn polish_prompt_contains_style_instruction() {
        let prompt = build_polish_system_prompt("casual", &[]);
        assert!(prompt.contains("casual"), "casual style should affect prompt");
        assert!(prompt.contains("Output ONLY"), "prompt must end with output-only instruction");
    }

    #[test]
    fn polish_prompt_includes_vocabulary() {
        let vocab = vec!["OmWhisper".to_string(), "Tauri".to_string()];
        let prompt = build_polish_system_prompt("professional", &vocab);
        assert!(prompt.contains("OmWhisper"));
        assert!(prompt.contains("Tauri"));
    }
```

Replace with:
```rust
    #[cfg(target_os = "macos")]
    #[test]
    fn polish_prompt_contains_style_instruction() {
        let prompt = build_polish_system_prompt("casual", &[]);
        assert!(prompt.contains("casual"), "casual style should affect prompt");
        assert!(prompt.contains("Output ONLY"), "prompt must end with output-only instruction");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn polish_prompt_includes_vocabulary() {
        let vocab = vec!["OmWhisper".to_string(), "Tauri".to_string()];
        let prompt = build_polish_system_prompt("professional", &vocab);
        assert!(prompt.contains("OmWhisper"));
        assert!(prompt.contains("Tauri"));
    }
```

- [ ] **Step 7: Verify macOS build**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 8: Verify tests pass**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo test
```

Expected: all tests pass. The two gated tests will still run on macOS. The other 7 tests in `llm.rs` remain ungated and run on all platforms.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/ai/llm.rs
git commit -m "feat: gate llama-cpp-2 dep and LlmEngine as macOS-only"
```

---

### Task 2: Gate LlmEngine wiring in commands.rs and lib.rs

**Files:**
- Modify: `src-tauri/src/commands.rs:410–443` (`LlmEngineState`, `load_llm_engine`, `unload_llm_engine`) and `src-tauri/src/commands.rs:974–986` (the `built_in` branch in `polish_text_cmd`)
- Modify: `src-tauri/src/lib.rs:29–33` (compound `use` block), `src-tauri/src/lib.rs:142–153` (builder chain), `src-tauri/src/lib.rs:568–593` (eager load block), `src-tauri/src/lib.rs:684–685` (`generate_handler!` entries)

**Context:** The `LlmEngineState` type alias at `commands.rs:410` and the two commands at lines 412–443 must be gated. The `built_in` intercept block at `commands.rs:974–986` references `LlmEngineState` and must be replaced with a two-branch cfg split. In `lib.rs`, `load_llm_engine` and `unload_llm_engine` are imported as part of the 30-item compound `use commands::{...}` block (at lines 29–30) and must be extracted into a separate gated `use` statement. The builder chain at lines 142–148 must be broken into intermediate `let builder` variables to allow the macOS-only `.manage(LlmEngine)` call to be conditionally compiled. The eager load async block at lines 568–593 and the `generate_handler!` entries at lines 684–685 must also be gated.

- [ ] **Step 1: Gate `LlmEngineState` type alias in commands.rs**

Find (line 410):
```rust
type LlmEngineState = std::sync::Arc<std::sync::Mutex<Option<crate::ai::llm::LlmEngine>>>;
```

Replace with:
```rust
#[cfg(target_os = "macos")]
type LlmEngineState = std::sync::Arc<std::sync::Mutex<Option<crate::ai::llm::LlmEngine>>>;
```

- [ ] **Step 2: Gate `load_llm_engine` command in commands.rs**

Find (lines 412–433):
```rust
#[tauri::command]
pub async fn load_llm_engine(
    name: String,
    engine_state: tauri::State<'_, LlmEngineState>,
) -> Result<(), String> {
    let model_path = crate::ai::llm::llm_model_path(&name);
    if !model_path.exists() {
        return Err(format!("Model file not found: {}", name));
    }

    // Load is blocking (reads ~400MB from disk) — run on a blocking thread
    let engine = tokio::task::spawn_blocking(move || {
        crate::ai::llm::LlmEngine::new(&model_path)
    })
    .await
    .map_err(|e| format!("spawn_blocking error: {}", e))?
    .map_err(|e| e.to_string())?;

    let mut guard = engine_state.lock().unwrap();
    *guard = Some(engine);
    Ok(())
}
```

Replace with:
```rust
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn load_llm_engine(
    name: String,
    engine_state: tauri::State<'_, LlmEngineState>,
) -> Result<(), String> {
    let model_path = crate::ai::llm::llm_model_path(&name);
    if !model_path.exists() {
        return Err(format!("Model file not found: {}", name));
    }

    // Load is blocking (reads ~400MB from disk) — run on a blocking thread
    let engine = tokio::task::spawn_blocking(move || {
        crate::ai::llm::LlmEngine::new(&model_path)
    })
    .await
    .map_err(|e| format!("spawn_blocking error: {}", e))?
    .map_err(|e| e.to_string())?;

    let mut guard = engine_state.lock().unwrap();
    *guard = Some(engine);
    Ok(())
}
```

- [ ] **Step 3: Gate `unload_llm_engine` command in commands.rs**

Find (lines 435–443):
```rust
// Plan extension (not in spec — added for completeness to allow backend switching without restart)
#[tauri::command]
pub async fn unload_llm_engine(
    engine_state: tauri::State<'_, LlmEngineState>,
) -> Result<(), String> {
    let mut guard = engine_state.lock().unwrap();
    *guard = None;
    Ok(())
}
```

Replace with:
```rust
// Plan extension (not in spec — added for completeness to allow backend switching without restart)
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn unload_llm_engine(
    engine_state: tauri::State<'_, LlmEngineState>,
) -> Result<(), String> {
    let mut guard = engine_state.lock().unwrap();
    *guard = None;
    Ok(())
}
```

- [ ] **Step 4: Replace the `built_in` intercept in `polish_text_cmd` with cfg-split version**

Find (lines 974–986):
```rust
    // built_in is intercepted here — ai::polish has no access to managed state
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
```

Replace with:
```rust
    // built_in is intercepted here — ai::polish has no access to managed state
    // On macOS: use LlmEngine (Metal). On other platforms: return a clear error.
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

- [ ] **Step 5: Extract `load_llm_engine`/`unload_llm_engine` from the compound `use` block in lib.rs**

Find in `lib.rs` (lines 29–30 inside the compound `use commands::{...}` block):
```rust
    get_llm_models, get_llm_models_disk_usage, download_llm_model, delete_llm_model, import_llm_model,
    load_llm_engine, unload_llm_engine,
```

Remove `load_llm_engine, unload_llm_engine,` from that line. The surrounding lines should now read:
```rust
    get_llm_models, get_llm_models_disk_usage, download_llm_model, delete_llm_model, import_llm_model,
```

Then add a new gated `use` statement immediately after the closing `};` of the compound block (after line 33):
```rust
#[cfg(target_os = "macos")]
use commands::{load_llm_engine, unload_llm_engine};
```

- [ ] **Step 6: Break the builder chain to gate the LlmEngine `.manage()` call in lib.rs**

Find (lines 142–152):
```rust
    tauri::Builder::default()
        .manage(shared_state.clone())
        // Separate managed state for LlmEngine — must NOT be inside SharedState
        // because inference blocks the calling thread for several seconds — holding the shared mutex during inference would deadlock the shortcut handlers.
        .manage(std::sync::Arc::new(std::sync::Mutex::new(
            Option::<crate::ai::llm::LlmEngine>::None,
        )))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
```

Replace with:
```rust
    let builder = tauri::Builder::default()
        .manage(shared_state.clone());

    // Separate managed state for LlmEngine — must NOT be inside SharedState
    // because inference blocks the calling thread for several seconds — holding the shared mutex during inference would deadlock the shortcut handlers.
    // macOS-only: LlmEngine uses Metal GPU; not compiled on other platforms.
    #[cfg(target_os = "macos")]
    let builder = builder.manage(std::sync::Arc::new(std::sync::Mutex::new(
        Option::<crate::ai::llm::LlmEngine>::None,
    )));

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
```

Note: the remaining chain (`.plugin()`, `.setup()`, `.invoke_handler()`, `.run()`) continues on `builder` unchanged — only the LlmEngine `.manage()` call is conditionally inserted.

- [ ] **Step 7: Gate the eager LlmEngine load block in lib.rs**

Find (lines 568–593) — the block starts with the comment `// Eagerly load LlmEngine on launch if built_in backend is configured`:
```rust
            // Eagerly load LlmEngine on launch if built_in backend is configured
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let settings = crate::settings::load_settings().await;
                    if settings.ai_backend == "built_in" {
                        let model_path = crate::ai::llm::llm_model_path(&settings.llm_model_name);
                        if model_path.exists() {
                            let engine_state = app_handle.state::<std::sync::Arc<std::sync::Mutex<Option<crate::ai::llm::LlmEngine>>>>();
                            match tokio::task::spawn_blocking(move || {
                                crate::ai::llm::LlmEngine::new(&model_path)
                            })
                            .await
                            {
                                Ok(Ok(engine)) => {
                                    let mut guard = engine_state.lock().unwrap();
                                    *guard = Some(engine);
                                    tracing::info!("LlmEngine loaded at launch");
                                }
                                Ok(Err(e)) => tracing::warn!("LlmEngine load failed: {}", e),
                                Err(e) => tracing::warn!("LlmEngine spawn_blocking failed: {}", e),
                            }
                        }
                    }
                });
            }
```

Replace with:
```rust
            // Eagerly load LlmEngine on launch if built_in backend is configured.
            // macOS-only: LlmEngine and its state are not compiled on other platforms.
            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let settings = crate::settings::load_settings().await;
                    if settings.ai_backend == "built_in" {
                        let model_path = crate::ai::llm::llm_model_path(&settings.llm_model_name);
                        if model_path.exists() {
                            let engine_state = app_handle.state::<std::sync::Arc<std::sync::Mutex<Option<crate::ai::llm::LlmEngine>>>>();
                            match tokio::task::spawn_blocking(move || {
                                crate::ai::llm::LlmEngine::new(&model_path)
                            })
                            .await
                            {
                                Ok(Ok(engine)) => {
                                    let mut guard = engine_state.lock().unwrap();
                                    *guard = Some(engine);
                                    tracing::info!("LlmEngine loaded at launch");
                                }
                                Ok(Err(e)) => tracing::warn!("LlmEngine load failed: {}", e),
                                Err(e) => tracing::warn!("LlmEngine spawn_blocking failed: {}", e),
                            }
                        }
                    }
                });
            }
```

- [ ] **Step 8: Gate `load_llm_engine`/`unload_llm_engine` in `generate_handler!` in lib.rs**

Find (lines 684–685) inside the `generate_handler!([...])` list:
```rust
            load_llm_engine,
            unload_llm_engine,
```

Replace with:
```rust
            #[cfg(target_os = "macos")]
            load_llm_engine,
            #[cfg(target_os = "macos")]
            unload_llm_engine,
```

- [ ] **Step 9: Verify macOS build**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 10: Verify tests pass**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo test
```

Expected: all tests pass, 0 failed.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: gate LlmEngine managed state and commands as macOS-only"
```

---

### Task 3: Hide "Built-in" backend option in AiModelsView.tsx on non-macOS

**Files:**
- Modify: `src/components/AiModelsView.tsx` (the `SmartDictationTab` component)

**Context:** The `SmartDictationTab` component has `useState` declarations starting around line 288. The backend selector at around line 399 iterates `(["disabled", "built_in", "ollama", "cloud"] as const).map((b) => ...)` and highlights the active backend using `settings.ai_backend === b`. The `get_platform` Tauri command (added in Sub-project 1) returns `"macos"`, `"windows"`, or `"linux"`. The filter must use `platform !== "macos"` (not `platform === "windows"`) to also hide "Built-in" on Linux, consistent with the Rust-side macOS gate. The `effectiveBackend` variable handles the ghost state case where a user's saved settings have `ai_backend = "built_in"` on a non-macOS platform.

- [ ] **Step 1: Add `platform` state and `get_platform` useEffect**

In the `SmartDictationTab` component, find the last existing `useState` declaration (the one for `llmErrors`):
```typescript
  const [llmErrors, setLlmErrors] = useState<Record<string, string>>({});
```

Insert immediately after it:
```typescript
  const [platform, setPlatform] = useState<string>("macos");

  useEffect(() => {
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
  }, []);
```

Default `"macos"` ensures the Built-in option is visible during the brief async fetch on macOS — no flash of hidden content.

- [ ] **Step 2: Add `effectiveBackend` computed value and filter + update backend selector**

Find the backend selector block that starts with:
```tsx
      {/* Backend selector */}
      <div className="card px-5 mb-5">
        <SettingRow label="Backend" description="Where text is sent for polishing">
          <div className="flex rounded-xl overflow-hidden" style={{ boxShadow: "var(--nm-pressed-sm)" }}>
            {(["disabled", "built_in", "ollama", "cloud"] as const).map((b) => (
              <button
                key={b}
                onClick={() => {
```

And the active-state style that reads:
```tsx
                style={{
                  background: settings.ai_backend === b ? "rgba(139,92,246,0.15)" : "transparent",
                  color: settings.ai_backend === b ? "rgb(167,139,250)" : "var(--t3)",
                }}
```

Replace the opening `.map()` line and the active-state `style` prop:

Change:
```tsx
            {(["disabled", "built_in", "ollama", "cloud"] as const).map((b) => (
```
To:
```tsx
            {(() => {
              // On non-macOS: treat "built_in" as "disabled" for highlight purposes
              // (handles migration case where settings.json has ai_backend="built_in" from macOS)
              const effectiveBackend = (settings.ai_backend === "built_in" && platform !== "macos")
                ? "disabled"
                : settings.ai_backend;
              return (["disabled", "built_in", "ollama", "cloud"] as const)
                .filter((b) => !(b === "built_in" && platform !== "macos"))
                .map((b) => (
```

Then change the active-state `style` prop inside the button:
```tsx
                style={{
                  background: settings.ai_backend === b ? "rgba(139,92,246,0.15)" : "transparent",
                  color: settings.ai_backend === b ? "rgb(167,139,250)" : "var(--t3)",
                }}
```
To:
```tsx
                style={{
                  background: effectiveBackend === b ? "rgba(139,92,246,0.15)" : "transparent",
                  color: effectiveBackend === b ? "rgb(167,139,250)" : "var(--t3)",
                }}
```

And close the IIFE after the `.map(...)` closes. The closing structure of the existing block ends with:
```tsx
            ))}
          </div>
```

Change to:
```tsx
              ));
            })()}
          </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/AiModelsView.tsx
git commit -m "feat: hide built-in LLM backend option on non-macOS in AI settings"
```
