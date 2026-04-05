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
    /// Guards the startup window (sound delay) to prevent overlapping sessions.
    pub is_starting: Arc<AtomicBool>,
    /// Timestamp when the current recording started (for duration_ms in analytics).
    pub recording_start_time: Option<std::time::Instant>,
    /// Name of the currently active transcription engine ("whisper" or "apple").
    pub active_engine: &'static str,
}

impl TranscriptionState {
    pub fn new() -> Self {
        TranscriptionState {
            capture: None,
            usage_running: Arc::new(AtomicBool::new(false)),
            is_smart_dictation: false,
            start_cancelled: false,
            is_starting: Arc::new(AtomicBool::new(false)),
            recording_start_time: None,
            active_engine: "whisper",
        }
    }
}

pub type SharedState = Arc<Mutex<TranscriptionState>>;

/// Cached transcription engine — avoids reloading the Whisper model (~500ms) on every session.
/// Stores the engine alongside the model path it was loaded for so the cache is automatically
/// invalidated when the user switches models.
pub type WhisperEngineCache = Arc<Mutex<Option<(crate::engine::TranscriptionEngine, std::path::PathBuf)>>>;

/// Tracks active model download cancellation tokens keyed by model name.
pub type DownloadCancelTokens = Arc<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>>;

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
        // File transcription always uses Whisper — Apple's Speech framework does not support
        // file-mode (buffer-based) transcription.
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


