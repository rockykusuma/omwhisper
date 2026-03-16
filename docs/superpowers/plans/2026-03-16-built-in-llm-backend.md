# Built-in LLM Backend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `built_in` llama.cpp backend to Smart Dictation so users without Ollama can use AI cleanup via a one-time ~400MB model download.

**Architecture:** New `src-tauri/src/ai/llm.rs` module wraps `llama-cpp-2` crate with a persistent `LlmEngine` stored as a separate Tauri-managed state (not inside `SharedState`). `polish_text_cmd` intercepts `built_in` at the command level before delegating `ollama`/`cloud` to the existing `ai::polish`. Frontend adds a Built-in option to the backend selector in `AiModelsView` and a one-time nudge banner in `App.tsx`.

**Tech Stack:** Rust, llama-cpp-2 crate (wraps llama.cpp), Metal GPU on Apple Silicon, React/TypeScript, Tauri 2 IPC

---

## Chunk 1: Foundation — Spike, Settings, Model Utilities

### Task 1: Validate llama-cpp-2 Metal Compilation (Spike)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/build.rs`

> ⚠️ This task MUST pass before any other task starts. If llama-cpp-2 does not compile with Metal, stop and report.

- [ ] **Step 1: Check latest llama-cpp-2 version on crates.io**

```bash
cargo search llama-cpp-2 | head -5
```

Note the latest version number (e.g. `0.1.x`).

- [ ] **Step 2: Add llama-cpp-2, sha2, and hex to Cargo.toml**

Note the version string from Step 1 (e.g. `0.1.87`). In `src-tauri/Cargo.toml`, add after the `whisper-rs` line, substituting the actual version number:

```toml
llama-cpp-2 = { version = "0.1.87", features = ["metal"] }  # use actual version from Step 1
```

Also verify `sha2` and `hex` are already present (they may be in the dependency tree from the Whisper model download code). If not found, add them:

```toml
sha2 = "0.10"
hex = "0.4"
```

Check with:
```bash
grep -E "^sha2|^hex" src-tauri/Cargo.toml
```

- [ ] **Step 3: Attempt to compile**

```bash
cd src-tauri && cargo build 2>&1 | tail -30
```

Expected: Either compiles successfully, or fails with a linker error about Metal/MetalKit/Accelerate frameworks.

- [ ] **Step 4: If linker error — add framework flags to build.rs**

Read the current `src-tauri/build.rs`. It contains only `tauri_build::build();`. Add Metal framework links after that line:

```rust
fn main() {
    tauri_build::build();

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=Metal");
        println!("cargo:rustc-link-lib=framework=MetalKit");
        println!("cargo:rustc-link-lib=framework=Accelerate");
    }
}
```

- [ ] **Step 5: Compile again and confirm success**

```bash
cd src-tauri && cargo build 2>&1 | tail -10
```

Expected output must NOT contain `error`. Warnings are fine.

- [ ] **Step 6: Write a smoke test in `lib.rs` to confirm Metal dispatch**

Add a temporary `#[cfg(test)]` block at the bottom of `src-tauri/src/lib.rs` (remove after confirming):

```rust
#[cfg(test)]
mod spike_tests {
    #[test]
    fn llama_cpp2_backend_inits() {
        // This test verifies that llama-cpp-2 links successfully and the backend
        // initializes. Run with --nocapture and look for "ggml_metal" in the output
        // to confirm Metal GPU is active (not silently falling back to CPU).
        let backend = llama_cpp_2::llama_backend::LlamaBackend::init()
            .expect("LlamaBackend::init() failed — Metal/llama.cpp not linked correctly");
        drop(backend);
    }
}
```

```bash
cd src-tauri && cargo test spike_tests -- --nocapture 2>&1
```

Expected: PASS. **Important:** scan the output for the string `ggml_metal` — its presence confirms Metal GPU was initialized. If you only see `ggml_cpu`, Metal is not active; stop and investigate the `metal` feature flag.

- [ ] **Step 7: Download default model to verify Metal GPU dispatch at runtime**

```bash
mkdir -p models/llm
curl -L "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf" \
  -o models/llm/qwen2.5-0.5b-instruct-q4_k_m.gguf
```

- [ ] **Step 8: Record the SHA256 of the downloaded file**

```bash
sha256sum models/llm/qwen2.5-0.5b-instruct-q4_k_m.gguf
```

Save this value — it will be hardcoded in Task 3.

- [ ] **Step 9: Remove temporary spike test from lib.rs**

Delete the `spike_tests` module added in Step 6 from `src-tauri/src/lib.rs`.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/build.rs
git commit -m "feat: add llama-cpp-2 with metal feature to Cargo.toml"
```

---

### Task 2: Settings Fields + TypeScript Types

**Files:**
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add three new fields to `Settings` struct in `settings.rs`**

After `pub translate_to_english: bool,` (last field, around line 92), add:

```rust
    /// Built-in LLM model filename (GGUF). Used when ai_backend == "built_in".
    #[serde(default = "default_llm_model_name")]
    pub llm_model_name: String,
    /// One-time nudge shown flag — prevents re-showing the "Enable AI cleanup" banner.
    #[serde(default)]
    pub llm_nudge_shown: bool,
```

- [ ] **Step 2: Add the default function for `llm_model_name`**

After the existing default functions (around line 109), add:

```rust
fn default_llm_model_name() -> String { "qwen2.5-0.5b-instruct-q4_k_m.gguf".to_string() }
```

- [ ] **Step 3: Add the new fields to `Settings::default()`**

Inside the `impl Default for Settings` block, after `translate_to_english: false,`, add:

```rust
            llm_model_name: "qwen2.5-0.5b-instruct-q4_k_m.gguf".to_string(),
            llm_nudge_shown: false,
