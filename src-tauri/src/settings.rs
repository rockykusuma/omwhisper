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
    /// Overlay placement: "top-center" | "top-left" | "top-right" | "bottom-center" | "bottom-left" | "bottom-right"
    #[serde(default = "default_overlay_placement")]
    pub overlay_placement: String,
    /// Overlay visual style: "micro" (compact bars-only pill) | "waveform" (larger bars + Listening label)
    #[serde(default = "default_overlay_style")]
    pub overlay_style: String,
    /// User-created custom polish styles.
    #[serde(default)]
    pub custom_polish_styles: Vec<crate::styles::CustomStyle>,
    /// When true, Whisper translates speech to English regardless of input language.
    #[serde(default)]
    pub translate_to_english: bool,
    /// Built-in LLM model filename (GGUF). Used when ai_backend == "built_in".
    #[serde(default = "default_llm_model_name")]
    pub llm_model_name: String,
    /// One-time nudge shown flag — prevents re-showing the "Enable AI cleanup" banner.
    #[serde(default)]
    pub llm_nudge_shown: bool,
    /// Apply AI polish to regular ⌘⇧V recordings using the Professional style.
    #[serde(default)]
    pub apply_polish_to_regular: bool,
    /// VAD engine: "silero" (neural ONNX) | "rms" (energy threshold fallback).
    #[serde(default = "default_vad_engine")]
    pub vad_engine: String,
    /// Transcription engine preference: "auto" | "apple" | "whisper".
    /// Defaults to "whisper" for reliability; "auto" selects Apple Speech on macOS if available.
    #[serde(default = "default_transcription_engine")]
    pub transcription_engine: String,
    /// Allow anonymous usage analytics via Aptabase. Default: true.
    #[serde(default = "default_true")]
    pub analytics_enabled: bool,
    /// Allow crash reports to be sent via Sentry. Default: true. Takes effect after restart.
    #[serde(default = "default_true")]
    pub crash_reporting_enabled: bool,
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
fn default_push_to_talk_hotkey() -> String { "Fn".to_string() }
fn default_ptt_key() -> String { "custom".to_string() }

fn default_true() -> bool { true }
fn default_sound_volume() -> f32 { 0.2 }
fn default_llm_model_name() -> String { "qwen2.5-0.5b-instruct-q4_k_m.gguf".to_string() }
fn default_vad_engine() -> String { "rms".to_string() }
fn default_transcription_engine() -> String { "whisper".to_string() }

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
            sound_volume: 0.2,
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
            push_to_talk_hotkey: "Fn".to_string(),
            ptt_key: "custom".to_string(),
            overlay_placement: "top-center".to_string(),
            overlay_style: "micro".to_string(),
            custom_polish_styles: Vec::new(),
            translate_to_english: false,
            llm_model_name: "qwen2.5-0.5b-instruct-q4_k_m.gguf".to_string(),
            llm_nudge_shown: false,
            apply_polish_to_regular: false,
            vad_engine: default_vad_engine(),
            transcription_engine: default_transcription_engine(),
            analytics_enabled: true,
            crash_reporting_enabled: true,
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
        Ok(content) => match serde_json::from_str::<Settings>(&content) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("settings.json parse error: {e} — reverting to defaults");
                // Back up the corrupt file so the user can recover it manually
                let backup = path.with_extension("json.bak");
                let _ = fs::copy(&path, &backup).await;
                Settings::default()
            }
        },
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

#[cfg(test)]
mod tests {
    use super::*;

    // ── defaults ─────────────────────────────────────────────────────────────

    #[test]
    fn default_hotkey() {
        assert_eq!(Settings::default().hotkey, "CmdOrCtrl+Shift+V");
    }

    #[test]
    fn default_model_is_tiny_en() {
        assert_eq!(Settings::default().active_model, "tiny.en");
    }

    #[test]
    fn default_language_is_en() {
        assert_eq!(Settings::default().language, "en");
    }

    #[test]
    fn default_auto_paste_true() {
        assert!(Settings::default().auto_paste);
    }

    #[test]
    fn default_auto_launch_false() {
        assert!(!Settings::default().auto_launch);
    }

    #[test]
    fn default_show_overlay_true() {
        assert!(Settings::default().show_overlay);
    }

    #[test]
    fn default_onboarding_not_complete() {
        assert!(!Settings::default().onboarding_complete);
    }

