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
            491400032,
            "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
            "~400 MB",
        ),
    ]
}

pub fn llm_model_url(filename: &str) -> String {
    match filename {
        "qwen2.5-0.5b-instruct-q4_k_m.gguf" => {
            "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
                .to_string()
        }
        _ => String::new(),
    }
}

// ─── Path utilities ────────────────────────────────────────────────────────────

pub fn llm_models_dir() -> PathBuf {
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
    pub name: String,
    pub size_bytes: u64,
    pub size_label: String,
    pub is_downloaded: bool,
    pub is_active: bool,
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

    let expected = available_llm_models()
        .into_iter()
        .find(|(n, ..)| *n == filename)
        .map(|(_, _, _, sha, _)| sha.to_string())
        .unwrap_or_default();

    if !expected.is_empty() {
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

// ─── Inference Engine ─────────────────────────────────────────────────────────

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

// Safety: llama-cpp-2 wraps C++ that is not Send by default, but we only call
// inference from within a spawn_blocking context (one thread at a time) and the
// managed Mutex prevents concurrent access. This is safe for our usage pattern.
#[cfg(target_os = "macos")]
unsafe impl Send for LlmEngine {}
#[cfg(target_os = "macos")]
unsafe impl Sync for LlmEngine {}

#[cfg(target_os = "macos")]
impl LlmEngine {
    /// Load a GGUF model from disk. Enables Metal GPU on Apple Silicon.
    pub fn new(model_path: &Path) -> anyhow::Result<Self> {
        let backend = LlamaBackend::init()
            .map_err(|e| anyhow::anyhow!("failed to init llama backend: {:?}", e))?;

        let model_params = LlamaModelParams::default()
            .with_n_gpu_layers(u32::MAX); // offload all layers to Metal

        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|e| anyhow::anyhow!("failed to load LLM model: {:?}", e))?;

        Ok(Self { backend, model })
    }

    /// Polish raw transcription text using the LLM.
    pub fn polish(&self, raw: &str, style: &str, vocab: &[String]) -> anyhow::Result<String> {
        let system_prompt = build_polish_system_prompt(style, vocab);
        let prompt = format!(
            "<|im_start|>system\n{}<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n",
            system_prompt, raw
        );

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(std::num::NonZeroU32::new(2048))
            .with_n_threads(4)
            .with_n_threads_batch(4);

        let mut ctx = self.model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| anyhow::anyhow!("failed to create llama context: {:?}", e))?;

        let tokens = self.model
            .str_to_token(&prompt, AddBos::Always)
            .map_err(|e| anyhow::anyhow!("tokenization failed: {:?}", e))?;

        let n_prompt = tokens.len();
        let mut batch = LlamaBatch::new(n_prompt.max(512), 1);

        for (i, token) in tokens.iter().enumerate() {
            let is_last = i == n_prompt - 1;
            batch.add(*token, i as i32, &[0], is_last)
                .map_err(|e| anyhow::anyhow!("batch add failed: {:?}", e))?;
        }

        ctx.decode(&mut batch)
            .map_err(|e| anyhow::anyhow!("decode failed: {:?}", e))?;

        let mut output = String::new();
        let mut n_cur = n_prompt as i32;
        let eos_token = self.model.token_eos();
        let mut sampler = LlamaSampler::greedy();

        for _ in 0..256 {
            let token = sampler.sample(&ctx, batch.n_tokens() - 1);

            if token == eos_token || self.model.is_eog_token(token) {
                break;
            }

            let bytes = self.model
                .token_to_piece_bytes(token, 8, false, None)
                .or_else(|_| self.model.token_to_piece_bytes(token, 64, false, None))
                .map_err(|e| anyhow::anyhow!("token decode failed: {:?}", e))?;
            output.push_str(&String::from_utf8_lossy(&bytes));

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

#[cfg(target_os = "macos")]
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

// ─── Tests ────────────────────────────────────────────────────────────────────

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
}