```

- [ ] **Step 4: Verify settings compiles**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Expected: no output (no errors)

- [ ] **Step 5: Add two new fields to `AppSettings` in `src/types/index.ts`**

After `translate_to_english: boolean;` (last field, around line 68), add:

```typescript
  llm_model_name: string;
  llm_nudge_shown: boolean;
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper && npm run build 2>&1 | grep "error TS" | head -10
```

Expected: no TypeScript errors related to the new fields.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/settings.rs src/types/index.ts
git commit -m "feat: add llm_model_name and llm_nudge_shown settings fields"
```

---

### Task 3: LLM Model Utilities (Path, Catalog, Download, Delete, List)

**Files:**
- Create: `src-tauri/src/ai/llm.rs`
- Modify: `src-tauri/src/ai/mod.rs`

> This task implements only the model file management helpers — no inference yet. It mirrors the pattern in `src-tauri/src/whisper/models.rs` exactly.

- [ ] **Step 1: Add `pub mod llm;` to `src-tauri/src/ai/mod.rs`**

At the top of the file, after `pub mod ollama;`, add:

```rust
pub mod llm;
```

- [ ] **Step 2: Write failing tests first in `src-tauri/src/ai/llm.rs`**

Create the file with ONLY the test module (no implementation yet). This establishes what the implementation must satisfy:

```rust
// src-tauri/src/ai/llm.rs — tests first (TDD)

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn llm_models_dir_returns_a_path() {
        let dir = llm_models_dir();
        let s = dir.to_string_lossy();
        assert!(s.contains("models") && s.contains("llm"), "unexpected path: {}", s);
    }

    #[test]
    fn llm_model_path_appends_filename() {
        let p = llm_model_path("foo.gguf");
        assert!(p.to_string_lossy().ends_with("foo.gguf"));
    }

    #[test]
    fn catalog_has_at_least_one_model() {
        assert!(!available_llm_models().is_empty());
    }

    #[test]
    fn list_llm_models_active_flag() {
        let models = list_llm_models("qwen2.5-0.5b-instruct-q4_k_m.gguf");
        let active: Vec<_> = models.iter().filter(|m| m.is_active).collect();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].name, "qwen2.5-0.5b-instruct-q4_k_m.gguf");
    }

    #[test]
    fn list_llm_models_nonexistent_active_flag() {
        let models = list_llm_models("nonexistent.gguf");
        assert!(models.iter().all(|m| !m.is_active));
    }

    #[test]
    fn llm_model_url_known_model() {
        let url = llm_model_url("qwen2.5-0.5b-instruct-q4_k_m.gguf");
        assert!(url.contains("huggingface.co"));
        assert!(url.contains("qwen2.5-0.5b"));
    }

    #[test]
    fn llm_model_url_unknown_returns_empty() {
        let url = llm_model_url("unknown-model.gguf");
        assert!(url.is_empty());
    }
}
```

Run to verify they all fail (functions not yet defined):
```bash
cd src-tauri && cargo test ai::llm::tests 2>&1 | grep "^error"
```
Expected: compile errors about missing functions — confirms tests are ahead of implementation.

- [ ] **Step 3: Create `src-tauri/src/ai/llm.rs` with model path utilities implementation**

