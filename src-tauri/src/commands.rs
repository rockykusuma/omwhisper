use crate::audio::capture::AudioCapture;
use crate::whisper::{
    engine::{load_wav_as_f32, Segment, WhisperEngine},
    models::{self, ModelInfo},
};
use std::path::{Path, PathBuf};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Shared transcription state managed by Tauri's state system.
pub struct TranscriptionState {
    pub capture: Option<AudioCapture>,
    /// Signals the usage-tracking timer thread to stop.
    pub usage_running: Arc<AtomicBool>,
}

impl TranscriptionState {
    pub fn new() -> Self {
        TranscriptionState {
            capture: None,
            usage_running: Arc::new(AtomicBool::new(false)),
        }
    }
}

pub type SharedState = Arc<Mutex<TranscriptionState>>;

/// Resolve a possibly-relative model path.
/// In dev the binary is at src-tauri/target/debug/omwhisper — walk up 4 levels
/// to reach the project root, then join the relative path.
fn resolve_model_path(model_path: &str) -> PathBuf {
    let p = Path::new(model_path);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            // debug/  ->  target/  ->  src-tauri/  ->  project root
            exe.parent()?
                .parent()?
                .parent()?
                .parent()
                .map(|root| root.join(model_path))
        })
        .unwrap_or_else(|| p.to_path_buf())
}

