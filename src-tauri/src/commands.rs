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
    /// True when the current recording was started via the Smart Dictation hotkey.
    pub is_smart_dictation: bool,
    /// Set by stop_transcription when capture is None (key released during startup delay).
    /// Causes start_transcription to abort after the sound delay.
    pub start_cancelled: bool,
}

impl TranscriptionState {
    pub fn new() -> Self {
        TranscriptionState {
            capture: None,
            usage_running: Arc::new(AtomicBool::new(false)),
            is_smart_dictation: false,
            start_cancelled: false,
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
    // 1. App data dir (production + bundle dev)
    if let Some(data_dir) = dirs::data_local_dir() {
        let prod = data_dir.join("com.omwhisper.app").join(model_path);
        if prod.exists() {
            return prod;
        }
    }
    // 2. Walk up from exe (cargo tauri dev: debug/ -> target/ -> src-tauri/ -> project root)
    if let Some(dev) = std::env::current_exe().ok().and_then(|exe| {
        exe.parent()?.parent()?.parent()?.parent().map(|r| r.join(model_path))
    }) {
        if dev.exists() {
            return dev;
        }
    }
    p.to_path_buf()
}

#[tauri::command]
pub async fn transcribe_file(path: String, model_path: String) -> Result<Vec<Segment>, String> {
    let settings = crate::settings::load_settings().await;
    let initial_prompt = build_initial_prompt(&settings.custom_vocabulary);
    let replacements = settings.word_replacements.clone();

    tokio::task::spawn_blocking(move || {
        let resolved = resolve_model_path(&model_path);
        let engine = WhisperEngine::new(&resolved).map_err(|e| e.to_string())?;
        let audio = load_wav_as_f32(Path::new(&path)).map_err(|e| e.to_string())?;
        let prompt = if initial_prompt.is_empty() { None } else { Some(initial_prompt.as_str()) };
        engine.transcribe(&audio, "en", false, prompt, &replacements).map_err(|e| e.to_string())
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

    // Clear any cancellation from a previous quick tap before we begin.
    state.lock().unwrap().start_cancelled = false;

    // Load settings and play start chime BEFORE the mic starts,
    // then wait briefly so the chime finishes and room echo clears.
    let settings = crate::settings::load_settings().await;
    let initial_prompt = build_initial_prompt(&settings.custom_vocabulary);
    let word_replacements = settings.word_replacements.clone();
    let language = settings.language.clone();
    let sound_enabled = settings.sound_enabled;
    let sound_volume = settings.sound_volume;
    let translate_to_english = settings.translate_to_english;

    if sound_enabled {
        crate::sounds::play(crate::sounds::Sound::Start, sound_volume);
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    // PTT: if the key was released during the sound delay, abort.
    // Return a sentinel error so the frontend knows not to set isRecording=true.
    if state.lock().unwrap().start_cancelled {
        state.lock().unwrap().start_cancelled = false;
        return Err("cancelled".to_string());
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

        let prompt_ref: Option<&str> = if initial_prompt.is_empty() { None } else { Some(&initial_prompt) };

        for chunk in speech_rx {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                engine.transcribe(&chunk, &language, translate_to_english, prompt_ref, &word_replacements)
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
        // All audio chunks have been processed — signal the frontend to paste/save
        let _ = app.emit("transcription-complete", ());
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_transcription(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    {
        let mut s = state.lock().unwrap();
        s.usage_running.store(false, Ordering::SeqCst);
        if let Some(capture) = s.capture.take() {
            capture.stop();
        } else {
            // Key released before capture started (during sound delay) — signal start to abort.
            s.start_cancelled = true;
        }
    } // MutexGuard dropped here before the await below

    let settings = crate::settings::load_settings().await;
    if settings.sound_enabled {
        crate::sounds::play(crate::sounds::Sound::Stop, settings.sound_volume);
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
pub async fn get_llm_models(_app: tauri::AppHandle) -> Result<Vec<llm_models::LlmModelInfo>, String> {
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

#[cfg(target_os = "macos")]
type LlmEngineState = std::sync::Arc<std::sync::Mutex<Option<crate::ai::llm::LlmEngine>>>;

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

use crate::paste;
use std::sync::OnceLock;

/// Store the previously focused app name so we can paste back to it.
static PREVIOUS_APP: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn previous_app() -> &'static Mutex<Option<String>> {
    PREVIOUS_APP.get_or_init(|| Mutex::new(None))
}

pub fn get_previous_app() -> &'static Mutex<Option<String>> {
    previous_app()
}

#[tauri::command]
pub async fn capture_focused_app() -> Result<Option<String>, String> {
    let app_name = paste::get_frontmost_app();
    *previous_app().lock().unwrap() = app_name.clone();
    Ok(app_name)
}

#[tauri::command]
pub async fn paste_transcription(text: String) -> Result<(), String> {
    let settings = crate::settings::load_settings().await;

    // Save previous clipboard before overwriting it
    let previous_clipboard = if settings.restore_clipboard {
        paste::read_clipboard()
    } else {
        None
    };

    // Copy transcription to clipboard
    paste::copy_to_clipboard(&text).map_err(|e| e.to_string())?;

    // Paste into previously focused app if auto_paste is on
    if settings.auto_paste {
        let app_name = {
            let guard = previous_app().lock().unwrap();
            guard.clone()
        };
        tracing::info!("paste_transcription: previous_app={:?}", app_name);
        if let Some(name) = app_name {
            if !name.to_lowercase().contains("omwhisper") {
                let result = tokio::task::spawn_blocking(move || {
                    paste::paste_to_app(&name).map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| e.to_string())?;
                if let Err(e) = result {
                    tracing::error!("paste_to_app failed: {}", e);
                    // Don't propagate — clipboard is already set, user can paste manually
                }
            } else {
                tracing::info!("paste_transcription: skipping paste — app is OmWhisper");
            }
        } else {
            tracing::warn!("paste_transcription: no previous_app captured");
        }
    }

    // Restore previous clipboard after a short delay
    if let Some(prev) = previous_clipboard {
        let delay = settings.clipboard_restore_delay_ms;
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            let _ = paste::copy_to_clipboard(&prev);
        });
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
pub async fn update_settings(app: tauri::AppHandle, new_settings: Settings) -> Result<(), String> {
    settings::save_settings(&new_settings).await.map_err(|e| e.to_string())?;
    let _ = app.emit("settings-changed", ());
    Ok(())
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
    let settings = crate::settings::load_settings().await;
    if let Some(win) = app.get_webview_window("overlay") {
        // The overlay window is hidden, so current_monitor() may return None.
        // Fall back to the main window's monitor so positioning always works.
        let monitor_opt = win.current_monitor().ok().flatten().or_else(|| {
            app.get_webview_window("main")
                .and_then(|m| m.current_monitor().ok().flatten())
        });

        if let Some(monitor) = monitor_opt {
            let scale  = monitor.scale_factor();
            let screen = monitor.size();    // physical pixels
            let origin = monitor.position(); // physical top-left of this monitor

            // Window logical dimensions → physical
            let (win_w, win_h) = if settings.overlay_style == "waveform" {
                ((280.0 * scale) as i32, (100.0 * scale) as i32)
            } else {
                ((110.0 * scale) as i32, (44.0 * scale) as i32)
            };

            // Logical-pixel margins → physical
            // top: just below the macOS menu bar (~24 logical px)
            // bottom: above the macOS Dock (~70 logical px tall by default)
            // side: small inset from screen edge
            let top_margin    = (28.0 * scale) as i32;
            let bottom_margin = (84.0 * scale) as i32;
            let side_margin   = (16.0 * scale) as i32;

            let sw = screen.width as i32;
            let sh = screen.height as i32;
            let ox = origin.x;
            let oy = origin.y;

            let (x, y) = match settings.overlay_placement.as_str() {
                "top-left"      => (ox + side_margin, oy + top_margin),
                "top-right"     => (ox + sw - win_w - side_margin, oy + top_margin),
                "bottom-center" => (ox + (sw - win_w) / 2, oy + sh - win_h - bottom_margin),
                "bottom-left"   => (ox + side_margin, oy + sh - win_h - bottom_margin),
                "bottom-right"  => (ox + sw - win_w - side_margin, oy + sh - win_h - bottom_margin),
                _               => (ox + (sw - win_w) / 2, oy + top_margin), // top-center default
            };
            let _ = win.set_position(tauri::PhysicalPosition { x, y });
        }
        win.show().map_err(|e| e.to_string())?;
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
    #[cfg(debug_assertions)]
    { return "Licensed".to_string(); }
    #[cfg(not(debug_assertions))]
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
pub fn save_transcription(
    text: String,
    duration_seconds: f64,
    model_used: String,
    source: Option<String>,
    raw_text: Option<String>,
    polish_style: Option<String>,
) -> Result<i64, String> {
    history::add_transcription(
        &text,
        duration_seconds,
        &model_used,
        source.as_deref().unwrap_or("raw"),
        raw_text.as_deref(),
        polish_style.as_deref(),
    )
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

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/// Build an initial_prompt string from a list of custom vocabulary words.
/// Whisper uses this as soft guidance to bias recognition toward these spellings.
pub fn build_initial_prompt(vocab: &[String]) -> String {
    if vocab.is_empty() {
        return String::new();
    }
    vocab.join(", ")
}

#[tauri::command]
pub async fn get_vocabulary() -> Result<serde_json::Value, String> {
    let settings = crate::settings::load_settings().await;
    Ok(serde_json::json!({
        "words": settings.custom_vocabulary,
        "replacements": settings.word_replacements,
    }))
}

#[tauri::command]
pub async fn add_vocabulary_word(word: String) -> Result<(), String> {
    let mut settings = crate::settings::load_settings().await;
    let word = word.trim().to_string();
    if !word.is_empty() && !settings.custom_vocabulary.contains(&word) {
        settings.custom_vocabulary.push(word);
        crate::settings::save_settings(&settings).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_vocabulary_word(word: String) -> Result<(), String> {
    let mut settings = crate::settings::load_settings().await;
    settings.custom_vocabulary.retain(|w| w != &word);
    crate::settings::save_settings(&settings).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn add_word_replacement(from: String, to: String) -> Result<(), String> {
    let mut settings = crate::settings::load_settings().await;
    let from = from.trim().to_string();
    let to = to.trim().to_string();
    if !from.is_empty() {
        settings.word_replacements.insert(from, to);
        crate::settings::save_settings(&settings).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_word_replacement(from: String) -> Result<(), String> {
    let mut settings = crate::settings::load_settings().await;
    settings.word_replacements.remove(&from);
    crate::settings::save_settings(&settings).await.map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Usage Stats ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_usage_stats() -> Result<crate::history::StatsSummary, String> {
    crate::history::get_stats_summary().map_err(|e| e.to_string())
}

// ─── Storage Info ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_storage_info() -> Result<crate::history::StorageInfo, String> {
    crate::history::get_storage_info().map_err(|e| e.to_string())
}

// ─── AI / Smart Dictation ─────────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct OllamaStatus {
    pub running: bool,
    pub models: Vec<String>,
}

#[tauri::command]
pub async fn check_ollama_status() -> OllamaStatus {
    let settings = crate::settings::load_settings().await;
    let running = crate::ai::ollama::check_status(&settings.ai_ollama_url).await;
    let models = if running {
        crate::ai::ollama::list_models(&settings.ai_ollama_url).await
    } else {
        vec![]
    };
    OllamaStatus { running, models }
}

#[tauri::command]
pub async fn get_ollama_models() -> Vec<String> {
    let settings = crate::settings::load_settings().await;
    crate::ai::ollama::list_models(&settings.ai_ollama_url).await
}

#[tauri::command]
pub async fn polish_text_cmd(
    text: String,
    style: String,
    force_builtin: Option<bool>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Manager;
    let settings = crate::settings::load_settings().await;

    let use_builtin = force_builtin == Some(true) || settings.ai_backend == "built_in";

    // built_in is intercepted here — ai::polish has no access to managed state
    #[cfg(target_os = "macos")]
    if use_builtin {
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
    if use_builtin {
        return Err("On-Device LLM is not available on this platform".to_string());
    }

    // ollama / cloud path — unchanged
    let system_prompt = crate::styles::system_prompt_for(&style, &settings.translate_target_language);
    let request = crate::ai::PolishRequest { text, system_prompt };
    crate::ai::polish(request, &settings)
        .await
        .map(|r| r.text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_ai_connection(backend: String) -> Result<String, String> {
    let settings = crate::settings::load_settings().await;
    let timeout = settings.ai_timeout_seconds;
    match backend.as_str() {
        "ollama" => {
            let running = crate::ai::ollama::check_status(&settings.ai_ollama_url).await;
            if running { Ok("Ollama is running".to_string()) }
            else { Err("Ollama is not running. Make sure it is installed and started.".to_string()) }
        }
        "cloud" => {
            let api_key = crate::ai::load_cloud_api_key()
                .ok_or("No API key configured. Add your API key first.".to_string())?;
            crate::ai::cloud::test_connection(
                &settings.ai_cloud_model,
                &settings.ai_cloud_api_url,
                &api_key,
                timeout,
            )
            .await
            .map(|_| "Connection successful".to_string())
            .map_err(|e| e.to_string())
        }
        _ => Err("Unknown backend".to_string()),
    }
}

#[tauri::command]
pub fn save_cloud_api_key(key: String) -> Result<(), String> {
    crate::ai::save_cloud_api_key(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_cloud_api_key_status() -> bool {
    crate::ai::load_cloud_api_key().is_some()
}

#[tauri::command]
pub fn delete_cloud_api_key_cmd() -> Result<(), String> {
    crate::ai::delete_cloud_api_key().map_err(|e| e.to_string())
}

// ─── Model Recommendation ────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct SystemSpec {
    pub total_ram_gb: f64,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub is_apple_silicon: bool,
}

#[derive(serde::Serialize)]
pub struct ModelRecommendation {
    pub recommended_model: String,
    pub reason: String,
    pub spec: SystemSpec,
}

#[tauri::command]
pub fn get_model_recommendation() -> ModelRecommendation {
    use sysinfo::System;

    let mut sys = System::new_all();
    sys.refresh_all();

    let total_ram_bytes = sys.total_memory();
    let total_ram_gb = total_ram_bytes as f64 / 1_073_741_824.0; // bytes → GB

    let cpu_brand = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default();
    let cpu_cores = sys.cpus().len();

    // Apple Silicon: use architecture (aarch64) as the reliable signal
    let is_apple_silicon = std::env::consts::ARCH == "aarch64";

    let (recommended_model, reason) = recommend_model(total_ram_gb, is_apple_silicon, cpu_cores);

    ModelRecommendation {
        recommended_model,
        reason,
        spec: SystemSpec {
            total_ram_gb: (total_ram_gb * 10.0).round() / 10.0,
            cpu_brand,
            cpu_cores,
            is_apple_silicon,
        },
    }
}

fn recommend_model(ram_gb: f64, is_apple_silicon: bool, _cores: usize) -> (String, String) {
    if is_apple_silicon {
        // Apple Silicon — Metal acceleration makes larger models practical.
        // For a quick-dictation/paste app, latency matters more than accuracy,
        // so we cap large-v3-turbo at 24GB+ where users expect best quality.
        if ram_gb >= 24.0 {
            ("large-v3-turbo".to_string(),
             format!("Your Apple Silicon Mac with {:.0}GB unified memory can run large-v3-turbo — near large-v3 accuracy at 8× the speed via Metal GPU acceleration.", ram_gb))
        } else if ram_gb >= 8.0 {
            ("small.en".to_string(),
             format!("Your Apple Silicon Mac with {:.0}GB unified memory is a great fit for small.en — fast, accurate, and snappy for quick dictation.", ram_gb))
        } else {
            ("base.en".to_string(),
             format!("Your Apple Silicon Mac with {:.0}GB unified memory will run base.en quickly — solid accuracy for everyday use.", ram_gb))
        }
    } else {
        // Intel / other — CPU-only inference, RAM is more limiting
        if ram_gb >= 32.0 {
            ("medium.en".to_string(),
             format!("Your Mac with {:.0}GB RAM can comfortably run medium.en — high accuracy for important recordings.", ram_gb))
        } else if ram_gb >= 16.0 {
            ("small.en".to_string(),
             format!("Your Mac with {:.0}GB RAM is well-suited for small.en — a reliable mix of speed and accuracy.", ram_gb))
        } else if ram_gb >= 8.0 {
            ("base.en".to_string(),
             format!("Your Mac with {:.0}GB RAM is a good fit for base.en — faster than small.en with solid results.", ram_gb))
        } else {
            ("tiny.en".to_string(),
             format!("Your Mac has {:.0}GB RAM; tiny.en keeps resource usage low while still delivering usable transcription.", ram_gb))
        }
    }
}

#[tauri::command]
pub fn get_platform() -> &'static str {
    if cfg!(target_os = "macos") { "macos" }
    else if cfg!(target_os = "windows") { "windows" }
    else { "linux" }
}