#[tauri::command]
pub async fn start_transcription(
    model: String,
    state: tauri::State<'_, SharedState>,
    engine_cache: tauri::State<'_, WhisperEngineCache>,
    app: AppHandle,
) -> Result<(), String> {
    // Guard against overlapping sessions (rapid hotkey taps during startup delay).
    let is_starting = state.lock().unwrap_or_else(|e| e.into_inner()).is_starting.clone();
    if is_starting.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("cancelled".to_string()); // already starting, treat as silent no-op
    }
    // Also reject if a capture session is already active.
    if state.lock().unwrap_or_else(|e| e.into_inner()).capture.is_some() {
        is_starting.store(false, Ordering::SeqCst);
        return Err("cancelled".to_string());
    }

    // Clear any cancellation from a previous quick tap before we begin.
    state.lock().unwrap_or_else(|e| e.into_inner()).start_cancelled = false;
    // Reset active_engine so get_transcription_engine never returns a stale value
    // from a previous session if engine selection fails later in this call.
    state.lock().unwrap_or_else(|e| e.into_inner()).active_engine = "whisper";

    // Load settings and play start chime BEFORE the mic starts,
    // then wait briefly so the chime finishes and room echo clears.
    let settings = crate::settings::load_settings().await;
    let initial_prompt = build_initial_prompt(&settings.custom_vocabulary);
    let word_replacements = settings.word_replacements.clone();
    let language = settings.language.clone();
    let sound_enabled = settings.sound_enabled;
    let sound_volume = settings.sound_volume;
    let translate_to_english = settings.translate_to_english;
    // Force Whisper when translate is enabled — Apple Speech has no translation capability.
    let engine_preference = if translate_to_english && settings.language != "en" {
        "whisper".to_string()
    } else {
        settings.transcription_engine.clone()
    };

    if sound_enabled {
        crate::sounds::play(crate::sounds::Sound::Start, sound_volume);
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    // PTT: if the key was released during the sound delay, abort.
    // Return a sentinel error so the frontend knows not to set isRecording=true.
    if state.lock().unwrap_or_else(|e| e.into_inner()).start_cancelled {
        state.lock().unwrap_or_else(|e| e.into_inner()).start_cancelled = false;
        is_starting.store(false, Ordering::SeqCst);
        return Err("cancelled".to_string());
    }

    // Analytics: record_started
    {
        let is_smart_dictation = state.lock().unwrap_or_else(|e| e.into_inner()).is_smart_dictation;
        crate::analytics::track(settings.analytics_enabled, "recording_started", serde_json::json!({
            "mode": if is_smart_dictation { "smart_dictation" } else { &settings.recording_mode as &str }
        }));
    }

    // Build capture object and start the audio pipeline.
    // AudioCapture::new signature is (vad_sensitivity, vad_engine) — sensitivity first, engine second.
    let capture = AudioCapture::new(settings.vad_sensitivity, &settings.vad_engine);
    let (speech_rx, level_rx) = capture.start(settings.audio_input_device.clone(), settings.live_text_streaming).map_err(|e| {
        is_starting.store(false, Ordering::SeqCst);
        e.to_string()
    })?;

    // Store the capture handle so stop_transcription can reach it, then clear the starting guard.
    {
        let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
        s.capture = Some(capture);
        s.recording_start_time = Some(std::time::Instant::now());
        s.usage_running.store(true, Ordering::SeqCst);
    };
    is_starting.store(false, Ordering::SeqCst);

    let model_path = resolve_model_path(&model);

    // Try to reuse a cached engine (avoids ~500ms model reload on every session).
    // Cache is invalidated automatically when the model path changes.
    let cached = {
        let mut guard = engine_cache.lock().unwrap_or_else(|e| e.into_inner());
        match guard.take() {
            Some((eng, path)) if path == model_path => {
                tracing::debug!("whisper: reusing cached engine for {:?}", model_path);
                Some(eng)
            }
            Some((eng, _)) => {
                tracing::debug!("whisper: model changed, dropping cached engine");
                drop(eng); // explicit drop makes intent clear
                None
            }
            None => None,
        }
    };

    // Load a fresh engine only when the cache missed.
    let engine = match cached {
        Some(e) => e,
        None => match crate::engine::TranscriptionEngine::select(&model_path, &engine_preference) {
            Ok(e) => e,
            Err(err) => {
                eprintln!("failed to select transcription engine: {err}");
                sentry_anyhow::capture_anyhow(&err);
                is_starting.store(false, Ordering::SeqCst);
                return Err(err.to_string());
            }
        },
    };
    // Capture the name before moving engine into the thread (borrow-checker requirement).
    let engine_name = engine.name();
    state.lock().unwrap_or_else(|e| e.into_inner()).active_engine = engine_name;

    // Spawn a thread to forward RMS level events to the frontend.
    let app_for_level = app.clone();
    std::thread::spawn(move || {
        for level in level_rx {
            let _ = app_for_level.emit("audio-level", level);
        }
    });

    // Clone the cache Arc so the transcription thread can return the engine when done.
    let engine_cache_for_thread = Arc::clone(&engine_cache);
    let model_path_for_thread = model_path.clone();

    // Spawn a dedicated thread to load the model and consume speech utterances.
    // TranscriptionEngine is Send (see engine.rs unsafe impl Send).
    std::thread::spawn(move || {
        // Convert prompt to owned String so it can be cloned into sub-threads.
        let prompt_owned: Option<String> = if initial_prompt.is_empty() { None } else { Some(initial_prompt) };

        // Wrap the engine in Option so we can move it in/out of sub-threads for the timeout guard.
        let mut engine_slot = Some(engine);

        'chunks: for chunk in speech_rx {
            let eng = match engine_slot.take() {
                Some(e) => e,
                None => break,
            };
            let lang = language.clone();
            let prompt_clone = prompt_owned.clone();
            let replacements = word_replacements.clone();
            let (tx, rx) = std::sync::mpsc::sync_channel(0);
            std::thread::spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let prompt_ref = prompt_clone.as_deref();
                    eng.transcribe(&chunk, &lang, translate_to_english, prompt_ref, &replacements)
                }));
                let _ = tx.send((eng, result));
            });

            const TRANSCRIPTION_TIMEOUT_SECS: u64 = 30;
            match rx.recv_timeout(std::time::Duration::from_secs(TRANSCRIPTION_TIMEOUT_SECS)) {
                Ok((eng_back, result)) => {
                    engine_slot = Some(eng_back);
                    match result {
                        Ok(Ok(segments)) => {
                            if !segments.is_empty() {
                                let _ = app.emit("transcription-update", TranscriptionUpdate { segments });
                            }
                        }
                        Ok(Err(err)) => {
                            tracing::error!("transcription error: {err}");
                            sentry_anyhow::capture_anyhow(&err);
                        }
                        Err(_) => {
                            tracing::error!("{engine_name} engine panicked — recovering");
                            let _ = app.emit("transcription-error", "Transcription engine crashed on this audio chunk, continuing.");
                        }
                    }
                }
                Err(_) => {
                    // Timeout — engine is leaking into the background thread but we can't interrupt it.
                    // At least surface the error to the user so they can stop recording.
                    tracing::error!("transcription timed out after {}s — aborting", TRANSCRIPTION_TIMEOUT_SECS);
                    let _ = app.emit("transcription-error", "Transcription timed out — please stop recording.");
                    break 'chunks;
                }
            }
        }
        // Return the engine to the cache so the next recording session can reuse it
        // without reloading the model from disk. Only cached on clean exit — a panicked
        // or timed-out engine is dropped (engine_slot is None in those cases).
        if let Some(eng) = engine_slot {
            let mut guard = engine_cache_for_thread.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some((eng, model_path_for_thread));
            tracing::debug!("whisper: engine returned to cache");
        }

        // All audio chunks have been processed — signal the frontend to paste/save
        let _ = app.emit("transcription-complete", ());
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_transcription(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    {
        let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
        s.usage_running.store(false, Ordering::SeqCst);
        if let Some(capture) = s.capture.take() {
            capture.stop();
        } else {
            // Key released before capture started (during sound delay) — signal start to abort.
            s.start_cancelled = true;
        }
    } // MutexGuard dropped here before the await below

    let duration_ms = {
        let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
        s.recording_start_time.take().map(|t| t.elapsed().as_millis() as u64).unwrap_or(0)
    };

    let settings = crate::settings::load_settings().await;
    if settings.sound_enabled {
        crate::sounds::play(crate::sounds::Sound::Stop, settings.sound_volume);
    }
    crate::analytics::track(settings.analytics_enabled, "transcription_completed", serde_json::json!({
        "model": &settings.active_model,
        "vad_engine": &settings.vad_engine,
        "duration_ms": duration_ms,
    }));
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
pub async fn download_model(
    name: String,
    app: tauri::AppHandle,
    cancel_tokens: tauri::State<'_, DownloadCancelTokens>,
) -> Result<(), String> {
    use tauri::Emitter;

    // Create a fresh cancel token for this download and store it.
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = cancel_tokens.lock().unwrap();
        map.insert(name.clone(), Arc::clone(&cancel_flag));
    }

    let name_clone = name.clone();
    let app_clone = app.clone();
    let cancel_tokens_clone = Arc::clone(&cancel_tokens);

    tokio::spawn(async move {
        let name_for_cb = name_clone.clone();
        let app_for_cb = app_clone.clone();
        let flag_for_cb = Arc::clone(&cancel_flag);

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
        }, Arc::clone(&flag_for_cb))
        .await;

        // Remove token regardless of outcome.
        cancel_tokens_clone.lock().unwrap().remove(&name_clone);

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
                let is_cancelled = e.to_string().contains("cancelled");
                if !is_cancelled {
                    sentry_anyhow::capture_anyhow(&e);
                }
                let _ = app_clone.emit(
                    "download-progress",
                    DownloadProgress {
                        name: name_clone,
                        progress: 0.0,
                        done: true,
                        error: if is_cancelled { None } else { Some(e.to_string()) },
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_model_download(
    name: String,
    cancel_tokens: tauri::State<'_, DownloadCancelTokens>,
) -> Result<(), String> {
    let map = cancel_tokens.lock().unwrap();
    if let Some(flag) = map.get(&name) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_model(
    name: String,
    engine_cache: tauri::State<'_, WhisperEngineCache>,
) -> Result<(), String> {
    // Invalidate the cache if the deleted model is currently loaded — avoids
    // a use-after-free where the next recording would try to use a missing file.
    {
        let mut guard = engine_cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, ref path)) = *guard {
            let deleted_path = resolve_model_path(&name);
            if *path == deleted_path {
                tracing::debug!("whisper: invalidating engine cache for deleted model {:?}", name);
                *guard = None;
            }
        }
    }
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

    let mut guard = engine_state.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(engine);
    Ok(())
}

// Plan extension (not in spec — added for completeness to allow backend switching without restart)
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn unload_llm_engine(
    engine_state: tauri::State<'_, LlmEngineState>,
) -> Result<(), String> {
    let mut guard = engine_state.lock().unwrap_or_else(|e| e.into_inner());
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
    *previous_app().lock().unwrap_or_else(|e| e.into_inner()) = app_name.clone();
    Ok(app_name)
}

#[tauri::command]
pub async fn paste_transcription(text: String, app: AppHandle) -> Result<(), String> {
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
            let guard = previous_app().lock().unwrap_or_else(|e| e.into_inner());
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
                    // If Accessibility permission is missing, notify the frontend
                    #[cfg(target_os = "macos")]
                    if !paste::has_accessibility_permission() {
                        let _ = app.emit("accessibility-permission-missing", ());
                    }
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
    // Sync autostart when auto_launch changes.
    {
        use tauri_plugin_autostart::ManagerExt;
        let autostart = app.autolaunch();
        if new_settings.auto_launch {
            let _ = autostart.enable();
        } else {
            let _ = autostart.disable();
        }
    }
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
    crate::settings::save_settings(&s).await.map_err(|e| e.to_string())?;
    crate::analytics::track(s.analytics_enabled, "onboarding_completed", serde_json::json!({}));
    Ok(())
}

/// On macOS, return the monitor that currently contains the mouse cursor.
/// CoreGraphics is already linked via paste.rs so no new dependency is needed.
/// The CG logical coordinate space matches Tauri's (physical / scale_factor)
/// so the bounding-box test is straightforward.
#[cfg(target_os = "macos")]
fn monitor_for_cursor(app: &tauri::AppHandle) -> Option<tauri::Monitor> {
    use std::os::raw::c_void;

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGPoint { x: f64, y: f64 }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *mut c_void) -> *mut c_void;
        fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    let cursor = unsafe {
        let event = CGEventCreate(std::ptr::null_mut());
        if event.is_null() { return None; }
        let pos = CGEventGetLocation(event);
        CFRelease(event);
        pos
    };

    // On macOS: CG logical coords == Tauri (physical / scale_factor)
    // because winit derives physical positions from NSScreen.frame * backing_scale.
    let monitors = app.available_monitors().ok()?;
    monitors.into_iter().find(|m| {
        let scale = m.scale_factor();
        let lx = m.position().x as f64 / scale;
        let ly = m.position().y as f64 / scale;
        let lw = m.size().width  as f64 / scale;
        let lh = m.size().height as f64 / scale;
        cursor.x >= lx && cursor.x < lx + lw && cursor.y >= ly && cursor.y < ly + lh
    }).or_else(|| app.primary_monitor().ok().flatten())
}

#[tauri::command]
pub async fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let settings = crate::settings::load_settings().await;
    if let Some(win) = app.get_webview_window("overlay") {
        // Use the monitor containing the mouse cursor — that is the screen
        // the user is actively working on. Falls back to primary monitor.
        #[cfg(target_os = "macos")]
        let monitor_opt = monitor_for_cursor(&app);
        #[cfg(not(target_os = "macos"))]
        let monitor_opt = app.primary_monitor().ok().flatten();

        if let Some(monitor) = monitor_opt {
            let scale  = monitor.scale_factor();
            let screen = monitor.size();    // physical pixels
            let origin = monitor.position(); // physical top-left of this monitor

            // Overlay logical dimensions — must match the overlay window config in tauri.conf.json.
            const OVERLAY_W: f64 = 340.0;
            const OVERLAY_H: f64 = 220.0;

            // Force the window to apply its configured size before reading it back.
            // outer_size() returns (0,0) before the window has ever been rendered;
            // set_size() ensures the dimensions are committed so the read is reliable.
            let _ = win.set_size(tauri::LogicalSize::<f64> { width: OVERLAY_W, height: OVERLAY_H });
            let actual = win.outer_size().unwrap_or(tauri::PhysicalSize {
                width:  (OVERLAY_W * scale) as u32,
                height: (OVERLAY_H * scale) as u32,
            });
            let win_w = actual.width as i32;
            let win_h = actual.height as i32;

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
        let _ = app.emit("recording-state", true);
        win.show().map_err(|e| e.to_string())?;
        // NSWindow operations must run on the main thread
        #[cfg(target_os = "macos")]
        {
            let win_clone = win.clone();
            let _ = win.run_on_main_thread(move || set_overlay_window_level(&win_clone));
        }
    }
    Ok(())
}

/// Set the overlay window to NSStatusWindowLevel (25) so it floats above all app windows.
/// Tauri's built-in set_always_on_top only reaches NSFloatingWindowLevel (3), which
/// is insufficient when other apps are focused.
#[cfg(target_os = "macos")]
fn set_overlay_window_level(win: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let ns_window = match win.ns_window() {
        Ok(w) => w as *mut AnyObject,
        Err(_) => return,
    };

    unsafe {
        // NSStatusWindowLevel = 25 — above all normal app windows, below screensaver
        let _: () = msg_send![ns_window, setLevel: 25isize];
    }
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
pub async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_microphone_auth_status() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return crate::macos::speech_analyzer::get_microphone_auth_status();
    }
    #[cfg(not(target_os = "macos"))]
    {
        "authorized"
    }
}

