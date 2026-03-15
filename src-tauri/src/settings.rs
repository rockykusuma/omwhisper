use anyhow::{Context, Result};
use dirs::data_local_dir;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    /// Custom words/phrases fed to Whisper's initial_prompt to bias recognition.
    #[serde(default)]
    pub custom_vocabulary: Vec<String>,
    /// Word replacement mappings applied after transcription (e.g. "okay" → "OK").
    #[serde(default)]
    pub word_replacements: HashMap<String, String>,
    /// Play start/stop chimes when recording begins and ends.
    #[serde(default = "default_true")]
    pub sound_enabled: bool,
    /// Volume for start/stop chimes (0.0–1.0).
    #[serde(default = "default_sound_volume")]
    pub sound_volume: f32,
    /// Play the Om chant once on app launch.
    #[serde(default = "default_true")]
    pub launch_sound_enabled: bool,
    /// Restore previous clipboard contents after pasting transcription.
    #[serde(default = "default_true")]
    pub restore_clipboard: bool,
    /// Delay in milliseconds before restoring the clipboard.
    #[serde(default = "default_clipboard_restore_delay_ms")]
    pub clipboard_restore_delay_ms: u64,
    /// Recording trigger mode: "toggle" (press once to start, again to stop)
    /// or "push_to_talk" (hold to record, release to stop).
    #[serde(default = "default_recording_mode")]
    pub recording_mode: String,
    /// Auto-delete transcriptions older than this many days. None = keep forever.
    #[serde(default)]
    pub auto_delete_after_days: Option<u32>,
    /// AI backend: "ollama" | "cloud" | "disabled"
    #[serde(default = "default_ai_backend")]
    pub ai_backend: String,
    /// Ollama model name (e.g. "llama3.2")
    #[serde(default = "default_ai_ollama_model")]
    pub ai_ollama_model: String,
    /// Ollama base URL
    #[serde(default = "default_ai_ollama_url")]
    pub ai_ollama_url: String,
    /// Cloud API model (e.g. "gpt-4o-mini")
    #[serde(default = "default_ai_cloud_model")]
    pub ai_cloud_model: String,
    /// Cloud API base URL (OpenAI-compatible)
    #[serde(default = "default_ai_cloud_api_url")]
    pub ai_cloud_api_url: String,
    /// Timeout in seconds for AI requests
    #[serde(default = "default_ai_timeout_seconds")]
    pub ai_timeout_seconds: u32,
    /// Active polish style name
    #[serde(default = "default_active_polish_style")]
    pub active_polish_style: String,
    /// Target language for the Translate style
    #[serde(default = "default_translate_target_language")]
    pub translate_target_language: String,
    /// Smart Dictation hotkey
    #[serde(default = "default_smart_dictation_hotkey")]
    pub smart_dictation_hotkey: String,
    /// Dedicated Push-to-Talk hotkey combo (used when ptt_key == "custom")
    #[serde(default = "default_push_to_talk_hotkey")]
    pub push_to_talk_hotkey: String,
    /// Which key triggers PTT: "fn" | "control" | "left_option" | "right_option" | "custom"
    #[serde(default = "default_ptt_key")]
    pub ptt_key: String,
    /// Double-press the PTT key quickly to lock recording (hold not required).
    #[serde(default)]
    pub double_press_lock: bool,
    /// Overlay placement: "top-center" | "top-left" | "top-right" | "bottom-center" | "bottom-left" | "bottom-right"
    #[serde(default = "default_overlay_placement")]
    pub overlay_placement: String,
    /// Overlay visual style: "micro" (compact bars-only pill) | "waveform" (larger bars + Listening label)
    #[serde(default = "default_overlay_style")]
    pub overlay_style: String,
    /// User-created custom polish styles.
    #[serde(default)]
    pub custom_polish_styles: Vec<crate::styles::CustomStyle>,
}

fn default_clipboard_restore_delay_ms() -> u64 { 2000 }
fn default_recording_mode() -> String { "toggle".to_string() }
fn default_overlay_placement() -> String { "top-center".to_string() }
fn default_overlay_style() -> String { "micro".to_string() }
fn default_ai_backend() -> String { "disabled".to_string() }
fn default_ai_ollama_model() -> String { "llama3.2".to_string() }
fn default_ai_ollama_url() -> String { "http://localhost:11434".to_string() }
fn default_ai_cloud_model() -> String { "gpt-4o-mini".to_string() }
fn default_ai_cloud_api_url() -> String { "https://api.openai.com/v1".to_string() }
fn default_ai_timeout_seconds() -> u32 { 30 }
fn default_active_polish_style() -> String { "professional".to_string() }
fn default_translate_target_language() -> String { "English".to_string() }
fn default_smart_dictation_hotkey() -> String { "CmdOrCtrl+Shift+B".to_string() }
fn default_push_to_talk_hotkey() -> String { "CmdOrCtrl+Shift+X".to_string() }
fn default_ptt_key() -> String { "custom".to_string() }

fn default_true() -> bool { true }
fn default_sound_volume() -> f32 { 0.7 }

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
            custom_vocabulary: Vec::new(),
            word_replacements: HashMap::new(),
            sound_enabled: true,
            sound_volume: 0.7,
            launch_sound_enabled: true,
            restore_clipboard: true,
            clipboard_restore_delay_ms: 2000,
            recording_mode: "toggle".to_string(),
            auto_delete_after_days: None,
            ai_backend: "disabled".to_string(),
            ai_ollama_model: "llama3.2".to_string(),
            ai_ollama_url: "http://localhost:11434".to_string(),
            ai_cloud_model: "gpt-4o-mini".to_string(),
            ai_cloud_api_url: "https://api.openai.com/v1".to_string(),
            ai_timeout_seconds: 30,
            active_polish_style: "professional".to_string(),
            translate_target_language: "English".to_string(),
            smart_dictation_hotkey: "CmdOrCtrl+Shift+B".to_string(),
            push_to_talk_hotkey: "CmdOrCtrl+Shift+X".to_string(),
            ptt_key: "custom".to_string(),
            double_press_lock: false,
            overlay_placement: "top-center".to_string(),
            overlay_style: "micro".to_string(),
            custom_polish_styles: Vec::new(),
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

/// Synchronous settings load — for use in non-async contexts (e.g. shortcut handlers).
pub fn load_settings_sync() -> Settings {
    let path = settings_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
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
