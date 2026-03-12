use anyhow::{Context, Result};
use dirs::data_local_dir;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub hotkey: String,
    pub active_model: String,
    pub language: String,
    pub auto_launch: bool,
    pub auto_paste: bool,
    pub show_overlay: bool,
    pub audio_input_device: Option<String>,
    pub vad_sensitivity: f32,
    pub onboarding_complete: bool,
    #[serde(default)]
    pub license_key: Option<String>,
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

fn default_log_level() -> String {
    "normal".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            hotkey: "CmdOrCtrl+Shift+V".to_string(),
            active_model: "tiny.en".to_string(),
            language: "en".to_string(),
            auto_launch: false,
            auto_paste: true,
            show_overlay: true,
            audio_input_device: None,
            vad_sensitivity: 0.5,
            onboarding_complete: false,
            license_key: None,
            log_level: "normal".to_string(),
        }
    }
}

pub fn settings_path() -> PathBuf {
    data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.omwhisper.app")
        .join("settings.json")
}

pub async fn load_settings() -> Settings {
    let path = settings_path();
    match fs::read_to_string(&path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub async fn save_settings(settings: &Settings) -> Result<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.context("failed to create settings dir")?;
    }
    let content = serde_json::to_string_pretty(settings).context("failed to serialize settings")?;
    fs::write(&path, content).await.context("failed to write settings")?;
    Ok(())
}

/// List available audio input devices using cpal.
pub fn list_audio_devices() -> Vec<String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| {
            devices
                .filter_map(|d| d.name().ok())
                .collect()
        })
        .unwrap_or_default()
}