#[tauri::command]
pub fn open_microphone_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn();
    }
}

#[tauri::command]
pub async fn check_microphone_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(crate::macos::speech_analyzer::check_microphone_permission());
    }
    #[cfg(not(target_os = "macos"))]
    {
        // On Windows, assume granted if a default input device exists
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        Ok(host.default_input_device().map_or(false, |d| d.default_input_config().is_ok()))
    }
}

#[tauri::command]
pub async fn request_microphone_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        // Use AVCaptureDevice.requestAccess — the proper macOS TCC path that shows
        // the system permission dialog and waits for the user's response.
        // spawn_blocking because the Swift shim uses DispatchSemaphore.wait() which
        // would block the Tokio executor thread if called directly from async context.
        return tauri::async_runtime::spawn_blocking(
            crate::macos::speech_analyzer::request_microphone_permission
        ).await.map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        // On Windows, cpal opens the mic without a permission dialog.
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        match host.default_input_device() {
            Some(device) => Ok(device.default_input_config().is_ok()),
            None => Ok(false),
        }
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
            let guard = engine_state.lock().unwrap_or_else(|e| e.into_inner());
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

    // ollama / cloud path
    let system_prompt = crate::styles::system_prompt_for(&style, &settings.translate_target_language);
    // For smart_correct, wrap in Input:/Output: format to match the few-shot examples
    // in the system prompt — this forces the model to continue the pattern instead of answering.
    let user_text = if style == "smart_correct" {
        format!("Input: {}\nOutput:", text)
    } else {
        text
    };
    let request = crate::ai::PolishRequest { text: user_text, system_prompt };
    let result = crate::ai::polish(request, &settings)
        .await
        .map(|r| r.text)
        .map_err(|e| e.to_string());
    if result.is_ok() {
        crate::analytics::track(settings.analytics_enabled, "ai_polish_used", serde_json::json!({
            "backend": &settings.ai_backend,
            "style": &settings.active_polish_style,
        }));
    }
    result
}

