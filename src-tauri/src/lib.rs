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
mod analytics;
mod engine;
#[cfg(target_os = "macos")]
mod fn_key;
#[cfg(target_os = "macos")]
mod macos;

const SENTRY_DSN: &str = match option_env!("SENTRY_DSN") {
    Some(s) => s,
    None => "",
};

use commands::{
    activate_license, capture_focused_app, check_accessibility_permission, cmd_clear_history,
    cmd_delete_transcription, cmd_export_history, complete_onboarding, deactivate_license,
    delete_model, download_model, get_app_version, get_audio_devices, get_available_models,
    get_debug_info, get_history, get_license_info, get_license_status, get_models,
    get_models_disk_usage, get_settings, get_usage_today, hide_overlay, is_first_launch,
    is_running_from_dmg, open_accessibility_settings, paste_transcription, check_microphone_permission, request_microphone_permission, get_microphone_auth_status, open_microphone_settings,
    save_transcription, search_history, show_main_window, show_overlay, start_transcription, stop_transcription,
    transcribe_file, update_settings, validate_license_bg,
    get_vocabulary, add_vocabulary_word, remove_vocabulary_word, add_word_replacement, remove_word_replacement,
    get_usage_stats, get_storage_info,
    check_ollama_status, get_ollama_models, polish_text_cmd, test_ai_connection,
    save_cloud_api_key, get_cloud_api_key_status, delete_cloud_api_key_cmd,
    get_model_recommendation,
    get_llm_models, get_llm_models_disk_usage, download_llm_model, delete_llm_model, import_llm_model,
    get_platform,
    get_transcription_engine,
    SharedState, TranscriptionState,
};
#[cfg(target_os = "macos")]
use commands::{load_llm_engine, unload_llm_engine};
use std::sync::{Arc, Mutex};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Build the tray menu reflecting current settings (mic checkmark + style checkmark).
fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let current_settings = crate::settings::load_settings_sync();
    let selected_device = current_settings.audio_input_device.clone().unwrap_or_default();
    let device_names = crate::settings::list_audio_devices();

    let show_item     = MenuItem::with_id(app, "show",     "Show Window",     true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…",       true, None::<&str>)?;
    let sep2          = PredefinedMenuItem::separator(app)?;

    // Microphone submenu
    let using_default = current_settings.audio_input_device.is_none();
    let default_label = if using_default { "✓  Default Microphone".to_string() } else { "Default Microphone".to_string() };
    let default_item = MenuItem::with_id(app, "mic:default", default_label, true, None::<&str>)?;
    let mic_items: Vec<MenuItem<_>> = if device_names.is_empty() {
        vec![]
    } else {
        device_names.iter().map(|d| {
            let label = if !using_default && *d == selected_device { format!("✓  {}", d) } else { d.clone() };
            MenuItem::with_id(app, format!("mic:{}", d), label, true, None::<&str>)
        }).collect::<std::result::Result<Vec<_>, _>>()?
    };

    let sep_mic = PredefinedMenuItem::separator(app)?;
    let mut mic_refs: Vec<&dyn tauri::menu::IsMenuItem<_>> = vec![&default_item];
    if !mic_items.is_empty() {
        mic_refs.push(&sep_mic);
        for item in &mic_items {
            mic_refs.push(item as &dyn tauri::menu::IsMenuItem<_>);
        }
    }
    let mic_submenu = Submenu::with_items(app, "Microphone", true, &mic_refs)?;

    // Polish Style submenu — built-ins + custom styles, checkmark on active
    let active_style = &current_settings.active_polish_style;
    let built_in_styles = crate::styles::built_in_styles();
    let mut style_items: Vec<MenuItem<_>> = Vec::new();
    for style in &built_in_styles {
        let label = if style.id == *active_style { format!("✓  {}", style.name) } else { style.name.clone() };
        style_items.push(MenuItem::with_id(app, format!("style:{}", style.id), label, true, None::<&str>)?);
    }
    for custom in &current_settings.custom_polish_styles {
        let label = if custom.name == *active_style { format!("✓  {}", custom.name) } else { custom.name.clone() };
        style_items.push(MenuItem::with_id(app, format!("style:{}", custom.name), label, true, None::<&str>)?);
    }
    let style_refs: Vec<&dyn tauri::menu::IsMenuItem<_>> = style_items.iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<_>)
        .collect();
    let style_submenu = Submenu::with_items(app, "Polish Style", true, &style_refs)?;

    let sep3      = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit OmWhisper", true, None::<&str>)?;

    Menu::with_items(app, &[
        &show_item,
        &settings_item,
        &sep2,
        &mic_submenu,
        &style_submenu,
        &sep3,
        &quit_item,
    ])
}

