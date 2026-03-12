mod audio;
mod whisper;
mod commands;
mod settings;
mod paste;
mod history;
mod license;
mod updater;

use commands::{
    activate_license, capture_focused_app, check_accessibility_permission, cmd_clear_history,
    cmd_delete_transcription, cmd_export_history, complete_onboarding, deactivate_license,
    delete_model, download_model, get_app_version, get_audio_devices, get_available_models,
    get_debug_info, get_history, get_license_info, get_license_status, get_models,
    get_models_disk_usage, get_settings, get_usage_today, hide_overlay, is_first_launch,
    is_running_from_dmg, open_accessibility_settings, paste_transcription, request_microphone_permission,
    save_transcription, search_history, show_overlay, start_transcription, stop_transcription,
    transcribe_file, update_settings, validate_license_bg, SharedState, TranscriptionState,
};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            // --- System Tray ---
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let toggle_item = MenuItem::with_id(app, "toggle", "Start Recording", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit OmWhisper", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &toggle_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("OmWhisper — Click to toggle recording")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .on_menu_event({
                    let state = shared_state.clone();
                    move |app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
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
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // --- Global Shortcut: Cmd+Shift+V ---
            let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyV);
            let state_for_shortcut = shared_state.clone();
            app.global_shortcut().on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let is_recording = state_for_shortcut.lock().unwrap().capture.is_some();
                    if is_recording {
                        let mut s = state_for_shortcut.lock().unwrap();
                        s.usage_running.store(false, std::sync::atomic::Ordering::SeqCst);
                        if let Some(capture) = s.capture.take() {
                            capture.stop();
                        }
                        let _ = app.emit("recording-state", false);
                    } else {
                        let _ = app.emit("hotkey-toggle-recording", ());
                    }
                    // Show window when hotkey is pressed
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
