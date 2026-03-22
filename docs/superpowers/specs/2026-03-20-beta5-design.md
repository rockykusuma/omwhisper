# OmWhisper v0.1.0-beta.5 — Design Spec

Date: 2026-03-20

## Overview

Four targeted fixes and improvements for the beta.5 release:

1. Update banner Download button does not open the browser
2. Start and stop chime sounds are indistinguishable
3. Overlay window drops behind other apps when they take focus
4. No way to switch AI polish style without opening the app

---

## Item 1: Fix Update Banner Download Button

### Problem
The update banner in `src/App.tsx` (line 319) uses an `<a href target="_blank">` anchor. Tauri v2 blocks this navigation for security — the link does nothing when clicked.

### Fix
Replace the `<a>` tag with a `<button>` that calls `invoke("plugin:opener|open_url", { url: updateInfo.download_url })`. This is the same pattern already used in `src/components/AiModelsView.tsx:603`. The `opener:allow-open-url` capability is already enabled in `src-tauri/capabilities/default.json`.

### Files changed
- `src/App.tsx` — replace anchor with opener invoke

---

## Item 2: Distinct Start/Stop Chime Sounds

### Problem
`start.wav` and `stop.wav` in `src-tauri/resources/sounds/` are perceptually similar, making it hard to tell recording state from audio alone.

### Fix
Generate two clearly distinct tones using a Python script (`scripts/generate_sounds.py`):

- **start.wav** — rising chirp: 880 Hz → 1760 Hz over 180 ms, sine wave with soft fade-in/fade-out envelope, 44100 Hz mono 16-bit PCM
- **stop.wav** — falling chirp: 1760 Hz → 880 Hz over 180 ms, same envelope, same format

The script uses only Python stdlib (`wave`, `struct`, `math`) — no external dependencies. It overwrites the existing files in-place. The existing Rust `sounds.rs` is unchanged since it already loads `start.wav` / `stop.wav` by name.

### Files changed
- `scripts/generate_sounds.py` — new script
- `src-tauri/resources/sounds/start.wav` — replaced with rising chirp
- `src-tauri/resources/sounds/stop.wav` — replaced with falling chirp

---

## Item 3: Overlay Stays on Top of All Apps

### Problem
`alwaysOnTop: true` in `tauri.conf.json` sets `NSWindowLevel.floating` (~3) on macOS. This is above normal app windows but can be obscured by other floating windows, status bars, or any app that temporarily raises its own window level when active.

### Fix
Tauri's `set_always_on_top(true)` on macOS delegates to winit/tao which only sets `NSFloatingWindowLevel` (3) — the same level as the static `alwaysOnTop: true` in `tauri.conf.json`. This is insufficient.

The correct fix is a raw Objective-C call to set the NSWindow level to `NSStatusWindowLevel` (25), using the same pattern already established in `lib.rs` for `activate_app_macos()`:

```rust
#[cfg(target_os = "macos")]
fn set_overlay_window_level(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;
    unsafe {
        // NSStatusWindowLevel = 25
        // objc_msgSend(nsWindow, setLevel:, 25)
        let ns_window = window.ns_window().unwrap() as *mut c_void;
        // ... raw objc send
    }
}
```

This is called immediately after `overlay_window.show()` in `show_overlay`. The static `"alwaysOnTop": true` in `tauri.conf.json` is kept as a belt-and-suspenders fallback.

`NSStatusWindowLevel` (25) sits above all normal application windows and menu bars but below screen savers — the correct level for a floating recording indicator.

**Important:** `setLevel:` takes `NSInteger` = `isize` (8 bytes on 64-bit), not `i32`. A separate extern declaration is required — do NOT reuse any `i32`-parameter variant from `activate_app_macos`:
```rust
fn msg_send_level(receiver: *mut c_void, sel: *const c_void, val: isize);
```

### Files changed
- `src-tauri/src/commands.rs` — add `#[cfg(target_os = "macos")]` `set_overlay_window_level()` call in `show_overlay`
- `src-tauri/tauri.conf.json` — no change (keep `alwaysOnTop: true`)

---

## Item 4: Switch Polish Style from Tray Menu

### Problem
Changing the active AI polish style requires opening the app, navigating to Settings → AI, and selecting a style. There is no quick way to do this from the menu bar.

### Design
Add a **"Polish Style"** submenu to the system tray menu in `src-tauri/src/lib.rs`, positioned between the Microphone submenu and the separator before Quit.

**Menu structure:**
```
Show Window
Settings…
─────────────
Microphone ▶  (existing)
Polish Style ▶
  ✓ professional  → "Professional"
    casual        → "Casual"
    concise       → "Concise"
    translate     → "Translate"
    email         → "Email Format"
    meeting_notes → "Meeting Notes"
    cleanup       → "Cleanup"
    [custom styles by name...]
─────────────
Quit OmWhisper
```

There are **7 built-in styles** (not 6): Professional, Casual, Concise, Translate, Email Format, Meeting Notes, and **Cleanup**. IDs are all lowercase as defined in `styles.rs`.