    #[test]
    fn default_vad_sensitivity() {
        assert!((Settings::default().vad_sensitivity - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn default_sound_enabled() {
        assert!(Settings::default().sound_enabled);
    }

    #[test]
    fn default_sound_volume() {
        assert!((Settings::default().sound_volume - 0.2).abs() < f32::EPSILON);
    }

    #[test]
    fn default_restore_clipboard() {
        assert!(Settings::default().restore_clipboard);
    }

    #[test]
    fn default_clipboard_restore_delay_ms() {
        assert_eq!(Settings::default().clipboard_restore_delay_ms, 2000);
    }

    #[test]
    fn default_recording_mode_is_toggle() {
        assert_eq!(Settings::default().recording_mode, "toggle");
    }

    #[test]
    fn default_vad_engine_is_rms() {
        assert_eq!(Settings::default().vad_engine, "rms");
    }

    #[test]
    fn default_analytics_enabled_is_true() {
        assert!(Settings::default().analytics_enabled);
    }

    #[test]
    fn default_crash_reporting_enabled_is_true() {
        assert!(Settings::default().crash_reporting_enabled);
    }

    #[test]
    fn analytics_fields_default_when_missing_from_json() {
        let json = r#"{"hotkey":"CmdOrCtrl+Shift+V","active_model":"tiny.en","language":"en","auto_launch":false,"auto_paste":true,"show_overlay":true,"vad_sensitivity":0.5,"onboarding_complete":false}"#;
        let s: Settings = serde_json::from_str(json).unwrap();
        assert!(s.analytics_enabled);
        assert!(s.crash_reporting_enabled);
    }

    #[test]
    fn default_ai_backend_is_disabled() {
        assert_eq!(Settings::default().ai_backend, "disabled");
    }

    #[test]
    fn default_ai_ollama_url() {
        assert_eq!(Settings::default().ai_ollama_url, "http://localhost:11434");
    }

    #[test]
    fn default_active_polish_style() {
        assert_eq!(Settings::default().active_polish_style, "professional");
    }

    #[test]
    fn default_translate_target_language() {
        assert_eq!(Settings::default().translate_target_language, "English");
    }

    #[test]
    fn default_overlay_placement() {
        assert_eq!(Settings::default().overlay_placement, "top-center");
    }

    #[test]
    fn default_overlay_style() {
        assert_eq!(Settings::default().overlay_style, "micro");
    }

    #[test]
    fn default_collections_empty() {
        let s = Settings::default();
        assert!(s.custom_vocabulary.is_empty());
        assert!(s.word_replacements.is_empty());
        assert!(s.custom_polish_styles.is_empty());
    }

    #[test]
    fn default_optional_fields_none() {
        let s = Settings::default();
        assert!(s.license_key.is_none());
        assert!(s.audio_input_device.is_none());
        assert!(s.auto_delete_after_days.is_none());
    }

    #[test]
    fn default_bool_flags_false() {
        let s = Settings::default();
        assert!(!s.translate_to_english);
        assert!(!s.llm_nudge_shown);
        assert!(!s.apply_polish_to_regular);
    }

    // ── serialization roundtrip ───────────────────────────────────────────────

    #[test]
    fn json_roundtrip_preserves_defaults() {
        let original = Settings::default();
        let json = serde_json::to_string(&original).unwrap();
        let restored: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.hotkey, original.hotkey);
        assert_eq!(restored.active_model, original.active_model);
        assert_eq!(restored.recording_mode, original.recording_mode);
        assert_eq!(restored.ai_backend, original.ai_backend);
    }

    #[test]
    fn json_roundtrip_preserves_custom_values() {
        let mut s = Settings::default();
        s.hotkey = "CmdOrCtrl+Shift+X".to_string();
        s.active_model = "small.en".to_string();
        s.auto_paste = false;
        s.custom_vocabulary = vec!["OmWhisper".to_string(), "Tauri".to_string()];
        s.word_replacements.insert("ok".to_string(), "OK".to_string());

        let json = serde_json::to_string(&s).unwrap();
        let restored: Settings = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.hotkey, "CmdOrCtrl+Shift+X");
        assert_eq!(restored.active_model, "small.en");
        assert!(!restored.auto_paste);
        assert_eq!(restored.custom_vocabulary, vec!["OmWhisper", "Tauri"]);
        assert_eq!(restored.word_replacements.get("ok"), Some(&"OK".to_string()));
    }

    #[test]
    fn partial_json_fills_missing_fields_with_defaults() {
        // Minimal JSON — only hotkey set, everything else missing
        let json = r#"{"hotkey":"CmdOrCtrl+Shift+Z","active_model":"base.en","language":"en","auto_launch":false,"auto_paste":true,"show_overlay":true,"vad_sensitivity":0.5,"onboarding_complete":false}"#;
        let s: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(s.hotkey, "CmdOrCtrl+Shift+Z");
        // Fields with #[serde(default)] should use defaults
        assert_eq!(s.recording_mode, "toggle");
        assert_eq!(s.ai_backend, "disabled");
        assert_eq!(s.overlay_placement, "top-center");
        assert_eq!(s.vad_engine, "rms");
        assert!(s.custom_vocabulary.is_empty());
    }

    // ── settings_path ─────────────────────────────────────────────────────────

    #[test]
    fn settings_path_ends_with_settings_json() {
        let path = settings_path();
        assert_eq!(path.file_name().unwrap(), "settings.json");
    }

    #[test]
    fn settings_path_contains_app_identifier() {
        let path = settings_path();
        assert!(path.to_string_lossy().contains("com.omwhisper.app"));
    }
}
