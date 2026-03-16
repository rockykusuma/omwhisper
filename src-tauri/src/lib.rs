mod audio;
mod whisper;
mod commands;
mod settings;
mod paste;
mod history;
mod license;
mod updater;
mod sounds;
mod ai;
mod styles;
#[cfg(target_os = "macos")]
mod fn_key;

use commands::{
    activate_license, capture_focused_app, check_accessibility_permission, cmd_clear_history,
    cmd_delete_transcription, cmd_export_history, complete_onboarding, deactivate_license,
    delete_model, download_model, get_app_version, get_audio_devices, get_available_models,
    get_debug_info, get_history, get_license_info, get_license_status, get_models,
    get_models_disk_usage, get_settings, get_usage_today, hide_overlay, is_first_launch,
    is_running_from_dmg, open_accessibility_settings, paste_transcription, request_microphone_permission,
    save_transcription, search_history, show_overlay, start_transcription, stop_transcription,
    transcribe_file, update_settings, validate_license_bg,
    get_vocabulary, add_vocabulary_word, remove_vocabulary_word, add_word_replacement, remove_word_replacement,
    get_usage_stats, get_storage_info,
    check_ollama_status, get_ollama_models, polish_text_cmd, test_ai_connection,
    save_cloud_api_key, get_cloud_api_key_status, delete_cloud_api_key_cmd,
    get_model_recommendation,
    SharedState, TranscriptionState,
};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Ensure only one instance runs. Returns false if another instance is already running.
fn ensure_single_instance() -> bool {
    let lock_path = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.omwhisper.app")
        .join(".lock");

    if let Ok(content) = std::fs::read_to_string(&lock_path) {
        if let Ok(pid) = content.trim().parse::<u32>() {
            let is_running = std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if is_running && pid != std::process::id() {
                return false;
            }
        }
    }
    if let Some(parent) = lock_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&lock_path, std::process::id().to_string());
    true
}

