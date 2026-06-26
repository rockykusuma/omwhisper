use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::ffi;

/// Model files required for every Moonshine variant.
const MODEL_FILES: &[&str] = &[
    "encoder.ort",
    "frontend.ort",
    "decoder_kv.ort",
    "cross_kv.ort",
    "adapter.ort",
    "tokenizer.bin",
    "streaming_config.json",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoonshineVariantInfo {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub size_label: String,
    pub total_size_bytes: u64,
    pub model_arch: i32,
    pub is_downloaded: bool,
}

pub struct MoonshineVariantSpec {
    pub name: &'static str,
    pub display_name: &'static str,
    pub description: &'static str,
    pub size_label: &'static str,
    pub total_size_bytes: u64,
    pub model_arch: i32,
}

const VARIANTS: &[MoonshineVariantSpec] = &[
    MoonshineVariantSpec {
        name: "tiny-streaming-en",
        display_name: "Tiny Streaming (English)",
        description: "Fast and lightweight. Great for most use cases.",
        size_label: "51 MB",
        total_size_bytes: 51_000_000,
        model_arch: ffi::MOONSHINE_MODEL_ARCH_TINY_STREAMING,
    },
    MoonshineVariantSpec {
        name: "medium-streaming-en",
        display_name: "Medium Streaming (English)",
        description: "Higher accuracy, larger model. Recommended for best results.",
        size_label: "290 MB",
        total_size_bytes: 290_000_000,
        model_arch: ffi::MOONSHINE_MODEL_ARCH_MEDIUM_STREAMING,
    },
];

/// Base directory for all Moonshine models.
pub fn moonshine_models_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.omwhisper.app")
        .join("models")
        .join("moonshine")
}

/// Directory for a specific Moonshine variant.
pub fn moonshine_model_dir(variant: &str) -> PathBuf {
    moonshine_models_dir().join(variant)
}

/// Returns true if all required model files exist for the variant.
pub fn is_variant_downloaded(variant: &str) -> bool {
    let dir = moonshine_model_dir(variant);
    MODEL_FILES.iter().all(|f| dir.join(f).exists())
}

/// Map variant name to the FFI model arch constant.
pub fn moonshine_model_arch(variant: &str) -> Option<i32> {
    VARIANTS.iter().find(|v| v.name == variant).map(|v| v.model_arch)
}

/// List all known Moonshine variants with their download status.
pub fn list_moonshine_models() -> Vec<MoonshineVariantInfo> {
    VARIANTS
        .iter()
        .map(|v| MoonshineVariantInfo {
            name: v.name.to_string(),
            display_name: v.display_name.to_string(),
            description: v.description.to_string(),
            size_label: v.size_label.to_string(),
            total_size_bytes: v.total_size_bytes,
            model_arch: v.model_arch,
            is_downloaded: is_variant_downloaded(v.name),
        })
        .collect()
}

/// Total disk usage of all downloaded Moonshine models in bytes.
pub fn moonshine_disk_usage() -> u64 {
    VARIANTS
        .iter()
        .filter(|v| is_variant_downloaded(v.name))
        .map(|v| {
            let dir = moonshine_model_dir(v.name);
            MODEL_FILES
                .iter()
                .filter_map(|f| std::fs::metadata(dir.join(f)).ok())
                .map(|m| m.len())
                .sum::<u64>()
        })
        .sum()
}

/// CDN base URL for Moonshine model files.
fn cdn_url(variant: &str, file: &str) -> String {
    format!(
        "https://download.moonshine.ai/model/{variant}/quantized/{file}"
    )
}

/// Download all model files for a variant.
/// Reports aggregate progress via `on_progress(bytes_done, bytes_total)`.
/// Downloads into a `.tmp` directory first; atomically renames to final path on success.
pub async fn download_moonshine_model<F>(
    variant: &str,
    on_progress: F,
    cancel: Arc<AtomicBool>,
) -> Result<PathBuf>
where
    F: Fn(u64, u64) + Send + Sync + 'static,
{
    let spec = VARIANTS
        .iter()
        .find(|v| v.name == variant)
        .ok_or_else(|| anyhow::anyhow!("Unknown Moonshine variant: {variant}"))?;

    let final_dir = moonshine_model_dir(variant);
    let tmp_dir = moonshine_models_dir().join(format!("{variant}.tmp"));

    // Clean up any previous partial download.
    if tmp_dir.exists() {
        std::fs::remove_dir_all(&tmp_dir)?;
    }
    std::fs::create_dir_all(&tmp_dir)?;

    let total_bytes = spec.total_size_bytes;
    let mut bytes_done: u64 = 0;

    let client = reqwest::Client::new();

    for file in MODEL_FILES {
        if cancel.load(Ordering::SeqCst) {
            std::fs::remove_dir_all(&tmp_dir).ok();
            bail!("Download cancelled");
        }

        let url = cdn_url(variant, file);
        let dest = tmp_dir.join(file);

        tracing::info!("moonshine download: {url}");

        let mut response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to fetch {file}: {e}"))?;

        if !response.status().is_success() {
            std::fs::remove_dir_all(&tmp_dir).ok();
            bail!("HTTP {} for {file}", response.status());
        }

        let mut file_handle = tokio::fs::File::create(&dest).await?;

        use tokio::io::AsyncWriteExt;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| anyhow::anyhow!("Read error for {file}: {e}"))?
        {
            if cancel.load(Ordering::SeqCst) {
                drop(file_handle);
                std::fs::remove_dir_all(&tmp_dir).ok();
                bail!("Download cancelled");
            }
            file_handle.write_all(&chunk).await?;
            bytes_done = bytes_done.saturating_add(chunk.len() as u64);
            on_progress(bytes_done, total_bytes);
        }
    }

    // Atomic rename: tmp → final
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir)?;
    }
    std::fs::rename(&tmp_dir, &final_dir)?;

    tracing::info!("moonshine: all files downloaded to {:?}", final_dir);
    Ok(final_dir)
}

/// Delete a downloaded Moonshine variant.
pub fn delete_moonshine_model(variant: &str) -> Result<()> {
    let dir = moonshine_model_dir(variant);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}