/// Copy the current text selection, run AI polish using the active style, paste back.
#[tauri::command]
pub async fn polish_selected_text(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::{Emitter, Manager};

    // Save original clipboard for restore later
    let original_clipboard = crate::paste::read_clipboard();

    // Capture frontmost app before doing anything
    let frontmost = crate::paste::get_frontmost_app();

    // Plant a sentinel so we can detect "nothing was selected" even when the
    // selection matches what was already in the clipboard.
    const SENTINEL: &str = "__omwhisper_copy_sentinel__";
    if let Ok(mut cb) = arboard::Clipboard::new() {
        let _ = cb.set_text(SENTINEL);
    }

    // Simulate Cmd+C to copy selection (macOS only)
    #[cfg(target_os = "macos")]
    crate::paste::simulate_copy();
    #[cfg(not(target_os = "macos"))]
    return Err("Polish Selected Text is only supported on macOS".to_string());

    // Wait for clipboard to settle
    tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

    // Read the updated clipboard — if still sentinel (or empty), nothing was selected
    let text = crate::paste::read_clipboard()
        .ok_or_else(|| "No text selected".to_string())?;

    if text == SENTINEL {
        // Restore original clipboard so we don't leave the sentinel behind
        if let (Ok(mut cb), Some(orig)) = (arboard::Clipboard::new(), original_clipboard) {
            let _ = cb.set_text(&orig);
        }
        return Err("No text selected".to_string());
    }

    // Show overlay window so user has visual feedback (shown before polish-state so it
    // renders in polishing mode from the first frame, not the recording waveform mode)
    let overlay_was_hidden = app
        .get_webview_window("overlay")
        .map(|w| !w.is_visible().unwrap_or(false))
        .unwrap_or(false);
    // Use show_overlay so the window is repositioned to the correct monitor
    // (same cursor-based monitor detection used for recording). The recording-state:true
    // event it emits is immediately overridden by polish-state:true below.
    if overlay_was_hidden {
        let _ = show_overlay(app.clone()).await;
    }

    // Notify frontend that polishing is in progress
    let _ = app.emit("polish-state", true);

    // Load settings and get active style
    let settings = crate::settings::load_settings().await;
    let style = settings.active_polish_style.clone();

    // Polish using the existing pipeline
    let polished = polish_text_cmd(text, style, None, app.clone()).await
        .map_err(|e| {
            let _ = app.emit("polish-state", false);
            if overlay_was_hidden {
                if let Some(w) = app.get_webview_window("overlay") { let _ = w.hide(); }
            }
            e
        })?;

    // Write polished text to clipboard
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let _ = clipboard.set_text(&polished);
    }

    // Paste into the focused app — paste_to_app blocks for ~500ms (osascript + sleep)
    // so it must run on a blocking thread, not the async executor.
    if let Some(app_name) = frontmost {
        #[cfg(target_os = "macos")]
        {
            let result = tokio::task::spawn_blocking(move || {
                crate::paste::paste_to_app(&app_name).map_err(|e| e.to_string())
            })
            .await
            .unwrap_or_else(|e| Err(e.to_string()));
            if let Err(e) = result {
                tracing::warn!("polish_selected_text: paste failed: {}", e);
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = app_name;
    }

    // Restore original clipboard after delay if setting is enabled
    if settings.restore_clipboard {
        if let Some(orig) = original_clipboard {
            let delay = settings.clipboard_restore_delay_ms;
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                if let Ok(mut cb) = arboard::Clipboard::new() {
                    let _ = cb.set_text(&orig);
                }
            });
        }
    }

    let _ = app.emit("polish-state", false);

    // Hide the overlay quickly so the green recording pill never has time to flash
    if overlay_was_hidden {
        let app_clone = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            if let Some(w) = app_clone.get_webview_window("overlay") {
                let _ = w.hide();
            }
        });
    }

    Ok(polished)
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
            let api_key = settings.cloud_api_key.clone()
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
pub async fn save_cloud_api_key(key: String) -> Result<(), String> {
    crate::ai::save_cloud_api_key(&key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_cloud_api_key_status() -> bool {
    let settings = crate::settings::load_settings().await;
    settings.cloud_api_key.is_some()
}

#[tauri::command]
pub async fn delete_cloud_api_key_cmd() -> Result<(), String> {
    crate::ai::delete_cloud_api_key().await.map_err(|e| e.to_string())
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

#[tauri::command]
pub fn open_external_url(url: String, app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

/// Send beta feedback via Resend email API.
/// RESEND_KEY must be set at build time via the environment variable.
#[tauri::command]
pub async fn send_feedback(
    category: String,
    message: String,
    user_email: Option<String>,
    app_version: String,
    debug_info: String,
) -> Result<(), String> {
    const RESEND_API_KEY: &str = match option_env!("RESEND_API_KEY") {
        Some(k) => k,
        None => "",
    };

    if RESEND_API_KEY.is_empty() {
        return Err("Feedback is not configured in this build.".to_string());
    }

    let from_label = user_email
        .as_deref()
        .filter(|e| !e.is_empty())
        .unwrap_or("anonymous");

    let subject = format!("[Feedback] {} — OmWhisper v{}", category, app_version);

    let html = format!(
        r#"<h3>Category</h3><p>{category}</p>
<h3>Message</h3><p style="white-space:pre-wrap">{message}</p>
<h3>From</h3><p>{from_label}</p>
<h3>Debug Info</h3><pre style="font-size:12px;background:#f4f4f4;padding:12px;border-radius:6px">{debug_info}</pre>"#,
        category = category,
        message = message,
        from_label = from_label,
        debug_info = debug_info,
    );

    let body = serde_json::json!({
        "from": "OmWhisper Beta <feedback@omwhisper.in>",
        "to": ["feedback@omwhisper.in"],
        "subject": subject,
        "html": html,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.resend.com/emails")
        .bearer_auth(RESEND_API_KEY)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("Resend API error {}: {}", status, text))
    }
}

// ─── Transcription Engine ─────────────────────────────────────────────────────

/// Returns the name of the currently active transcription engine ("whisper" or "apple").
#[tauri::command]
pub fn get_transcription_engine(state: tauri::State<'_, SharedState>) -> &'static str {
    state.lock().unwrap_or_else(|e| e.into_inner()).active_engine
}

/// Returns whether Apple Speech is available on this device.
/// Always false on non-macOS and in dev mode (no .app bundle).
#[tauri::command]
pub fn is_apple_speech_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        return crate::macos::speech_analyzer::SpeechAnalyzerEngine::is_available();
    }
    #[cfg(not(target_os = "macos"))]
    false
}

/// Returns the Speech Recognition authorization status: "authorized" | "not_determined" | "denied".
/// On non-macOS always returns "denied".
#[tauri::command]
pub fn get_apple_speech_auth_status() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return crate::macos::speech_analyzer::apple_speech_auth_status();
    }
    #[cfg(not(target_os = "macos"))]
    "denied"
}

/// Shows the system Speech Recognition permission dialog (if not yet determined).
/// Blocks until the user responds. Returns true if granted.
#[tauri::command]
pub async fn request_speech_recognition_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        return tauri::async_runtime::spawn_blocking(
            crate::macos::speech_analyzer::request_speech_recognition_permission
        ).await.unwrap_or(false);
    }
    #[cfg(not(target_os = "macos"))]
    false
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(()); // already up to date
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::TranscriptionState;

    #[test]
    fn transcription_state_default_active_engine_is_whisper() {
        let state = TranscriptionState::new();
        assert_eq!(state.active_engine, "whisper");
    }
}
