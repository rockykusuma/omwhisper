use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// The single Parakeet variant shipped for v1.
pub const PARAKEET_V3_VARIANT: &str = "parakeet-tdt-0.6b-v3";

/// A file to download: `src` is the Hugging Face filename, `dest` is the name we
/// save it as locally (the base name `from_pretrained` expects).
pub struct DownloadFile {
    pub src: &'static str,
    pub dest: &'static str,
    pub approx_size_bytes: u64,
}

/// int8 export from `istupakov/parakeet-tdt-0.6b-v3-onnx`, saved under base names.
pub const DOWNLOAD_FILES: &[DownloadFile] = &[
    DownloadFile {
        src: "encoder-model.int8.onnx",
        dest: "encoder-model.onnx",
        approx_size_bytes: 652_000_000,
    },
    DownloadFile {
        src: "decoder_joint-model.int8.onnx",
        dest: "decoder_joint-model.onnx",
        approx_size_bytes: 18_200_000,
    },
    DownloadFile {
        src: "vocab.txt",
        dest: "vocab.txt",
        approx_size_bytes: 94_000,
    },
];

/// Files that must exist for the model to count as downloaded (the dest names).
const REQUIRED_FILES: &[&str] = &[
    "encoder-model.onnx",
    "decoder_joint-model.onnx",
    "vocab.txt",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParakeetModelInfo {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub size_label: String,
    pub total_size_bytes: u64,
    pub is_downloaded: bool,
}

/// Base directory for all Parakeet models.
pub fn parakeet_models_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.omwhisper.app")
        .join("models")
        .join("parakeet")
}

/// Directory for a specific Parakeet variant.
pub fn parakeet_model_dir(variant: &str) -> PathBuf {
    parakeet_models_dir().join(variant)
}

/// True if all required files exist for the variant.
pub fn is_parakeet_downloaded(variant: &str) -> bool {
    let dir = parakeet_model_dir(variant);
    REQUIRED_FILES.iter().all(|f| dir.join(f).exists())
}

fn total_download_bytes() -> u64 {
    DOWNLOAD_FILES.iter().map(|f| f.approx_size_bytes).sum()
}

/// List the (single) Parakeet model with its download status.
pub fn list_parakeet_models() -> Vec<ParakeetModelInfo> {
    vec![ParakeetModelInfo {
        name: PARAKEET_V3_VARIANT.to_string(),
        display_name: "Parakeet TDT 0.6B v3".to_string(),
        description:
            "Default engine. 25 European languages, auto-detect, punctuation & capitalization."
                .to_string(),
        size_label: "670 MB".to_string(),
        total_size_bytes: total_download_bytes(),
        is_downloaded: is_parakeet_downloaded(PARAKEET_V3_VARIANT),
    }]
}

/// Total disk usage of the downloaded Parakeet model (Settings → Storage).
#[allow(dead_code)]
pub fn parakeet_disk_usage() -> u64 {
    if !is_parakeet_downloaded(PARAKEET_V3_VARIANT) {
        return 0;
    }
    let dir = parakeet_model_dir(PARAKEET_V3_VARIANT);
    REQUIRED_FILES
        .iter()
        .filter_map(|f| std::fs::metadata(dir.join(f)).ok())
        .map(|m| m.len())
        .sum()
}

fn hf_url(file: &str) -> String {
    format!("https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/{file}")
}

/// Download all model files for the variant, saving each under its `dest` name.
/// Reports aggregate progress via `on_progress(bytes_done, bytes_total)`.
/// Downloads into a `.tmp` dir, then atomically renames to the final path.
pub async fn download_parakeet_model<F>(
    variant: &str,
    on_progress: F,
    cancel: Arc<AtomicBool>,
) -> Result<PathBuf>
where
    F: Fn(u64, u64) + Send + Sync + 'static,
{
    if variant != PARAKEET_V3_VARIANT {
        bail!("Unknown Parakeet variant: {variant}");
    }

    let final_dir = parakeet_model_dir(variant);
    let tmp_dir = parakeet_models_dir().join(format!("{variant}.tmp"));

    if tmp_dir.exists() {
        std::fs::remove_dir_all(&tmp_dir)?;
    }
    std::fs::create_dir_all(&tmp_dir)?;

    let total_bytes = total_download_bytes();
    let mut bytes_done: u64 = 0;
    let client = reqwest::Client::new();

    for file in DOWNLOAD_FILES {
        if cancel.load(Ordering::SeqCst) {
            std::fs::remove_dir_all(&tmp_dir).ok();
            bail!("Download cancelled");
        }

        let url = hf_url(file.src);
        let dest = tmp_dir.join(file.dest);
        tracing::info!("parakeet download: {url} -> {}", file.dest);

        let mut response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to fetch {}: {e}", file.src))?;

        if !response.status().is_success() {
            std::fs::remove_dir_all(&tmp_dir).ok();
            bail!("HTTP {} for {}", response.status(), file.src);
        }

        // Expected byte count for this file, so a truncated transfer (e.g. a
        // dropped connection that still ends "cleanly") is rejected rather than
        // saved as a corrupt model that fails at load time.
        let expected = response.content_length();
        let mut file_bytes: u64 = 0;

        let mut file_handle = tokio::fs::File::create(&dest).await?;
        use tokio::io::AsyncWriteExt;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| anyhow::anyhow!("Read error for {}: {e}", file.src))?
        {
            if cancel.load(Ordering::SeqCst) {
                drop(file_handle);
                std::fs::remove_dir_all(&tmp_dir).ok();
                bail!("Download cancelled");
            }
            file_handle.write_all(&chunk).await?;
            file_bytes = file_bytes.saturating_add(chunk.len() as u64);
            bytes_done = bytes_done.saturating_add(chunk.len() as u64);
            on_progress(bytes_done, total_bytes);
        }

        file_handle.flush().await?;
        if let Some(exp) = expected {
            if file_bytes != exp {
                drop(file_handle);
                std::fs::remove_dir_all(&tmp_dir).ok();
                bail!("Incomplete download for {}: got {file_bytes} of {exp} bytes", file.src);
            }
        }
    }

    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir)?;
    }
    std::fs::rename(&tmp_dir, &final_dir)?;
    tracing::info!("parakeet: all files downloaded to {:?}", final_dir);
    Ok(final_dir)
}

/// Delete the downloaded Parakeet model.
pub fn delete_parakeet_model(variant: &str) -> Result<()> {
    let dir = parakeet_model_dir(variant);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_dir_path_is_stable() {
        let dir = parakeet_model_dir(PARAKEET_V3_VARIANT);
        assert!(dir.ends_with("com.omwhisper.app/models/parakeet/parakeet-tdt-0.6b-v3"));
    }

    #[test]
    fn download_manifest_maps_source_to_base_names() {
        let enc = DOWNLOAD_FILES
            .iter()
            .find(|f| f.dest == "encoder-model.onnx")
            .unwrap();
        assert_eq!(enc.src, "encoder-model.int8.onnx");
        let dec = DOWNLOAD_FILES
            .iter()
            .find(|f| f.dest == "decoder_joint-model.onnx")
            .unwrap();
        assert_eq!(dec.src, "decoder_joint-model.int8.onnx");
        assert!(DOWNLOAD_FILES
            .iter()
            .any(|f| f.dest == "vocab.txt" && f.src == "vocab.txt"));
    }

    #[test]
    fn not_downloaded_when_dir_absent() {
        assert!(!is_parakeet_downloaded("does-not-exist-variant"));
    }
}