#[tauri::command]
pub async fn transcribe_file(path: String, model_path: String) -> Result<Vec<Segment>, String> {
    tokio::task::spawn_blocking(move || {
        let resolved = resolve_model_path(&model_path);
        let engine = WhisperEngine::new(&resolved).map_err(|e| e.to_string())?;
        let audio = load_wav_as_f32(Path::new(&path)).map_err(|e| e.to_string())?;
        engine.transcribe(&audio).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Payload emitted to the frontend for each processed audio chunk.
#[derive(Clone, serde::Serialize)]
pub struct TranscriptionUpdate {
    pub segments: Vec<Segment>,
}

#[derive(Clone, serde::Serialize)]
pub struct UsageUpdate {
    pub seconds_used: i64,
    pub seconds_remaining: i64,
    pub is_free_tier: bool,
}

#[tauri::command]
pub async fn start_transcription(
    model: String,
    state: tauri::State<'_, SharedState>,
    app: AppHandle,
) -> Result<(), String> {
    // --- License / Usage gate ---
    let is_licensed = crate::license::is_active();
    if !is_licensed {
        let seconds_used = history::get_seconds_used_today().unwrap_or(0);
        if seconds_used >= history::FREE_TIER_SECONDS {
            return Err("free_tier_limit_reached".to_string());
        }
    }

    // Build capture object and start the audio pipeline.
    let capture = AudioCapture::new();
    let (speech_rx, level_rx) = capture.start().map_err(|e| e.to_string())?;

    // Store the capture handle so stop_transcription can reach it.
    let usage_running = {
        let mut s = state.lock().unwrap();
        s.capture = Some(capture);
        s.usage_running.store(true, Ordering::SeqCst);
        s.usage_running.clone()
    };

    let model_path = resolve_model_path(&model);

    // Spawn a thread to forward RMS level events to the frontend.
    let app_for_level = app.clone();
    std::thread::spawn(move || {
        for level in level_rx {
            let _ = app_for_level.emit("audio-level", level);
        }
    });

    // Spawn usage-tracking timer — ticks every 10 s, emits usage-update, enforces limit.
    let app_for_usage = app.clone();
    let usage_running_timer = usage_running.clone();
    let is_licensed_for_timer = is_licensed; // captured before async move
    std::thread::spawn(move || {
        const TICK: u64 = 10;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(TICK));
            if !usage_running_timer.load(Ordering::SeqCst) {
                break;
            }
            if !is_licensed_for_timer {
                let _ = history::add_seconds_today(TICK as i64);
                let seconds_used = history::get_seconds_used_today().unwrap_or(0);
                let seconds_remaining = (history::FREE_TIER_SECONDS - seconds_used).max(0);
                let _ = app_for_usage.emit("usage-update", UsageUpdate {
                    seconds_used,
                    seconds_remaining,
                    is_free_tier: true,
                });
                if seconds_used >= history::FREE_TIER_SECONDS {
                    // Signal frontend to stop recording
                    let _ = app_for_usage.emit("usage-limit-reached", ());
                    break;
                }
            }
        }
    });

    // Spawn a dedicated thread to load the model and consume speech utterances.
    // (WhisperEngine is not Send/Sync, so we keep it on one thread.)
    std::thread::spawn(move || {
        let engine = match WhisperEngine::new(&model_path) {
            Ok(e) => e,
            Err(err) => {
                eprintln!("failed to load whisper model: {err}");
                return;
            }
        };

        for chunk in speech_rx {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                engine.transcribe(&chunk)
            }));
            match result {
                Ok(Ok(segments)) => {
                    if !segments.is_empty() {
                        let _ = app.emit("transcription-update", TranscriptionUpdate { segments });
                    }
                }
                Ok(Err(err)) => tracing::error!("transcription error: {err}"),
                Err(_) => {
                    tracing::error!("whisper engine panicked — recovering");
                    let _ = app.emit("transcription-error", "Whisper crashed on this audio chunk, continuing.");
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_transcription(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    s.usage_running.store(false, Ordering::SeqCst);
    if let Some(capture) = s.capture.take() {
        capture.stop();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_available_models() -> Result<Vec<ModelInfo>, String> {
    Ok(crate::whisper::models::list_models())
}

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub name: String,
    pub progress: f64, // 0.0 to 1.0
    pub done: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn get_models() -> Result<Vec<ModelInfo>, String> {
    Ok(models::list_models())
}

#[tauri::command]
pub async fn download_model(name: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    let name_clone = name.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        let name_for_cb = name_clone.clone();
        let app_for_cb = app_clone.clone();

        let result = models::download_model(&name_clone, move |progress| {
            let _ = app_for_cb.emit(
                "download-progress",
                DownloadProgress {
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
                    "download-progress",
                    DownloadProgress {
                        name: name_clone,
                        progress: 1.0,
                        done: true,
                        error: None,
                    },
                );
            }
            Err(e) => {
                let _ = app_clone.emit(
                    "download-progress",
                    DownloadProgress {
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
pub async fn delete_model(name: String) -> Result<(), String> {
    models::delete_model(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_models_disk_usage() -> Result<u64, String> {
    Ok(models::models_disk_usage())
}

use crate::paste;
use std::sync::OnceLock;

/// Store the previously focused app name so we can paste back to it.
static PREVIOUS_APP: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn previous_app() -> &'static Mutex<Option<String>> {
    PREVIOUS_APP.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub async fn capture_focused_app() -> Result<Option<String>, String> {
    let app_name = paste::get_frontmost_app();
    *previous_app().lock().unwrap() = app_name.clone();
    Ok(app_name)
}

#[tauri::command]
pub async fn paste_transcription(text: String) -> Result<(), String> {
    // Always copy to clipboard
    paste::copy_to_clipboard(&text).map_err(|e| e.to_string())?;

    // Check auto_paste setting
    let settings = crate::settings::load_settings().await;
    if !settings.auto_paste {
        return Ok(());
    }

    // Get the previously focused app
    let app_name = {
        let guard = previous_app().lock().unwrap();
        guard.clone()
    };

    if let Some(name) = app_name {
        // Don't paste back into OmWhisper itself
        if name.to_lowercase().contains("omwhisper") {
            return Ok(());
        }
        tokio::task::spawn_blocking(move || {
            paste::paste_to_app(&name).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
    }

    Ok(())
}

#[tauri::command]
pub fn check_accessibility_permission() -> bool {
    paste::has_accessibility_permission()
}

#[tauri::command]
pub fn open_accessibility_settings() {
    paste::open_accessibility_settings();
}

use crate::history::{self, TranscriptionEntry};
use crate::settings::{self, Settings};

#[tauri::command]
pub async fn get_settings() -> Result<Settings, String> {
    Ok(settings::load_settings().await)
}

#[tauri::command]
pub async fn update_settings(new_settings: Settings) -> Result<(), String> {
    settings::save_settings(&new_settings).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_audio_devices() -> Vec<String> {
    settings::list_audio_devices()
}

#[tauri::command]
pub async fn is_first_launch() -> bool {
    let s = crate::settings::load_settings().await;
    !s.onboarding_complete
}

/// Returns true if the app is running directly from a mounted .dmg disk image.
/// Warns the user to drag to Applications before using.
#[tauri::command]
pub fn is_running_from_dmg() -> bool {
    if let Ok(exe) = std::env::current_exe() {
        let path = exe.to_string_lossy();
        // .dmg volumes are mounted under /Volumes/
        path.contains("/Volumes/")
    } else {
        false
    }
}

#[tauri::command]
pub async fn complete_onboarding() -> Result<(), String> {
    let mut s = crate::settings::load_settings().await;
    s.onboarding_complete = true;
    crate::settings::save_settings(&s).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("overlay") {
        // Position near top-center of screen
        if let Ok(Some(monitor)) = win.current_monitor() {
            let screen_size = monitor.size();
            let win_width = 320u32;
            let x = (screen_size.width as i32 - win_width as i32) / 2;
            let y = 60i32;
            let _ = win.set_position(tauri::PhysicalPosition { x, y });
        }
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("overlay") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn request_microphone_permission() -> Result<bool, String> {
    // On macOS, mic permission is requested when cpal tries to open input device.
    // We do a quick test open to trigger the permission dialog.
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    match host.default_input_device() {
        Some(device) => {
            match device.default_input_config() {
                Ok(_) => Ok(true),
                Err(_) => Ok(false),
            }
        }
        None => Ok(false),
    }
}

// ─── App info & diagnostics ──────────────────────────────────────────────────

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn get_debug_info() -> String {
    let version = env!("CARGO_PKG_VERSION");

    // macOS version
    let macos_version = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    // Hardware
    let hw_model = std::process::Command::new("sysctl")
        .args(["-n", "hw.model"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let chip = std::process::Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "Apple Silicon".to_string());

    // Models
    let models = crate::whisper::models::list_models();
    let downloaded: Vec<String> = models
        .iter()
        .filter(|m| m.is_downloaded)
        .map(|m| format!("{} ({})", m.name, m.size_label))
        .collect();

    // Usage & license
    let seconds_used = crate::history::get_seconds_used_today().unwrap_or(0);
    let license_status = match crate::license::get_status() {
        crate::license::LicenseStatus::Licensed => "Licensed",
        crate::license::LicenseStatus::GracePeriod => "GracePeriod",
        crate::license::LicenseStatus::Expired => "Expired",
        crate::license::LicenseStatus::Free => "Free",
    };

    let settings = crate::settings::load_settings().await;

    format!(
        "OmWhisper Debug Info\n\
         ====================\n\
         App Version:    {version}\n\
         macOS:          {macos_version}\n\
         Hardware:       {hw_model} / {chip}\n\
         \n\
         Active Model:   {}\n\
         Downloaded:     {}\n\
         \n\
         License:        {license_status}\n\
         Usage Today:    {}m {}s\n\
         Log Level:      {}\n",
        settings.active_model,
        if downloaded.is_empty() { "none".to_string() } else { downloaded.join(", ") },
        seconds_used / 60,
        seconds_used % 60,
        settings.log_level,
    )
}

// ─── License & Usage ─────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct UsageToday {
    pub seconds_used: i64,
    pub seconds_remaining: i64,
    pub is_free_tier: bool,
}

#[tauri::command]
pub async fn get_usage_today() -> Result<UsageToday, String> {
    let is_licensed = crate::license::is_active();
    let seconds_used = history::get_seconds_used_today().map_err(|e| e.to_string())?;
    let seconds_remaining = if is_licensed {
        i64::MAX
    } else {
        (history::FREE_TIER_SECONDS - seconds_used).max(0)
    };
    Ok(UsageToday {
        seconds_used,
        seconds_remaining,
        is_free_tier: !is_licensed,
    })
}

#[derive(serde::Serialize)]
pub struct LicenseInfoPayload {
    pub status: String,
    pub email: Option<String>,
    pub activated_on: Option<String>,
    pub last_validated: Option<String>,
}

#[tauri::command]
pub fn get_license_status() -> String {
    match crate::license::get_status() {
        crate::license::LicenseStatus::Licensed => "Licensed".to_string(),
        crate::license::LicenseStatus::GracePeriod => "GracePeriod".to_string(),
        crate::license::LicenseStatus::Expired => "Expired".to_string(),
        crate::license::LicenseStatus::Free => "Free".to_string(),
    }
}

#[tauri::command]
pub fn get_license_info() -> LicenseInfoPayload {
    let info = crate::license::get_info();
    let status_str = match info.status {
        crate::license::LicenseStatus::Licensed => "Licensed",
        crate::license::LicenseStatus::GracePeriod => "GracePeriod",
        crate::license::LicenseStatus::Expired => "Expired",
        crate::license::LicenseStatus::Free => "Free",
    }
    .to_string();
    LicenseInfoPayload {
        status: status_str,
        email: info.email,
        activated_on: info.activated_on,
        last_validated: info.last_validated,
    }
}

#[tauri::command]
pub async fn activate_license(key: String) -> Result<LicenseInfoPayload, String> {
    let info = crate::license::activate(&key).await?;
    let status_str = match info.status {
        crate::license::LicenseStatus::Licensed => "Licensed",
        crate::license::LicenseStatus::GracePeriod => "GracePeriod",
        crate::license::LicenseStatus::Expired => "Expired",
        crate::license::LicenseStatus::Free => "Free",
    }
    .to_string();
    Ok(LicenseInfoPayload {
        status: status_str,
        email: info.email,
        activated_on: info.activated_on,
        last_validated: info.last_validated,
    })
}

#[tauri::command]
pub async fn deactivate_license() -> Result<(), String> {
    crate::license::deactivate().await
}

#[tauri::command]
pub async fn validate_license_bg() -> String {
    match crate::license::validate().await {
        crate::license::LicenseStatus::Licensed => "Licensed".to_string(),
        crate::license::LicenseStatus::GracePeriod => "GracePeriod".to_string(),
        crate::license::LicenseStatus::Expired => "Expired".to_string(),
        crate::license::LicenseStatus::Free => "Free".to_string(),
    }
}

// ─── Transcription History ───────────────────────────────────────────────────

#[tauri::command]
pub fn save_transcription(text: String, duration_seconds: f64, model_used: String) -> Result<i64, String> {
    history::add_transcription(&text, duration_seconds, &model_used)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_history(limit: i64, offset: i64) -> Result<Vec<TranscriptionEntry>, String> {
    history::get_history(limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_history(query: String) -> Result<Vec<TranscriptionEntry>, String> {
    history::search_history(&query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_delete_transcription(id: i64) -> Result<(), String> {
    history::delete_transcription(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_export_history(format: String) -> Result<String, String> {
    history::export_history(&format).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_clear_history() -> Result<(), String> {
    history::clear_history().map_err(|e| e.to_string())
}