```rust
use anyhow::{Context, Result};
use dirs::data_local_dir;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

// ─── Model catalog ─────────────────────────────────────────────────────────────

/// Tuple: (filename, description, size_bytes, sha256, size_label)
pub fn available_llm_models() -> Vec<(&'static str, &'static str, u64, &'static str, &'static str)> {
    vec![
        (
            "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "Fast, lightweight cleanup model. Great for dictation on any Mac.",
            // Replace PLACEHOLDER_SIZE with actual byte count from spike (ls -l shows bytes)
            400_000_000,
            // Replace PLACEHOLDER_SHA256 with value from Task 1 Step 8
            "PLACEHOLDER_SHA256",
            "~400 MB",
        ),
    ]
}

pub fn llm_model_url(filename: &str) -> String {
    // Only the default Qwen model is in the catalog; custom models are user-supplied
    match filename {
        "qwen2.5-0.5b-instruct-q4_k_m.gguf" => {
            "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
                .to_string()
        }
        _ => String::new(),
    }
}

// ─── Path utilities ────────────────────────────────────────────────────────────

/// Returns the directory where LLM models are stored.
/// Dev: {project_root}/models/llm/
/// Prod: ~/Library/Application Support/com.omwhisper.app/models/llm/
pub fn llm_models_dir() -> PathBuf {
    // In dev, check project root models/llm/ folder (binary is 4 levels deep)
    let dev_path = std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent()?.parent()?.parent()?.parent()
                .map(|root| root.join("models").join("llm"))
        });

    if let Some(dev) = dev_path {
        if dev.exists() {
            return dev;
        }
    }

    // Production path
    data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.omwhisper.app")
        .join("models")
        .join("llm")
}

pub fn llm_model_path(filename: &str) -> PathBuf {
    llm_models_dir().join(filename)
}

// ─── Model info ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct LlmModelInfo {
    pub name: String,         // filename, e.g. "qwen2.5-0.5b-instruct-q4_k_m.gguf"
    pub size_bytes: u64,
    pub size_label: String,   // e.g. "~400 MB"
    pub is_downloaded: bool,
    pub is_active: bool,      // true if this matches settings.llm_model_name
}

pub fn list_llm_models(active_model_name: &str) -> Vec<LlmModelInfo> {
    available_llm_models()
        .into_iter()
        .map(|(name, _desc, size, _sha, size_label)| {
            let path = llm_model_path(name);
            LlmModelInfo {
                name: name.to_string(),
                size_bytes: size,
                size_label: size_label.to_string(),
                is_downloaded: path.exists(),
                is_active: name == active_model_name,
            }
        })
        .collect()
}

pub fn llm_models_disk_usage() -> u64 {
    available_llm_models()
        .iter()
        .map(|(name, ..)| llm_model_path(name))
        .filter_map(|p| p.metadata().ok())
        .map(|m| m.len())
        .sum()
}

// ─── Download ─────────────────────────────────────────────────────────────────

pub async fn download_llm_model<F>(filename: &str, on_progress: F) -> Result<PathBuf>
where
    F: Fn(f64) + Send + 'static,
{
    let url = llm_model_url(filename);
    if url.is_empty() {
        anyhow::bail!("No download URL for model: {}", filename);
    }

    let dest = llm_model_path(filename);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await.context("failed to create llm models directory")?;
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .context("failed to start LLM model download")?;

    if !response.status().is_success() {
        anyhow::bail!("download failed with status: {}", response.status());
    }

    let content_len = response.content_length().unwrap_or(0);
    let catalog_size = available_llm_models()
        .into_iter()
        .find(|(n, ..)| *n == filename)
        .map(|(_, _, size, _, _)| size)
        .unwrap_or(0);
    let total = if content_len > 0 { content_len } else { catalog_size };

    let mut downloaded: u64 = 0;
    let mut last_reported = -1f64;
    let tmp_path = dest.with_extension("gguf.tmp");

    let mut file = fs::File::create(&tmp_path)
        .await
        .context("failed to create temp file")?;

    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("download stream error")?;
        hasher.update(&chunk);
        file.write_all(&chunk).await.context("failed to write chunk")?;
        downloaded += chunk.len() as u64;

        if total > 0 {
            let p = (downloaded as f64 / total as f64).min(1.0);
            if p - last_reported >= 0.005 {
                on_progress(p);
                last_reported = p;
            }
        }
    }

    file.flush().await?;
    drop(file);

    // Verify SHA256
    let expected = available_llm_models()
        .into_iter()
        .find(|(n, ..)| *n == filename)
        .map(|(_, _, _, sha, _)| sha.to_string())
        .unwrap_or_default();

    if !expected.is_empty() && expected != "PLACEHOLDER_SHA256" {
        let actual = hex::encode(hasher.finalize());
        if actual != expected {
            fs::remove_file(&tmp_path).await.ok();
            anyhow::bail!("SHA256 mismatch: expected {}, got {}", expected, actual);
        }
    }

    fs::rename(&tmp_path, &dest).await.context("failed to move LLM model file")?;
    Ok(dest)
}

// ─── Delete ───────────────────────────────────────────────────────────────────

pub async fn delete_llm_model(filename: &str) -> Result<()> {
    let path = llm_model_path(filename);
    if path.exists() {
        fs::remove_file(&path).await.context("failed to delete LLM model")?;
    }
    Ok(())
}

// ─── Copy custom model ────────────────────────────────────────────────────────

/// Copy a user-supplied GGUF file into the llm models directory.
/// Returns the filename (not full path) on success.
pub async fn import_custom_llm_model(source_path: &Path) -> Result<String> {
    let filename = source_path
        .file_name()
        .context("invalid source path")?
        .to_string_lossy()
        .to_string();

    let dest = llm_model_path(&filename);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await.context("failed to create llm models directory")?;
    }

    fs::copy(source_path, &dest).await.context("failed to copy model file")?;
    Ok(filename)
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn llm_models_dir_returns_a_path() {
        let dir = llm_models_dir();
        // Should end with "models/llm" in both dev and prod
        let s = dir.to_string_lossy();
        assert!(s.contains("models") && s.contains("llm"), "unexpected path: {}", s);
    }

    #[test]
    fn llm_model_path_appends_filename() {
        let p = llm_model_path("foo.gguf");
        assert!(p.to_string_lossy().ends_with("foo.gguf"));
    }

    #[test]
    fn catalog_has_at_least_one_model() {
        assert!(!available_llm_models().is_empty());
    }

    #[test]
    fn list_llm_models_active_flag() {
        let models = list_llm_models("qwen2.5-0.5b-instruct-q4_k_m.gguf");
        let active: Vec<_> = models.iter().filter(|m| m.is_active).collect();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].name, "qwen2.5-0.5b-instruct-q4_k_m.gguf");
    }

    #[test]
    fn list_llm_models_nonexistent_active_flag() {
        let models = list_llm_models("nonexistent.gguf");
        assert!(models.iter().all(|m| !m.is_active));
    }

    #[test]
    fn llm_model_url_known_model() {
        let url = llm_model_url("qwen2.5-0.5b-instruct-q4_k_m.gguf");
        assert!(url.contains("huggingface.co"));
        assert!(url.contains("qwen2.5-0.5b"));
    }

    #[test]
    fn llm_model_url_unknown_returns_empty() {
        let url = llm_model_url("unknown-model.gguf");
        assert!(url.is_empty());
    }
}
```

- [ ] **Step 4: Fill in the PLACEHOLDER_SHA256 with the value from Task 1 Step 8**

Edit `src-tauri/src/ai/llm.rs` and replace `"PLACEHOLDER_SHA256"` with the actual hash.

Also update `400_000_000` with the actual file size in bytes:
```bash
wc -c < models/llm/qwen2.5-0.5b-instruct-q4_k_m.gguf
```

- [ ] **Step 5: Run the unit tests**

```bash
cd src-tauri && cargo test ai::llm::tests -- --nocapture 2>&1
```

Expected: All 7 tests PASS.