/// Rebuild and re-attach the tray menu (called after mic or style selection changes).
fn rebuild_tray_menu(app: &tauri::AppHandle) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(menu) = build_tray_menu(app) {
            if let Err(e) = tray.set_menu(Some(menu)) {
                tracing::warn!("Failed to rebuild tray menu: {}", e);
            }
        }
    }
}

/// Bring the app to the foreground on macOS.
///
/// `app.show()` only calls `[NSApp unhide:nil]` which is for un-hiding a deliberately
/// hidden app. To actually raise the app above other applications we need
/// `[NSApp activateIgnoringOtherApps:YES]`.
#[cfg(target_os = "macos")]
fn activate_app_macos() {
    use std::os::raw::{c_char, c_void};
    #[allow(clashing_extern_declarations)]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> *const c_void;
        fn sel_registerName(str: *const c_char) -> *const c_void;
        #[link_name = "objc_msgSend"]
        fn msg_send_no_args(receiver: *const c_void, sel: *const c_void) -> *mut c_void;
        #[link_name = "objc_msgSend"]
        fn msg_send_bool(receiver: *mut c_void, sel: *const c_void, val: i32);
    }
    unsafe {
        let cls = objc_getClass(b"NSApplication\0".as_ptr() as *const c_char);
        if cls.is_null() { return; }
        let sel_shared = sel_registerName(b"sharedApplication\0".as_ptr() as *const c_char);
        let app = msg_send_no_args(cls, sel_shared);
        if app.is_null() { return; }
        let sel_activate = sel_registerName(b"activateIgnoringOtherApps:\0".as_ptr() as *const c_char);
        msg_send_bool(app, sel_activate, 1);
    }
}