/// Set up file-based logging with daily rotation.
fn setup_logging() -> tracing_appender::non_blocking::WorkerGuard {
    let log_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.omwhisper.app")
        .join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    let file_appender = tracing_appender::rolling::daily(&log_dir, "omwhisper.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::fmt()
        .with_writer(non_blocking)
        .with_ansi(false)
        .init();

    guard
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Single instance guard
    if !ensure_single_instance() {
        eprintln!("OmWhisper is already running.");
        std::process::exit(0);
    }

    // Set up file logging (guard must live for the duration of the app)
    let _log_guard = setup_logging();
    tracing::info!("OmWhisper v{} starting", env!("CARGO_PKG_VERSION"));

    let shared_state: SharedState = Arc::new(Mutex::new(TranscriptionState::new()));

    tauri::Builder::default()
        .manage(shared_state.clone())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            // --- System Tray ---
            let current_settings = crate::settings::load_settings_sync();
            let selected_device = current_settings.audio_input_device.clone().unwrap_or_default();
            let device_names = crate::settings::list_audio_devices();

            let toggle_item   = MenuItem::with_id(app, "toggle",   "Start Recording", true, None::<&str>)?;
            let sep1          = PredefinedMenuItem::separator(app)?;
            let show_item     = MenuItem::with_id(app, "show",     "Show Window",     true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings…",       true, None::<&str>)?;
            let sep2          = PredefinedMenuItem::separator(app)?;

            // Microphone submenu — check-mark on the currently selected device
            let mic_items: Vec<MenuItem<_>> = if device_names.is_empty() {
                vec![MenuItem::with_id(app, "mic_none", "No devices found", false, None::<&str>)?]
            } else {
                device_names.iter().map(|d| {
                    let label = if *d == selected_device { format!("✓  {}", d) } else { d.clone() };
                    MenuItem::with_id(app, format!("mic:{}", d), label, true, None::<&str>)
                }).collect::<std::result::Result<Vec<_>, _>>()?
            };
            let mic_refs: Vec<&dyn tauri::menu::IsMenuItem<_>> =
                mic_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<_>).collect();
            let mic_submenu = Submenu::with_items(app, "Microphone", true, &mic_refs)?;

            let sep3      = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit OmWhisper", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[
                &toggle_item,
                &sep1,
                &show_item,
                &settings_item,
                &sep2,
                &mic_submenu,
                &sep3,
                &quit_item,
            ])?;

            let tray_icon = {
                const TRAY_PNG: &[u8] = include_bytes!("../icons/tray-icon@2x.png");
                let img = image::load_from_memory_with_format(TRAY_PNG, image::ImageFormat::Png)
                    .map(|i| i.into_rgba8())
                    .ok();
                if let Some(rgba) = img {
                    let (w, h) = (rgba.width(), rgba.height());
                    tauri::image::Image::new_owned(rgba.into_raw(), w, h)
                } else {
                    app.default_window_icon().unwrap().clone()
                }
            };

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("OmWhisper — Click to toggle recording")
                .icon(tray_icon)
                .icon_as_template(true)
                .on_menu_event({
                    let state = shared_state.clone();
                    move |app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                #[cfg(target_os = "macos")]
                                let _ = app.show();
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "settings" => {
                            if let Some(win) = app.get_webview_window("main") {
                                #[cfg(target_os = "macos")]
                                let _ = app.show();
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                            let _ = app.emit("tray-navigate", "settings");
                        }
                        "toggle" => {
                            let is_recording = state.lock().unwrap().capture.is_some();
                            if is_recording {
                                let mut s = state.lock().unwrap();
                                s.usage_running.store(false, std::sync::atomic::Ordering::SeqCst);
                                if let Some(capture) = s.capture.take() {
                                    capture.stop();
                                }
                                let _ = app.emit("recording-state", false);
                            } else {
                                let _ = app.emit("hotkey-toggle-recording", ());
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        id if id.starts_with("mic:") => {
                            let device_name = id.trim_start_matches("mic:").to_string();
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let mut s = crate::settings::load_settings().await;
                                s.audio_input_device = Some(device_name);
                                if let Err(e) = crate::settings::save_settings(&s).await {
                                    tracing::error!("Failed to save mic selection: {}", e);
                                }
                                let _ = app_handle.emit("settings-changed", ());
                            });
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                #[cfg(target_os = "macos")]
                                let _ = app.show();
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // --- Helper: parse "CmdOrCtrl+Shift+V" → Shortcut ---
            fn parse_hotkey(s: &str) -> Option<Shortcut> {
                let mut mods = Modifiers::empty();
                let mut key = None;
                for part in s.split('+') {
                    match part.trim() {
                        "CmdOrCtrl" | "Cmd" | "Super" => mods |= Modifiers::SUPER,
                        "Shift"                        => mods |= Modifiers::SHIFT,
                        "Alt" | "Option"               => mods |= Modifiers::ALT,
                        "Ctrl" | "Control"             => mods |= Modifiers::CONTROL,
                        k => key = match k {
                            // Letters
                            "A" => Some(Code::KeyA), "B" => Some(Code::KeyB),
                            "C" => Some(Code::KeyC), "D" => Some(Code::KeyD),
                            "E" => Some(Code::KeyE), "F" => Some(Code::KeyF),
                            "G" => Some(Code::KeyG), "H" => Some(Code::KeyH),
                            "I" => Some(Code::KeyI), "J" => Some(Code::KeyJ),
                            "K" => Some(Code::KeyK), "L" => Some(Code::KeyL),
                            "M" => Some(Code::KeyM), "N" => Some(Code::KeyN),
                            "O" => Some(Code::KeyO), "P" => Some(Code::KeyP),
                            "Q" => Some(Code::KeyQ), "R" => Some(Code::KeyR),
                            "S" => Some(Code::KeyS), "T" => Some(Code::KeyT),
                            "U" => Some(Code::KeyU), "V" => Some(Code::KeyV),
                            "W" => Some(Code::KeyW), "X" => Some(Code::KeyX),
                            "Y" => Some(Code::KeyY), "Z" => Some(Code::KeyZ),
                            // Digits
                            "0" => Some(Code::Digit0), "1" => Some(Code::Digit1),
                            "2" => Some(Code::Digit2), "3" => Some(Code::Digit3),
                            "4" => Some(Code::Digit4), "5" => Some(Code::Digit5),
                            "6" => Some(Code::Digit6), "7" => Some(Code::Digit7),
                            "8" => Some(Code::Digit8), "9" => Some(Code::Digit9),
                            // Function keys
                            "F1"  => Some(Code::F1),  "F2"  => Some(Code::F2),
                            "F3"  => Some(Code::F3),  "F4"  => Some(Code::F4),
                            "F5"  => Some(Code::F5),  "F6"  => Some(Code::F6),
                            "F7"  => Some(Code::F7),  "F8"  => Some(Code::F8),
                            "F9"  => Some(Code::F9),  "F10" => Some(Code::F10),
                            "F11" => Some(Code::F11), "F12" => Some(Code::F12),
                            // Special keys
                            "Space"     => Some(Code::Space),
                            "CapsLock"  => Some(Code::CapsLock),
                            "Tab"       => Some(Code::Tab),
                            "Enter"     => Some(Code::Enter),
                            "Backspace" => Some(Code::Backspace),
                            "Delete"    => Some(Code::Delete),
                            "Escape"    => Some(Code::Escape),
                            "ArrowUp"   => Some(Code::ArrowUp),
                            "ArrowDown" => Some(Code::ArrowDown),
                            "ArrowLeft" => Some(Code::ArrowLeft),
                            "ArrowRight"=> Some(Code::ArrowRight),
                            "Home"      => Some(Code::Home),
                            "End"       => Some(Code::End),
                            "PageUp"    => Some(Code::PageUp),
                            "PageDown"  => Some(Code::PageDown),
                            _ => None,
                        },
                    }
                }
                key.map(|k| Shortcut::new(if mods.is_empty() { None } else { Some(mods) }, k))
            }

            let initial_settings = crate::settings::load_settings_sync();

            // --- Toggle shortcut: press once to start, press again to stop ---
            let toggle_sc = parse_hotkey(&initial_settings.hotkey)
                .unwrap_or_else(|| Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyV));
            let state_toggle = shared_state.clone();
            app.global_shortcut().on_shortcut(toggle_sc, move |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed { return; }
                let is_recording = state_toggle.lock().unwrap().capture.is_some();
                if is_recording {
                    let _ = app.emit("hotkey-stop-recording", ());
                } else {
                    let focused = crate::paste::get_frontmost_app();
                    tracing::info!("toggle hotkey: captured frontmost app = {:?}", focused);
                    *crate::commands::get_previous_app().lock().unwrap() = focused;
                    let _ = app.emit("hotkey-toggle-recording", ());
                }
            })?;

            // --- Push-to-talk shortcut: hold to record, release to stop ---
            if let Some(ptt_sc) = parse_hotkey(&initial_settings.push_to_talk_hotkey) {
                let state_ptt = shared_state.clone();
                let ptt_last_ms = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
                let ptt_locked  = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                if let Err(e) = app.global_shortcut().on_shortcut(ptt_sc, move |app, _shortcut, event| {
                    let settings = crate::settings::load_settings_sync();
                    let is_recording = state_ptt.lock().unwrap().capture.is_some();
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    match event.state {
                        ShortcutState::Pressed => {
                            if !is_recording {
                                if settings.double_press_lock {
                                    let last = ptt_last_ms.load(std::sync::atomic::Ordering::SeqCst);
                                    if now_ms.saturating_sub(last) < 500 {
                                        ptt_locked.store(true, std::sync::atomic::Ordering::SeqCst);
                                    } else {
                                        ptt_locked.store(false, std::sync::atomic::Ordering::SeqCst);
                                    }
                                }
                                ptt_last_ms.store(now_ms, std::sync::atomic::Ordering::SeqCst);
                                let focused = crate::paste::get_frontmost_app();
                                tracing::info!("ptt pressed: captured frontmost app = {:?}", focused);
                                *crate::commands::get_previous_app().lock().unwrap() = focused;
                                let _ = app.emit("hotkey-toggle-recording", ());
                            } else if settings.double_press_lock && ptt_locked.load(std::sync::atomic::Ordering::SeqCst) {
                                ptt_locked.store(false, std::sync::atomic::Ordering::SeqCst);
                                let _ = app.emit("hotkey-stop-recording", ());
                            }
                        }
                        ShortcutState::Released => {
                            if is_recording && !ptt_locked.load(std::sync::atomic::Ordering::SeqCst) {
                                let _ = app.emit("hotkey-stop-recording", ());
                            }
                        }
                    }
                }) {
                    tracing::warn!("Could not register PTT shortcut: {}", e);
                }
            }

            // --- Single-key PTT via raw CGEventTap (Fn, CapsLock, Right Option, Right Control, F13–F15) ---
            // tauri_plugin_global_shortcut handles modifier+key combos (above).
            // These bare single keys need CGEventTap for reliable press/release detection.
            #[cfg(target_os = "macos")]
            {
                const SINGLE_PTT_KEYS: &[&str] = &[
                    "Fn", "CapsLock", "Right Option", "Right Control", "F13", "F14", "F15",
                ];
                let ptt_key = initial_settings.push_to_talk_hotkey.clone();
                if initial_settings.recording_mode == "push_to_talk"
                    && SINGLE_PTT_KEYS.contains(&ptt_key.as_str())
                {
                    // Build shared on_press / on_release callbacks using a macro so each
                    // arm gets its own concrete closure types (avoids Box<dyn Fn> coercion).
                    macro_rules! ptt_callbacks {
                        () => {{
                            let app_press = app.handle().clone();
                            let app_release = app.handle().clone();
                            let state_press = shared_state.clone();
                            let state_release = shared_state.clone();
                            let ptt_last_ms = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
                            let ptt_locked  = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                            let last_clone  = ptt_last_ms.clone();
                            let locked_press  = ptt_locked.clone();
                            let locked_release = ptt_locked.clone();
                            let on_press = move || {
                                let settings = crate::settings::load_settings_sync();
                                let is_recording = state_press.lock().unwrap().capture.is_some();
                                let now_ms = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64;
                                if !is_recording {
                                    if settings.double_press_lock {
                                        let last = last_clone.load(std::sync::atomic::Ordering::SeqCst);
                                        if now_ms.saturating_sub(last) < 500 {
                                            locked_press.store(true, std::sync::atomic::Ordering::SeqCst);
                                        } else {
                                            locked_press.store(false, std::sync::atomic::Ordering::SeqCst);
                                        }
                                    }
                                    last_clone.store(now_ms, std::sync::atomic::Ordering::SeqCst);
                                    let focused = crate::paste::get_frontmost_app();
                                    *crate::commands::get_previous_app().lock().unwrap() = focused;
                                    let _ = app_press.emit("hotkey-toggle-recording", ());
                                } else if settings.double_press_lock
                                    && locked_press.load(std::sync::atomic::Ordering::SeqCst)
                                {
                                    locked_press.store(false, std::sync::atomic::Ordering::SeqCst);
                                    let _ = app_press.emit("hotkey-stop-recording", ());
                                }
                            };
                            let on_release = move || {
                                let is_recording = state_release.lock().unwrap().capture.is_some();
                                if is_recording && !locked_release.load(std::sync::atomic::Ordering::SeqCst) {
                                    let _ = app_release.emit("hotkey-stop-recording", ());
                                }
                            };
                            (on_press, on_release)
                        }};
                    }

                    match ptt_key.as_str() {
                        "Fn" => {
                            let (on_press, on_release) = ptt_callbacks!();
                            crate::fn_key::spawn_fn_key_tap(on_press, on_release);
                        }
                        "CapsLock" => {
                            let (on_press, on_release) = ptt_callbacks!();
                            crate::fn_key::spawn_capslock_tap(on_press, on_release);
                        }
                        "Right Option" => {
                            let (on_press, on_release) = ptt_callbacks!();
                            crate::fn_key::spawn_modifier_key_tap(
                                crate::fn_key::KEYCODE_RIGHT_OPTION,
                                0x00080000, // kCGEventFlagMaskAlternate
                                on_press, on_release,
                            );
                        }
                        "Right Control" => {
                            let (on_press, on_release) = ptt_callbacks!();
                            crate::fn_key::spawn_modifier_key_tap(
                                crate::fn_key::KEYCODE_RIGHT_CONTROL,
                                0x00040000, // kCGEventFlagMaskControl
                                on_press, on_release,
                            );
                        }
                        "F13" => {
                            let (on_press, on_release) = ptt_callbacks!();
                            crate::fn_key::spawn_function_key_tap(crate::fn_key::KEYCODE_F13, on_press, on_release);
                        }
                        "F14" => {
                            let (on_press, on_release) = ptt_callbacks!();
                            crate::fn_key::spawn_function_key_tap(crate::fn_key::KEYCODE_F14, on_press, on_release);
                        }
                        "F15" => {
                            let (on_press, on_release) = ptt_callbacks!();
                            crate::fn_key::spawn_function_key_tap(crate::fn_key::KEYCODE_F15, on_press, on_release);
                        }
                        _ => {}
                    }
                }
            }

            // --- Global Shortcut: Cmd+Shift+B (Smart Dictation) ---
            let shortcut_sd = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyB);
            let state_for_sd = shared_state.clone();
            app.global_shortcut().on_shortcut(shortcut_sd, move |app, _shortcut, event| {
                let settings = crate::settings::load_settings_sync();
                let is_push_to_talk = settings.recording_mode == "push_to_talk";

                match event.state {
                    ShortcutState::Pressed => {
                        let is_recording = state_for_sd.lock().unwrap().capture.is_some();
                        if is_push_to_talk {
                            if !is_recording {
                                // Capture focused app before showing window
                                let focused = crate::paste::get_frontmost_app();
                                tracing::info!("smart-dictation hotkey: captured frontmost app = {:?}", focused);
                                *crate::commands::get_previous_app().lock().unwrap() = focused;
                                state_for_sd.lock().unwrap().is_smart_dictation = true;
                                // Don't show/focus the main window — overlay handles visual feedback
                                let _ = app.emit("hotkey-smart-dictation", ());
                            }
                        } else {
                            if is_recording {
                                // Delegate stop to frontend for proper audio drain + paste
                                let _ = app.emit("hotkey-stop-recording", ());
                            } else {
                                // Capture focused app before doing anything
                                let focused = crate::paste::get_frontmost_app();
                                tracing::info!("smart-dictation hotkey: captured frontmost app = {:?}", focused);
                                *crate::commands::get_previous_app().lock().unwrap() = focused;
                                state_for_sd.lock().unwrap().is_smart_dictation = true;
                                // Don't show/focus the main window — overlay handles visual feedback
                                let _ = app.emit("hotkey-smart-dictation", ());
                            }
                        }
                    }
                    ShortcutState::Released => {
                        if is_push_to_talk {
                            // Push-to-talk: delegate to frontend so isPendingPaste is set
                            let is_recording = state_for_sd.lock().unwrap().capture.is_some();
                            if is_recording {
                                let _ = app.emit("hotkey-stop-recording", ());
                            }
                        }
                    }
                }
            })?;

            // Show window for first-time users (onboarding)
            let is_first = {
                let path = crate::settings::settings_path();
                !path.exists()
            };
            if is_first {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
            }

            // Background license validation on launch (non-blocking)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let status = crate::license::validate().await;
                let status_str = match status {
                    crate::license::LicenseStatus::Licensed => "Licensed",
                    crate::license::LicenseStatus::GracePeriod => "GracePeriod",
                    crate::license::LicenseStatus::Expired => "Expired",
                    crate::license::LicenseStatus::Free => "Free",
                };
                let _ = app_handle.emit("license-status", status_str);
            });

            // Background update check (non-blocking, fails silently if offline)
            let app_handle_upd = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(info) = crate::updater::check_for_update().await {
                    let _ = app_handle_upd.emit("update-available", info);
                }
            });


            // Auto-delete old history on launch if configured
            tauri::async_runtime::spawn(async move {
                let settings = crate::settings::load_settings().await;
                if let Some(days) = settings.auto_delete_after_days {
                    if days > 0 {
                        let _ = tokio::task::spawn_blocking(move || {
                            crate::history::cleanup_old_transcriptions(days)
                        })
                        .await;
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            transcribe_file,
            start_transcription,
            stop_transcription,
            get_available_models,
            get_models,
            download_model,
            delete_model,
            get_models_disk_usage,
            get_settings,
            update_settings,
            get_audio_devices,
            is_first_launch,
            complete_onboarding,
            request_microphone_permission,
            show_overlay,
            hide_overlay,
            capture_focused_app,
            paste_transcription,
            check_accessibility_permission,
            open_accessibility_settings,
            save_transcription,
            get_history,
            search_history,
            cmd_delete_transcription,
            cmd_export_history,
            cmd_clear_history,
            get_usage_today,
            get_license_status,
            get_license_info,
            activate_license,
            deactivate_license,
            validate_license_bg,
            get_app_version,
            get_debug_info,
            is_running_from_dmg,
            get_vocabulary,
            add_vocabulary_word,
            remove_vocabulary_word,
            add_word_replacement,
            remove_word_replacement,
            get_usage_stats,
            get_storage_info,
            check_ollama_status,
            get_ollama_models,
            polish_text_cmd,
            test_ai_connection,
            save_cloud_api_key,
            get_cloud_api_key_status,
            delete_cloud_api_key_cmd,
            get_model_recommendation,
            styles::get_polish_styles,
            styles::add_custom_style,
            styles::remove_custom_style,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