- [ ] **Step 6: Verify the whole crate still compiles**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/ai/llm.rs src-tauri/src/ai/mod.rs
git commit -m "feat: add llm model utilities (path, catalog, download, delete)"
```

---

## Chunk 2: Core Engine + Commands

### Task 4: LlmEngine — Load GGUF and Polish

**Files:**
- Modify: `src-tauri/src/ai/llm.rs` (add `LlmEngine` struct below the utilities)

> This task adds the inference engine to the same file as the model utilities. The `polish` method builds a prompt and runs synchronous llama.cpp inference.

- [ ] **Step 1: Determine the llama-cpp-2 API for model loading and inference**

Read the llama-cpp-2 docs/examples:
```bash
ls ~/.cargo/registry/src/*/llama-cpp-2-*/examples/ 2>/dev/null
cat ~/.cargo/registry/src/*/llama-cpp-2-*/examples/*.rs 2>/dev/null | head -100
```

Note the pattern for: `LlamaModel::load_from_file`, creating a context, tokenizing, running inference, and decoding output tokens.

- [ ] **Step 2: Add `LlmEngine` struct and `new()` to `src-tauri/src/ai/llm.rs`**

> **Send safety note:** `llama-cpp-2`'s `LlamaModel` and `LlamaBackend` may not automatically impl `Send`. Tauri's `manage()` requires `Send + Sync`. After adding the struct, if you see a compile error like `LlamaModel is not Send`, add the following after the struct definition:
> ```rust
> // Safety: llama-cpp-2 wraps C++ that is not Send by default, but we only call
> // inference from within a spawn_blocking context (one thread at a time) and the
> // managed Mutex prevents concurrent access. This is safe for our usage pattern.
> unsafe impl Send for LlmEngine {}
> unsafe impl Sync for LlmEngine {}
> ```

Add after the `import_custom_llm_model` function, adjusting the API based on what you found in Step 1:

```rust
// ─── Inference Engine ─────────────────────────────────────────────────────────

use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    model::{params::LlamaModelParams, LlamaModel},
};

pub struct LlmEngine {
    backend: LlamaBackend,
    model: LlamaModel,
}

impl LlmEngine {
    /// Load a GGUF model from disk. Enables Metal GPU on Apple Silicon.
    pub fn new(model_path: &Path) -> anyhow::Result<Self> {
        let backend = LlamaBackend::init()
            .map_err(|e| anyhow::anyhow!("failed to init llama backend: {:?}", e))?;

        let model_params = LlamaModelParams::default()
            .with_n_gpu_layers(i32::MAX); // offload all layers to Metal

        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|e| anyhow::anyhow!("failed to load LLM model: {:?}", e))?;

        Ok(Self { backend, model })
    }

    /// Polish raw transcription text using the LLM.
    /// style: polish style name (e.g. "professional", "casual")
    /// vocab: custom vocabulary terms to mention in the prompt
    pub fn polish(&self, raw: &str, style: &str, vocab: &[String]) -> anyhow::Result<String> {
        let system_prompt = build_polish_system_prompt(style, vocab);
        let prompt = format!(
            "<|im_start|>system\n{}<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
            system_prompt, raw
        );

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(std::num::NonZeroU32::new(2048).unwrap())
            .with_n_threads(4)
            .with_n_threads_batch(4);

        let mut ctx = self.model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| anyhow::anyhow!("failed to create llama context: {:?}", e))?;

        // Tokenize prompt
        let tokens = self.model
            .str_to_token(&prompt, llama_cpp_2::model::AddBos::Always)
            .map_err(|e| anyhow::anyhow!("tokenization failed: {:?}", e))?;

        // Decode (run inference), collect up to 256 output tokens
        let mut output = String::new();
        let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(512, 1);

        for (i, token) in tokens.iter().enumerate() {
            batch.add(*token, i as i32, &[0], false)
                .map_err(|e| anyhow::anyhow!("batch add failed: {:?}", e))?;
        }

        ctx.decode(&mut batch)
            .map_err(|e| anyhow::anyhow!("decode failed: {:?}", e))?;

        let mut n_cur = tokens.len() as i32;
        let eos_token = self.model.token_eos();

        for _ in 0..256 {
            let candidates = ctx.candidates_ith(batch.n_tokens() - 1);
            let token = ctx.sample_token_greedy(candidates);

            if token == eos_token {
                break;
            }

            let piece = self.model.token_to_str(token, llama_cpp_2::model::Special::Tokenize)
                .map_err(|e| anyhow::anyhow!("token decode failed: {:?}", e))?;
            output.push_str(&piece);

            batch.clear();
            batch.add(token, n_cur, &[0], true)
                .map_err(|e| anyhow::anyhow!("batch add token failed: {:?}", e))?;

            ctx.decode(&mut batch)
                .map_err(|e| anyhow::anyhow!("decode token failed: {:?}", e))?;

            n_cur += 1;
        }

        Ok(output.trim().to_string())
    }
}

fn build_polish_system_prompt(style: &str, vocab: &[String]) -> String {
    let style_instruction = match style {
        "casual" => "Keep the tone casual and conversational.",
        "email" => "Format as a professional email. Use proper greeting and sign-off structure if appropriate.",
        "meeting_notes" => "Format as structured meeting notes with bullet points for action items.",
        "concise" => "Make it as concise as possible while preserving all key information.",
        _ => "Use professional, clear language suitable for business communication.",
    };

    let vocab_section = if vocab.is_empty() {
        String::new()
    } else {
        format!(
            "\nCustom vocabulary — use these exact spellings: {}",
            vocab.join(", ")
        )
    };

    format!(
        "You are a dictation cleanup assistant. Take raw speech-to-text output and produce clean, natural text.\n\
         Rules:\n\
         - Fix punctuation and capitalization\n\
         - Remove filler words (um, uh, like, you know) unless intentional\n\
         - Do NOT add or remove content — preserve the user's intent exactly\n\
         - {}{}\n\
         - Output ONLY the cleaned text. No explanations, no preamble.",
        style_instruction, vocab_section
    )
}
```

> ⚠️ The llama-cpp-2 API may differ slightly from the above. Adjust method names based on what you found in Step 1. The key invariants are: load model with `n_gpu_layers = MAX` for full Metal offload, cap output at 256 tokens, return trimmed string.

- [ ] **Step 3: Compile and fix any API mismatches**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Work through any compile errors caused by API differences in the llama-cpp-2 version. The logic above may need minor adjustments to match the actual crate API.

- [ ] **Step 4: Add basic tests for `build_polish_system_prompt` in `llm.rs`**

Append to the existing `#[cfg(test)] mod tests` block (added in Task 3):

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

```bash
cd src-tauri && cargo test ai::llm::tests -- --nocapture 2>&1
```

Expected: All 9 tests PASS (7 from Task 3 + 2 new prompt tests).

- [ ] **Step 5: Run existing unit tests to confirm nothing broke**

```bash
cd src-tauri && cargo test ai::llm::tests -- --nocapture 2>&1
```

Expected: All 9 tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/ai/llm.rs
git commit -m "feat: add LlmEngine with Metal GPU support for polish inference"
```

---

### Task 5: Tauri Commands — Download, Delete, List, Disk Usage

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (export new commands)

- [ ] **Step 1: Add a `DownloadLlmProgress` event struct and 4 new commands to `commands.rs`**

Find the `get_models_disk_usage` command (around line 315). Add the following after it:

```rust
// ─── LLM Model Management ─────────────────────────────────────────────────────

use crate::ai::llm as llm_models;

#[derive(Clone, serde::Serialize)]
pub struct LlmDownloadProgress {
    pub name: String,
    pub progress: f64,
    pub done: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn get_llm_models(app: tauri::AppHandle) -> Result<Vec<llm_models::LlmModelInfo>, String> {
    let settings = crate::settings::load_settings().await;
    Ok(llm_models::list_llm_models(&settings.llm_model_name))
}

#[tauri::command]
pub async fn get_llm_models_disk_usage() -> Result<u64, String> {
    Ok(llm_models::llm_models_disk_usage())
}

#[tauri::command]
pub async fn download_llm_model(name: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    let name_clone = name.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        let name_for_cb = name_clone.clone();
        let app_for_cb = app_clone.clone();

        let result = llm_models::download_llm_model(&name_clone, move |progress| {
            let _ = app_for_cb.emit(
                "llm-download-progress",
                LlmDownloadProgress {
                    name: name_for_cb.clone(),
                    progress,
                    done: false,
                    error: None,
                },
            );
        })
        .await;

        match result {
            Ok(_) => {
                let _ = app_clone.emit(
                    "llm-download-progress",
                    LlmDownloadProgress {
                        name: name_clone,
                        progress: 1.0,
                        done: true,
                        error: None,
                    },
                );
            }
            Err(e) => {
                let _ = app_clone.emit(
                    "llm-download-progress",
                    LlmDownloadProgress {
                        name: name_clone,
                        progress: 0.0,
                        done: true,
                        error: Some(e.to_string()),
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn delete_llm_model(name: String) -> Result<(), String> {
    llm_models::delete_llm_model(&name)
        .await
        .map_err(|e| e.to_string())
}

// Plan extension (not in spec command table — added to support "Add custom model" UI in Task 8)
#[tauri::command]
pub async fn import_llm_model(source_path: String) -> Result<String, String> {
    use std::path::Path;
    llm_models::import_custom_llm_model(Path::new(&source_path))
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the new commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `use commands::{...}` block at the top and add the new commands to the import list:

```rust
get_llm_models, get_llm_models_disk_usage, download_llm_model, delete_llm_model, import_llm_model,
```

Then find the `.invoke_handler(tauri::generate_handler![...])` call and add them there too:

```rust
get_llm_models,
get_llm_models_disk_usage,
download_llm_model,
delete_llm_model,
import_llm_model,
```

- [ ] **Step 3: Compile**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add LLM model download/delete/list Tauri commands"
```

---

### Task 6: Managed State + load_llm_engine + polish_text_cmd Branch

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Register `LlmEngine` managed state in `lib.rs`**

In `lib.rs`, find where Tauri state is set up (look for `.manage(shared_state.clone())`). After it, add:

```rust
// Separate managed state for LlmEngine — must NOT be inside SharedState
// because inference blocks the thread and holding SharedState's mutex would
// deadlock the global shortcut handlers.
app.manage(std::sync::Arc::new(std::sync::Mutex::new(
    Option::<crate::ai::llm::LlmEngine>::None,
)));
```

- [ ] **Step 2: Add `load_llm_engine` command to `commands.rs`**

After the `import_llm_model` command, add:

```rust
type LlmEngineState = std::sync::Arc<std::sync::Mutex<Option<crate::ai::llm::LlmEngine>>>;

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

- [ ] **Step 3: Add `tauri::AppHandle` parameter to `polish_text_cmd` and add the `built_in` branch**

Find `polish_text_cmd` (around line 839). Replace it entirely:

```rust
#[tauri::command]
pub async fn polish_text_cmd(
    text: String,
    style: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let settings = crate::settings::load_settings().await;

    // built_in is intercepted here — ai::polish has no access to managed state
    if settings.ai_backend == "built_in" {
        let engine_state = app.state::<LlmEngineState>();
        let vocab = settings.custom_vocabulary.clone();
        // Note: The mutex guard is held for the duration of inference (several seconds).
        // This is safe because LlmEngineState is a SEPARATE state from SharedState —
        // shortcut handlers and other commands never lock LlmEngineState during normal
        // operation. load_llm_engine will block briefly if called mid-inference, which
        // is acceptable (load is a user-initiated action, not a hotkey handler).
        let result = {
            let guard = engine_state.lock().unwrap();
            match guard.as_ref() {
                Some(engine) => engine.polish(&text, &style, &vocab),
                None => return Err("llm_not_ready".to_string()),
            }
        };
        return result.map_err(|e| e.to_string());
    }

    // ollama / cloud path — unchanged
    let system_prompt = crate::styles::system_prompt_for(&style, &settings.translate_target_language);
    let request = crate::ai::PolishRequest { text, system_prompt };
    crate::ai::polish(request, &settings)
        .await
        .map(|r| r.text)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Register new commands in `lib.rs` invoke_handler**

In `src-tauri/src/lib.rs`, find the `use commands::{...}` block that was modified in Task 5 Step 2 and **append** (do not replace) `load_llm_engine, unload_llm_engine` to the existing import list.

Then find the `.invoke_handler(tauri::generate_handler![...])` block that was modified in Task 5 Step 2 and **append** these commands to the existing list:

```rust
load_llm_engine,
unload_llm_engine,
```

> ⚠️ Do NOT create a second import block or a second `invoke_handler` — append to the ones from Task 5.

- [ ] **Step 5: Add eager load on app launch if `ai_backend == "built_in"`**

In `lib.rs`, find where the background update check is spawned (near the end of `setup`). Add after it:

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

- [ ] **Step 6: Compile**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 7: Smoke test — launch app, check log for engine load message**

```bash
cargo tauri dev 2>&1 | grep -i "llm\|engine" | head -10
```

If `ai_backend` is currently `"disabled"` in your settings, no LLM log will appear (that's correct). If you manually edit settings.json to `"built_in"` and the model file exists, you should see `LlmEngine loaded at launch`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add load_llm_engine command, managed state, built_in polish branch"
```

---

## Chunk 3: Frontend — Nudge Banner + Built-in UI

### Task 7: Nudge Startup Logic + App.tsx Banner

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add nudge check to `lib.rs` startup tasks**

In `lib.rs`, find the block that spawns the background license validation (after `setup` completes). Add a new spawn after it:

```rust
// One-time nudge: if user has never configured AI and Ollama isn't running,
// prompt them to enable the built-in LLM backend.
{
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let settings = crate::settings::load_settings().await;
        if settings.llm_nudge_shown || settings.ai_backend != "disabled" {
            return; // already shown or already configured
        }

        // Check Ollama with a 3-second hard timeout
        let ollama_url = settings.ai_ollama_url.clone();
        let ollama_running = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            crate::ai::ollama::check_status(&ollama_url),
        )
        .await
        .unwrap_or(false); // timeout → treat as not running

        if !ollama_running {
            // Mark shown immediately to prevent re-trigger if app relaunches
            let mut updated = settings;
            updated.llm_nudge_shown = true;
            let _ = crate::settings::save_settings(&updated).await;

            let _ = app_handle.emit("show-llm-nudge", ());
        }
    });
}
```

- [ ] **Step 2: Add nudge banner state and handler to `App.tsx`**

In `App.tsx`, find where existing banner states are declared (look for `isDmgWarning` or `updateInfo`). Add:

```typescript
const [showLlmNudge, setShowLlmNudge] = useState(false);
```

In the `useEffect` where Tauri events are subscribed (look for `listen("update-available"...)`), add:

```typescript
const unlistenLlmNudge = await listen("show-llm-nudge", () => {
  setShowLlmNudge(true);
});
```

Add it to the cleanup return:

```typescript
unlistenLlmNudge();
```

- [ ] **Step 3: Add the nudge banner JSX to `App.tsx`**

Find where the existing DMG warning or update banner is rendered. Add the nudge banner in the same area, following the same visual pattern (look for the amber warning banner style):

```tsx
{showLlmNudge && (
  <div
    className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
    style={{
      background: "color-mix(in srgb, var(--accent) 8%, var(--bg))",
      borderBottom: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
    }}
  >
    <div className="flex items-center gap-2 min-w-0">
      <Sparkles size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
      <span style={{ color: "var(--t2)" }}>
        <span className="font-semibold" style={{ color: "var(--t1)" }}>Enable AI cleanup</span>
        {" — "}Download a 400 MB model to fix punctuation and remove filler words. Works offline.
      </span>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={async () => {
          setShowLlmNudge(false);
          // Switch to built_in and start download
          const s = await invoke<AppSettings>("get_settings");
          const updated = { ...s, ai_backend: "built_in" };
          await invoke("update_settings", { newSettings: updated });
          await invoke("download_llm_model", { name: updated.llm_model_name });
          // Navigate to AI Models → Smart Dictation tab
          // The view key is "models" (not "ai-models") — matches the View type in Sidebar.tsx
          setActiveView("models");
        }}
        className="btn-primary text-xs px-3 py-1"
      >
        Download &amp; Enable
      </button>
      <button
        onClick={() => setShowLlmNudge(false)}
        className="btn-ghost text-xs px-2 py-1"
        style={{ color: "var(--t3)" }}
      >
        Not now
      </button>
    </div>
  </div>
)}
```

> Note: `setActiveView("models")` uses the confirmed view key from `Sidebar.tsx`. The setter name (`setActiveView`) matches the pattern used by other navigation actions in `App.tsx` — verify the exact setter name if it differs.

- [ ] **Step 4: Verify TypeScript compiles with no errors**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

Expected: no errors.

- [ ] **Step 5: Compile Rust**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error"
```

- [ ] **Step 6: Manual test — nudge appears for fresh user**

Temporarily edit `~/Library/Application Support/com.omwhisper.app/settings.json`:
- Set `"ai_backend": "disabled"`
- Set `"llm_nudge_shown": false`

Launch the app and confirm the nudge banner appears within 3 seconds.

Click "Not now" — confirm banner dismisses and `llm_nudge_shown` is now `true` in settings.json.

Re-launch — confirm banner does NOT reappear.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src/App.tsx
git commit -m "feat: add LLM nudge startup check and App.tsx banner"
```

---

### Task 8: AiModelsView — Built-in Backend UI + Model Download Section

**Files:**
- Modify: `src/components/AiModelsView.tsx`

- [ ] **Step 1: Add `LlmModelInfo` TypeScript interface to `src/types/index.ts`**

After the `OllamaStatus` interface, add:

```typescript
export interface LlmModelInfo {
  name: string;
  size_bytes: number;
  size_label: string;
  is_downloaded: boolean;
  is_active: boolean;
}

export interface LlmDownloadProgress {
  name: string;
  progress: number;
  done: boolean;
  error: string | null;
}
```

- [ ] **Step 2: Add `built_in` to the backend selector in `SmartDictationTab`**

In `AiModelsView.tsx`, find the backend selector buttons (the `["disabled", "ollama", "cloud"]` array around line 370). Change it to:

```tsx
{(["disabled", "built_in", "ollama", "cloud"] as const).map((b) => (
  <button
    ...
  >
    {b === "ollama" ? "On-Device (Ollama)"
     : b === "cloud" ? "Cloud API"
     : b === "built_in" ? "Built-in"
     : "Disabled"}
  </button>
))}
```

- [ ] **Step 3: Add state for LLM models and download progress in `SmartDictationTab`**

At the top of `SmartDictationTab`, add:

```typescript
const [llmModels, setLlmModels] = useState<LlmModelInfo[]>([]);
const [llmDownloading, setLlmDownloading] = useState<Record<string, number>>({});
const [llmErrors, setLlmErrors] = useState<Record<string, string>>({});
```

- [ ] **Step 4: Load LLM models and subscribe to download progress in `useEffect`**

In the existing `useEffect` inside `SmartDictationTab`, add:

```typescript
// Load LLM model list
invoke<LlmModelInfo[]>("get_llm_models").then(setLlmModels).catch(() => {});

// Subscribe to LLM download progress
const unlistenLlm = listen<LlmDownloadProgress>("llm-download-progress", (event) => {
  const { name, progress, done, error } = event.payload;
  if (done) {
    setLlmDownloading((prev) => { const next = { ...prev }; delete next[name]; return next; });
    if (error) {
      setLlmErrors((prev) => ({ ...prev, [name]: error }));
    } else {
      invoke<LlmModelInfo[]>("get_llm_models").then(setLlmModels).catch(() => {});
      // Load engine after successful download
      invoke("load_llm_engine", { name }).catch(() => {});
    }
  } else {
    setLlmDownloading((prev) => ({ ...prev, [name]: progress }));
  }
});

// Cleanup in return:
// (unlistenLlm).then(f => f());
```

Add `(await unlistenLlm)()` to the `useEffect` cleanup.

- [ ] **Step 5: Add the "Local Model" section JSX — shown only when `built_in` is selected**

Find where the Ollama section is rendered (`{settings.ai_backend === "ollama" && ...}`). Add before it:

```tsx
{settings.ai_backend === "built_in" && (
  <div className="card px-5 mb-5">
    <p className="text-white/60 text-[10px] uppercase tracking-widest py-3 font-mono border-b border-white/[0.04]">
      Local Model
    </p>
    {llmModels.map((model) => {
      const isDownloading = model.name in llmDownloading;
      const progress = llmDownloading[model.name] ?? 0;
      const error = llmErrors[model.name];
      return (
        <div key={model.name} className="py-3 border-b border-white/[0.04] last:border-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                {model.is_active && (
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--accent)" }} />
                )}
                <span className="text-white/80 text-sm font-medium">{model.name}</span>
                {model.is_active && (
                  <span className="text-[10px] px-1.5 py-px rounded font-mono" style={{ color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)" }}>Active</span>
                )}
              </div>
              <p className="text-white/50 text-xs font-mono">{model.size_label}</p>
            </div>
            <div className="shrink-0">
              {model.is_downloaded ? (
                <span className="text-emerald-400 text-xs">✓ Downloaded</span>
              ) : isDownloading ? (
                <div className="text-right min-w-[64px]">
                  <p className="text-[11px] font-mono mb-1" style={{ color: "var(--accent)" }}>{Math.round(progress * 100)}%</p>
                  <div className="h-1 rounded-full overflow-hidden" style={{ width: 64, background: "color-mix(in srgb, var(--t1) 8%, transparent)" }}>
                    <div className="h-full rounded-full transition-all duration-200" style={{ width: `${progress * 100}%`, background: "var(--accent)" }} />
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setLlmErrors((prev) => { const n = { ...prev }; delete n[model.name]; return n; });
                    setLlmDownloading((prev) => ({ ...prev, [model.name]: 0 }));
                    invoke("download_llm_model", { name: model.name });
                  }}
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  Download
                </button>
              )}
            </div>
          </div>
          {error && <p className="text-red-400/70 text-xs mt-1.5">✗ {error}</p>}
        </div>
      );
    })}
    <div className="py-3">
      <button
        onClick={async () => {
          // Use @tauri-apps/plugin-dialog (not raw invoke) — same pattern as Settings.tsx
          const { open } = await import("@tauri-apps/plugin-dialog");
          const selected = await open({
            filters: [{ name: "GGUF Model", extensions: ["gguf"] }],
            multiple: false,
          }).catch(() => null);
          if (selected && typeof selected === "string") {
            const filename = await invoke<string>("import_llm_model", { sourcePath: selected })
              .catch((e: string) => { setLlmErrors((prev) => ({ ...prev, import: e })); return null; });
            if (filename) {
              invoke<LlmModelInfo[]>("get_llm_models").then(setLlmModels).catch(() => {});
            }
          }
        }}
        className="btn-ghost text-xs px-3 py-1.5"
      >
        + Add custom model
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 6: Hide the Timeout row when `built_in` is selected**

Find the `SettingRow` for "Timeout" (around line 580). Wrap it:

```tsx
{settings.ai_backend !== "built_in" && (
  <SettingRow label="Timeout" description="Max seconds to wait for AI response">
    ...
  </SettingRow>
)}
```

- [ ] **Step 7: Call `load_llm_engine` when user switches to `built_in`**

Find the backend selector `onClick` handler. After calling `update({ ai_backend: b })`, add:

```typescript
if (b === "built_in") {
  // Load engine if model is already downloaded
  invoke<LlmModelInfo[]>("get_llm_models").then((models) => {
    const active = models.find((m) => m.is_active && m.is_downloaded);
    if (active) {
      invoke("load_llm_engine", { name: active.name }).catch(() => {});
    }
    setLlmModels(models);
  }).catch(() => {});
}
```

- [ ] **Step 8: Add `llm_not_ready` error mapping in `App.tsx`**

In `App.tsx`, find the Smart Dictation stop handler — the `catch` block that handles AI polish errors (look for the comment about pasting raw text on AI error, or the `transcription-complete` event handler). Add a specific check before the generic fallback:

```typescript
} catch (e) {
  if (String(e) === "llm_not_ready") {
    // Show specific toast: model not downloaded or not loaded yet
    showToast("AI model not ready — check AI Models settings.", "error");
  } else {
    // existing fallback: paste raw text
    ...
  }
}
```

The exact insertion point depends on the current App.tsx structure. Search for the existing `polish_text_cmd` error handler and add the `llm_not_ready` check at the top of the catch block.

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

Expected: no errors.

- [ ] **Step 10: Manual test — Built-in UI renders correctly**

Launch the app. Go to AI Models → Smart Dictation tab. Select "Built-in". Confirm:
- Local Model section appears
- Qwen2.5-0.5B model is listed with a Download button
- Timeout row disappears
- Clicking Download starts the download and shows progress

- [ ] **Step 11: Commit**

```bash
git add src/components/AiModelsView.tsx src/types/index.ts src/App.tsx
git commit -m "feat: add Built-in backend UI to SmartDictationTab with model download"
```

---

### Task 9: End-to-End Smoke Test + Final Cleanup

**Files:**
- No new code — validation only

- [ ] **Step 1: Full end-to-end test with Built-in backend**

1. Open AI Models → Smart Dictation → select "Built-in"
2. Download the Qwen2.5-0.5B model (confirm progress bar works, completes, ✓ Downloaded appears)
3. Use ⌘⇧B (Smart Dictation hotkey) and speak a sentence with filler words: *"Um, I wanted to, like, let you know that the meeting is, uh, on Thursday"*
4. Confirm paste result is: *"I wanted to let you know that the meeting is on Thursday."* (or similar — filler words removed, punctuation correct)
5. Check the Rust log for `LlmEngine` inference timing:

```bash
cat ~/Library/Application\ Support/com.omwhisper.app/logs/omwhisper.log.* | grep -i "llm\|polish" | tail -20
```

- [ ] **Step 2: Test `llm_not_ready` error path**

1. In settings.json, set `"ai_backend": "built_in"` but delete the model file
2. Relaunch app
3. Use ⌘⇧B — confirm a toast appears: *"AI model not ready — check AI Models settings."*

The error mapping was added in Task 8 Step 8. If this toast does not appear, check the `catch` block in App.tsx's Smart Dictation stop handler.

- [ ] **Step 3: Verify Ollama backend still works**

Switch to Ollama backend, confirm existing Smart Dictation still works. `ai::polish` was not modified so this should be unchanged.

- [ ] **Step 4: Verify Cloud API backend still works**

Switch to Cloud API backend, confirm existing Smart Dictation still works.

- [ ] **Step 5: Check memory usage**

With Built-in backend active and model loaded, open Activity Monitor and confirm OmWhisper memory is under 2GB.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: built-in LLM backend complete — end-to-end verified"
```

---

## Summary of All Files Changed

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `llama-cpp-2` with `metal` feature |
| `src-tauri/build.rs` | Add Metal framework link flags (macOS-only) |
| `src-tauri/src/settings.rs` | Add `llm_model_name`, `llm_nudge_shown` fields |
| `src-tauri/src/ai/mod.rs` | Add `pub mod llm;` |
| `src-tauri/src/ai/llm.rs` | **New** — model utilities, `LlmEngine`, `polish()` |
| `src-tauri/src/commands.rs` | 6 new commands + `polish_text_cmd` built_in branch |
| `src-tauri/src/lib.rs` | Register managed state, eager load, nudge check |
| `src/types/index.ts` | Add `llm_model_name`, `llm_nudge_shown`, `LlmModelInfo`, `LlmDownloadProgress` |
| `src/components/AiModelsView.tsx` | Built-in backend UI, model download, timeout row hide |
| `src/App.tsx` | Nudge banner event handler and JSX |
