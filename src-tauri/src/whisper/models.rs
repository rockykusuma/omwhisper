use anyhow::{Context, Result};
use dirs::data_local_dir;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub description: String,
    pub size_bytes: u64,
    pub size_label: String,
    pub sha256: String,
    pub is_downloaded: bool,
    pub is_english_only: bool,
    /// "English Only" | "Multilingual" | "Turbo"
    pub category: String,
}

/// All available models with their Hugging Face download URLs and checksums.
/// Tuple: (name, description, size_bytes, sha256, english_only, size_label, category)
pub fn available_models() -> Vec<(&'static str, &'static str, u64, &'static str, bool, &'static str, &'static str)> {
    vec![
        // ── English Only ──────────────────────────────────────────────────────
        (
            "tiny.en",
            "Fastest, lowest accuracy. Great for quick notes.",
            75_000_000,
            "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
            true, "75 MB", "English Only",
        ),
        (
            "base.en",
            "Fast with better accuracy. Good for everyday use.",
            142_000_000,
            "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
            true, "142 MB", "English Only",
        ),
        (
            "small.en",
            "Balanced speed and accuracy. Great for professional use.",
            466_000_000,
            "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
            true, "466 MB", "English Only",
        ),
        (
            "medium.en",
            "High accuracy, slower. Best for important recordings.",
            1_500_000_000,
            "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356",
            true, "1.5 GB", "English Only",
        ),
        // ── Multilingual ──────────────────────────────────────────────────────
        (
            "tiny",
            "Fastest multilingual model. Supports 99 languages.",
            75_000_000,
            "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
            false, "75 MB", "Multilingual",
        ),
        (
            "base",
            "Fast multilingual. Good accuracy across most languages.",
            142_000_000,
            "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
            false, "142 MB", "Multilingual",
        ),
        (
            "small",
            "Balanced multilingual. Strong accuracy for 99 languages.",
            466_000_000,
            "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
            false, "466 MB", "Multilingual",
        ),
        (
            "medium",
            "High accuracy multilingual. Ideal for non-English transcription.",
            1_500_000_000,
            "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
            false, "1.5 GB", "Multilingual",
        ),
        (
            "large-v2",
            "Near-best accuracy, all languages. Stable and widely used.",
            2_900_000_000,
            "9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487",
            false, "2.9 GB", "Multilingual",
        ),
        (
            "large-v3",
            "Best accuracy, all languages. Requires plenty of RAM.",
            3_100_000_000,
            "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
            false, "3.1 GB", "Multilingual",
        ),
        // ── Turbo ─────────────────────────────────────────────────────────────
        (
            "large-v3-turbo",
            "Large-v3 quality at 8× the speed. Best balance of accuracy and performance.",
            1_620_000_000,
            "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
            false, "1.6 GB", "Turbo",
        ),
    ]
}

/// Returns the directory where models are stored.
/// ~/Library/Application Support/com.omwhisper.app/models/
pub fn models_dir() -> PathBuf {
    // In dev, also check project root models/ folder
    let dev_models = std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent()?.parent()?.parent()?.parent().map(|root| root.join("models"))
        });

    if let Some(dev_path) = dev_models {
        if dev_path.exists() {
            return dev_path;
        }
    }

    // Production path
    data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.omwhisper.app")
        .join("models")
}

/// Returns the path for a specific model file.
pub fn model_path(name: &str) -> PathBuf {
    models_dir().join(format!("ggml-{}.bin", name))
}

/// Returns download URL for a model from Hugging Face.
pub fn model_url(name: &str) -> String {
    format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        name
    )
}

/// List all models with their download status.
pub fn list_models() -> Vec<ModelInfo> {
    available_models()
        .into_iter()
        .map(|(name, desc, size, sha256, english_only, size_label, category)| {
            let path = model_path(name);
            ModelInfo {
                name: name.to_string(),
                description: desc.to_string(),
                size_bytes: size,
                size_label: size_label.to_string(),
                sha256: sha256.to_string(),
                is_downloaded: path.exists(),
                is_english_only: english_only,
                category: category.to_string(),
            }
        })
        .collect()
}

/// Download a model with progress reporting via callback.
pub async fn download_model<F>(name: &str, on_progress: F) -> Result<PathBuf>
where
    F: Fn(f64) + Send + 'static,
{
    let url = model_url(name);
    let dest = model_path(name);

    // Ensure directory exists
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await.context("failed to create models directory")?;
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .context("failed to start download")?;

    if !response.status().is_success() {
        anyhow::bail!("download failed with status: {}", response.status());
    }

    // Use Content-Length if present; fall back to the catalog's known size so
    // progress is always reported (HuggingFace CDN sometimes omits the header).
    let content_len = response.content_length().unwrap_or(0);
    let catalog_size = available_models()
        .into_iter()
        .find(|(n, ..)| *n == name)
        .map(|(_, _, size, _, _, _, _)| size)
        .unwrap_or(0);
    let total = if content_len > 0 { content_len } else { catalog_size };

    let mut downloaded: u64 = 0;
    let mut last_reported = -1f64; // tracks last emitted progress value

    let tmp_path = dest.with_extension("bin.tmp");
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
            // Throttle: only emit when progress moves by ≥ 0.5% to avoid flooding
            if p - last_reported >= 0.005 {
                on_progress(p);
                last_reported = p;
            }
        }
    }

    file.flush().await?;
    drop(file);

    // Verify SHA256 — look up expected hash
    let expected_sha256 = available_models()
        .into_iter()
        .find(|(n, ..)| *n == name)
        .map(|(_, _, _, sha, _, _, _)| sha.to_string())
        .unwrap_or_default();

    if !expected_sha256.is_empty() {
        let actual = hex::encode(hasher.finalize());
        if actual != expected_sha256 {
            fs::remove_file(&tmp_path).await.ok();
            anyhow::bail!("SHA256 mismatch: expected {}, got {}", expected_sha256, actual);
        }
    }

    // Move tmp → final path
    fs::rename(&tmp_path, &dest).await.context("failed to move model file")?;

    Ok(dest)
}

/// Delete a downloaded model.
pub async fn delete_model(name: &str) -> Result<()> {
    let path = model_path(name);
    if path.exists() {
        fs::remove_file(&path).await.context("failed to delete model")?;
    }
    Ok(())
}

/// Total disk space used by downloaded models (bytes).
pub fn models_disk_usage() -> u64 {
    list_models()
        .iter()
        .filter(|m| m.is_downloaded)
        .map(|m| model_path(&m.name))
        .filter_map(|p| p.metadata().ok())
        .map(|m| m.len())
        .sum()
}