**Behavior:**
- At app startup (during tray menu build), load current settings to determine `active_polish_style`, then render style items with a checkmark on the matching `id`.
- Selecting a style: write the new `active_polish_style` to settings file and rebuild the tray menu to update the checkmark. The settings write must be done via `tauri::async_runtime::spawn(async move { ... })` since the `on_menu_event` closure is synchronous — call the same `save_settings()`/`load_settings()` in-process functions directly, not via the IPC `update_settings` command.
- After saving, call a new `rebuild_tray_menu(app_handle)` helper to reconstruct and re-attach the menu via `app_handle.tray_by_id("main-tray").set_menu(...)`. This helper does not yet exist and must be created — the current tray menu is only built once at startup and there is no existing rebuild mechanism. The same helper should also be wired up for mic device selection (currently the mic checkmark does not update after selection either).
- **Required prerequisite:** The existing `TrayIconBuilder::new()` call in `lib.rs` must be updated to `.id("main-tray")` (or any stable string) so that `app_handle.tray_by_id("main-tray")` can retrieve the instance at rebuild time. Without this, the lookup returns `None` at runtime.
- Menu item IDs use the prefix `style:` (e.g. `style:professional`, `style:cleanup`, `style:my_custom`).
- If AI backend is `"disabled"`, the submenu is still shown — style selection is saved for when AI is re-enabled.

### Files changed
- `src-tauri/src/lib.rs` — add Polish Style submenu + handler in `on_menu_event`

---

## Item 5: Polish Selected Text Shortcut

### Problem
There is no way to AI-polish text that has already been typed. The current AI Polish flow only works on freshly dictated audio.

### Flow
1. User selects text in any app
2. Presses the configurable global hotkey (default `CmdOrCtrl+Shift+P`)
3. OmWhisper simulates `Cmd+C` via `CGEventPost` to copy the selection to clipboard
4. Waits ~80ms for the clipboard to settle, then reads the clipboard content
5. If clipboard is empty or unchanged → emit a toast event `"polish-error"` with message "No text selected", abort
6. Sends text to the existing AI polish pipeline using the current `active_polish_style`
7. Writes polished result to clipboard + simulates `Cmd+V` to paste into the focused app
8. If `restore_clipboard` setting is enabled, restores the original clipboard after `clipboard_restore_delay_ms`

While AI is processing, emit `"polish-state": { status: "processing" }` so the UI can show a brief indicator. On completion emit `"polish-state": { status: "done" }`.

### Settings
Add `polish_text_hotkey: String` to `Settings` struct in `settings.rs`, defaulting to `"CmdOrCtrl+Shift+P"`. The field is registered, saved, and loaded like the existing `hotkey` and `smart_dictation_hotkey` fields.

### Backend (`lib.rs`)
Register the shortcut at startup using the existing `parse_hotkey` pattern, immediately after the smart dictation shortcut registration. The handler emits `"hotkey-polish-selected"` to the frontend — it does not call the command directly (same pattern as `hotkey-toggle-recording` and `hotkey-smart-dictation`).

If the setting value is empty string, skip registration (user has cleared the shortcut).

### Backend (`commands.rs`)
New Tauri command `polish_selected_text`:
1. Call `paste::simulate_copy()` — a new helper that posts `CGEventPost(Cmd+C)` (macOS only, `#[cfg(target_os = "macos")]`). On non-macOS, return an error string.
2. Sleep 80ms (`tokio::time::sleep`) for the clipboard to update
3. Read clipboard via `arboard::Clipboard`
4. If empty → return `Err("No text selected")`
5. Call the existing `polish_text` logic with the active style from settings
6. Write polished text to clipboard
7. Simulate paste (`paste::paste_to_app`) on the previously captured frontmost app
8. Optionally schedule clipboard restore (same pattern as `paste_transcription`)

`simulate_copy` in `paste.rs` is the same as the existing `paste_to_app` Cmd+V logic but sends key code `8` (the `c` key) instead of `9` (the `v` key).

### Frontend (`App.tsx`)
Listen for `"hotkey-polish-selected"` event → call `invoke("polish_selected_text")`. On error, show a toast with the error message. On `"polish-state": processing`, show a brief overlay or status indicator (can reuse the existing toast system — a simple "Polishing…" toast is sufficient).

### Frontend (`Settings.tsx` — Shortcuts tab)
Add a third `ShortcutRecorder` row labelled **"Polish Selected Text"** below the existing "AI Polish" row, bound to `settings.polish_text_hotkey` with default `"CmdOrCtrl+Shift+P"`.

### Files changed
- `src-tauri/src/settings.rs` — add `polish_text_hotkey` field
- `src-tauri/src/lib.rs` — register `polish_text_hotkey` shortcut, emit `"hotkey-polish-selected"`
- `src-tauri/src/commands.rs` — add `polish_selected_text` command
- `src-tauri/src/paste.rs` — add `simulate_copy()` (macOS only)
- `src/App.tsx` — listen for `"hotkey-polish-selected"`, invoke command, handle errors
- `src/components/Settings.tsx` — add ShortcutRecorder row for Polish Selected Text

---

## Out of Scope for beta.5

- Windows-specific changes
- Silero VAD upgrade
- WhisperEngine model caching
- Any new transcription features

---

## Release Checklist

- [ ] All five items implemented and tested
- [ ] Run `scripts/generate_sounds.py` to generate new WAV files, then `touch src-tauri/src/sounds.rs && cargo build` to force re-embedding of `include_bytes!`
- [ ] New sounds play correctly in-app (rising on start, falling on stop)
- [ ] Download button opens browser on click
- [ ] Overlay stays visible above focused app windows
- [ ] Polish Style submenu shows correct checkmark and updates settings on selection
- [ ] Polish Selected Text shortcut works: select text → Cmd+Shift+P → polished text pasted back
- [ ] Shortcut is configurable in Settings → Shortcuts tab
- [ ] Empty selection shows toast error rather than crashing
- [ ] Bump version to `0.1.0-beta.5` in `Cargo.toml` and `tauri.conf.json`
- [ ] Merge feature branch to main, tag, build DMG, publish release