/// Center the main window on the primary monitor.
/// Must be called after the window is visible so outer_size() returns real dimensions.
fn center_on_primary_monitor(win: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let screen = monitor.size();
        let origin = monitor.position();
        if let Ok(win_size) = win.outer_size() {
            let x = origin.x + ((screen.width  as i32 - win_size.width  as i32) / 2);
            let y = origin.y + ((screen.height as i32 - win_size.height as i32) / 2);
            let _ = win.set_position(tauri::PhysicalPosition { x, y });
        }
    }
}

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
    let _crash_settings = crate::settings::load_settings_sync();
    let _sentry_dsn = if _crash_settings.crash_reporting_enabled { SENTRY_DSN } else { "" };
    let _sentry_guard = sentry::init((_sentry_dsn, sentry::ClientOptions {
        release: sentry::release_name!(),
        ..Default::default()
    }));

    // Single instance guard
    if !ensure_single_instance() {
        eprintln!("OmWhisper is already running.");
        std::process::exit(0);
    }

    // Set up file logging (guard must live for the duration of the app)
    let _log_guard = setup_logging();
    tracing::info!("OmWhisper v{} starting", env!("CARGO_PKG_VERSION"));
    crate::analytics::init();

    let shared_state: SharedState = Arc::new(Mutex::new(TranscriptionState::new()));

    // Separate managed state for LlmEngine — must NOT be inside SharedState
    // because inference blocks the calling thread for several seconds — holding the shared mutex during inference would deadlock the shortcut handlers.
    #[cfg(target_os = "macos")]
    let builder = {
        let b = tauri::Builder::default()
            .manage(shared_state.clone())
            .manage(std::sync::Arc::new(std::sync::Mutex::new(
                Option::<crate::ai::llm::LlmEngine>::None,
            )));
        b
    };

    #[cfg(not(target_os = "macos"))]
    let builder = {
        let b = tauri::Builder::default()
            .manage(shared_state.clone());
        b
    };

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            // Analytics: fire app_launched (tokio runtime is live inside setup)
            {
                let s = crate::settings::load_settings_sync();
                crate::analytics::track(s.analytics_enabled, "app_launched", serde_json::json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "platform": if cfg!(target_os = "macos") { "macos" } else { "windows" }
                }));
            }

            // Seed the bundled tiny.en model to app data on first run so the
            // user can dictate immediately without downloading anything.
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use tauri::Manager;
                    let dest = crate::whisper::models::model_path("tiny.en");
                    if dest.exists() { return; }
                    let resource_dir = match app_handle.path().resource_dir() {
                        Ok(d) => d,
                        Err(e) => { tracing::warn!("resource_dir error: {}", e); return; }
                    };
                    let src = resource_dir.join("models").join("ggml-tiny.en.bin");
                    if !src.exists() {
                        tracing::warn!("Bundled tiny.en not found at {:?}", src);
                        return;
                    }
                    if let Some(parent) = dest.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    match tokio::fs::copy(&src, &dest).await {
                        Ok(_) => tracing::info!("Seeded bundled tiny.en to {:?}", dest),
                        Err(e) => tracing::warn!("Failed to seed tiny.en: {}", e),
                    }
                });
            }

            // --- System Tray ---
            let menu = build_tray_menu(&app.handle().clone())?;

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

            let _tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("OmWhisper — Click to toggle recording")
                .icon(tray_icon)
                .icon_as_template(true)
                .on_menu_event({
                    move |app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                #[cfg(target_os = "macos")]
                                activate_app_macos();
                                center_on_primary_monitor(&win);
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "settings" => {
                            if let Some(win) = app.get_webview_window("main") {
                                #[cfg(target_os = "macos")]
                                activate_app_macos();
                                center_on_primary_monitor(&win);
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                            let _ = app.emit("tray-navigate", "settings");
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        id if id.starts_with("mic:") => {
                            let device_name = id.trim_start_matches("mic:").to_string();
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let mut s = crate::settings::load_settings().await;
                                // "default" means use system default — store None
                                s.audio_input_device = if device_name == "default" { None } else { Some(device_name) };
                                if let Err(e) = crate::settings::save_settings(&s).await {
                                    tracing::error!("Failed to save mic selection: {}", e);
                                }
                                let _ = app_handle.emit("settings-changed", ());
                                rebuild_tray_menu(&app_handle);
                            });
                        }
                        id if id.starts_with("style:") => {
                            let style_id = id.trim_start_matches("style:").to_string();
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let mut s = crate::settings::load_settings().await;
                                s.active_polish_style = style_id;
                                if let Err(e) = crate::settings::save_settings(&s).await {
                                    tracing::error!("Failed to save style selection: {}", e);
                                }
                                let _ = app_handle.emit("settings-changed", ());
                                rebuild_tray_menu(&app_handle);
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
                                activate_app_macos();
                                center_on_primary_monitor(&win);
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
                let is_recording = state_toggle.lock().unwrap_or_else(|e| e.into_inner()).capture.is_some();
                if is_recording {
                    let _ = app.emit("hotkey-stop-recording", ());
                } else {
                    let focused = crate::paste::get_frontmost_app();
                    tracing::info!("toggle hotkey: captured frontmost app = {:?}", focused);
                    *crate::commands::get_previous_app().lock().unwrap_or_else(|e| e.into_inner()) = focused;
                    let _ = app.emit("hotkey-toggle-recording", ());
                }
            })?;

            // --- Push-to-talk shortcut: hold to record, release to stop ---
            // Not(windows): PTT is toggle-only on Windows; plugin shortcut not registered there.
            // Uses not(target_os = "windows") rather than macos so Linux can use PTT if added in future.
            #[cfg(not(target_os = "windows"))]
            {
                if let Some(ptt_sc) = parse_hotkey(&initial_settings.push_to_talk_hotkey) {
                    let state_ptt = shared_state.clone();
                    if let Err(e) = app.global_shortcut().on_shortcut(ptt_sc, move |app, _shortcut, event| {
                        let is_recording = state_ptt.lock().unwrap_or_else(|e| e.into_inner()).capture.is_some();
                        match event.state {
                            ShortcutState::Pressed => {
                                if !is_recording {
                                    let focused = crate::paste::get_frontmost_app();
                                    tracing::info!("ptt pressed: captured frontmost app = {:?}", focused);
                                    *crate::commands::get_previous_app().lock().unwrap_or_else(|e| e.into_inner()) = focused;
                                    let _ = app.emit("hotkey-toggle-recording", ());
                                }
                            }
                            // Always emit stop on release — avoids the race where the key is
                            // released before the 500 ms sound delay finishes setting `capture`.
                            ShortcutState::Released => {
                                let _ = app.emit("hotkey-stop-recording", ());
                            }
                        }
                    }) {
                        tracing::warn!("Could not register PTT shortcut: {}", e);
                    }
                }
            }

            // --- Single-key PTT via raw CGEventTap (Fn, CapsLock, Right Option, Right Control, F13–F15) ---
            // tauri_plugin_global_shortcut handles modifier+key combos (above).
            // These bare single keys need CGEventTap for reliable press/release detection.
            #[cfg(target_os = "macos")]
            {
                const SINGLE_PTT_KEYS: &[&str] = &[
                    "Fn", "CapsLock", "Right Option", "Right Control",
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
                            let on_press = move || {
                                let is_recording = state_press.lock().unwrap_or_else(|e| e.into_inner()).capture.is_some();
                                if !is_recording {
                                    let focused = crate::paste::get_frontmost_app();
                                    *crate::commands::get_previous_app().lock().unwrap_or_else(|e| e.into_inner()) = focused;
                                    let _ = app_press.emit("hotkey-toggle-recording", ());
                                }
                            };
                            // Always emit stop on release — avoids the race where the key is
                            // released before the 500 ms sound delay finishes setting `capture`.
                            let on_release = move || {
                                let _ = app_release.emit("hotkey-stop-recording", ());
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
                                crate::fn_key::kCGEventFlagMaskAlternate,
                                on_press, on_release,
                            );
                        }
                        "Right Control" => {
                            let (on_press, on_release) = ptt_callbacks!();
                            crate::fn_key::spawn_modifier_key_tap(
                                crate::fn_key::KEYCODE_RIGHT_CONTROL,
                                crate::fn_key::kCGEventFlagMaskControl,
                                on_press, on_release,
                            );
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
                        let is_recording = state_for_sd.lock().unwrap_or_else(|e| e.into_inner()).capture.is_some();
                        if is_push_to_talk {
                            if !is_recording {
                                // Capture focused app before showing window
                                let focused = crate::paste::get_frontmost_app();
                                tracing::info!("smart-dictation hotkey: captured frontmost app = {:?}", focused);
                                *crate::commands::get_previous_app().lock().unwrap_or_else(|e| e.into_inner()) = focused;
                                state_for_sd.lock().unwrap_or_else(|e| e.into_inner()).is_smart_dictation = true;
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
                                *crate::commands::get_previous_app().lock().unwrap_or_else(|e| e.into_inner()) = focused;
                                state_for_sd.lock().unwrap_or_else(|e| e.into_inner()).is_smart_dictation = true;
                                // Don't show/focus the main window — overlay handles visual feedback
                                let _ = app.emit("hotkey-smart-dictation", ());
                            }
                        }
                    }
                    ShortcutState::Released => {
                        if is_push_to_talk {
                            // Push-to-talk: delegate to frontend so isPendingPaste is set
                            let is_recording = state_for_sd.lock().unwrap_or_else(|e| e.into_inner()).capture.is_some();
                            if is_recording {
                                let _ = app.emit("hotkey-stop-recording", ());
                            }
                        }
                    }
                }
            })?;

            // --- Global Shortcut: Cmd+Shift+O (Show Window) ---
            let show_window_sc = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyO);
            app.global_shortcut().on_shortcut(show_window_sc, move |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed { return; }
                if let Some(win) = app.get_webview_window("main") {
                    let visible = win.is_visible().unwrap_or(false);
                    let focused = win.is_focused().unwrap_or(false);
                    if visible && focused {
                        let _ = win.hide();
                    } else {
                        #[cfg(target_os = "macos")]
                        activate_app_macos();
                        center_on_primary_monitor(&win);
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            })?;

            // Intercept the close button — hide instead of destroying the window
            // so "Show Window" from the tray always works.
            if let Some(win) = app.get_webview_window("main") {
                let win_for_close = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_for_close.hide();
                    }
                });
            }

            // Show window for first-time users (onboarding)
            let is_first = {
                let path = crate::settings::settings_path();
                !path.exists()
            };
            if is_first {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    // Re-center after show — macOS repositions new windows when they become
                    // visible, overriding any set_position called before show(). A brief delay
                    // lets the window server commit the frame so centering sticks.
                    let win_clone = win.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
                        center_on_primary_monitor(&win_clone);
                    });
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

            // Notify frontend if settings.json was corrupted on the previous load
            {
                let corrupted_path = crate::settings::settings_path().with_extension("json.corrupted");
                if corrupted_path.exists() {
                    let _ = std::fs::remove_file(&corrupted_path);
                    let app_handle_corrupted = app.handle().clone();
                    // Small delay so the frontend event listeners are registered before we emit
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                        let _ = app_handle_corrupted.emit("settings-corrupted", ());
                    });
                }
            }


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

            // Eagerly load LlmEngine on launch if built_in backend is configured
            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let settings = crate::settings::load_settings().await;
                    if settings.ai_backend == "built_in" {
                        let model_path = crate::ai::llm::llm_model_path(&settings.llm_model_name);
                        if model_path.exists() {
                            let engine_state = app_handle.state::<std::sync::Arc<std::sync::Mutex<Option<crate::ai::llm::LlmEngine>>>>();
                            match tokio::task::spawn_blocking(move || {
                                crate::ai::llm::LlmEngine::new(&model_path)
                            })
                            .await
                            {
                                Ok(Ok(engine)) => {
                                    let mut guard = engine_state.lock().unwrap_or_else(|e| e.into_inner());
                                    *guard = Some(engine);
                                    tracing::info!("LlmEngine loaded at launch");
                                }
                                Ok(Err(e)) => tracing::warn!("LlmEngine load failed: {}", e),
                                Err(e) => tracing::warn!("LlmEngine spawn_blocking failed: {}", e),
                            }
                        }
                    }
                });
            }

            // One-time nudge: if user has never configured AI and Ollama isn't running,
            // prompt them to enable the built-in LLM backend.
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let settings = crate::settings::load_settings().await;
                    if settings.llm_nudge_shown || settings.ai_backend != "disabled" {
                        return; // already shown or already configured
                    }

                    // Check Ollama with a 3-second hard timeout
                    let ollama_url = settings.ai_ollama_url.clone();
                    let ollama_running = tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        crate::ai::ollama::check_status(&ollama_url),
                    )
                    .await
                    .unwrap_or(false); // timeout → treat as not running

                    if !ollama_running {
                        // Mark shown immediately to prevent re-trigger if app relaunches
                        let mut updated = settings;
                        updated.llm_nudge_shown = true;
                        let _ = crate::settings::save_settings(&updated).await;

                        use tauri::Emitter;
                        let _ = app_handle.emit("show-llm-nudge", ());
                    }
                });
            }

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
            check_microphone_permission,
            request_microphone_permission,
            get_microphone_auth_status,
            open_microphone_settings,
            show_overlay,
            hide_overlay,
            show_main_window,
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
            get_llm_models,
            get_llm_models_disk_usage,
            download_llm_model,
            delete_llm_model,
            import_llm_model,
            #[cfg(target_os = "macos")]
            load_llm_engine,
            #[cfg(target_os = "macos")]
            unload_llm_engine,
            styles::get_polish_styles,
            styles::add_custom_style,
            styles::remove_custom_style,
            get_platform,
            get_transcription_engine,
            commands::is_apple_speech_available,
            commands::get_apple_speech_auth_status,
            commands::request_speech_recognition_permission,
            commands::open_feedback_url,
            commands::send_feedback,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // On macOS, clicking the Dock icon when no windows are visible should show the main window.
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(win) = app.get_webview_window("main") {
                        #[cfg(target_os = "macos")]
                        activate_app_macos();
                        center_on_primary_monitor(&win);
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        });
}
