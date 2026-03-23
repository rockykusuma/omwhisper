# Feature: Live Dictation Into Focused App

> **STATUS: DEFERRED — Pro Version Future Feature**
>
> This feature types transcription directly into the focused app (Notes, Slack, VS Code, etc.)
> using `CGEventKeyboardSetUnicodeString` (macOS) / `SendInput KEYEVENTF_UNICODE` (Windows)
> without touching the clipboard.
>
> **Deferred because:** Implementing overlay-only live text first (see `PROMPT_LIVE_TEXT_STREAMING.md`).
> This focused-app dictation will be a Pro-tier feature in a future release.
>
> **Prerequisite:** `PROMPT_LIVE_TEXT_STREAMING.md` must be implemented first (overlay live text).

---
layout: default

## Overview

Changes **regular recording** (⌘⇧V) so that transcribed text is typed directly into the focused
app in real-time as each VAD chunk is processed (~2-3 second bursts).

Smart Dictation (⌘⇧B) remains unchanged — accumulate silently → polish → paste.

## Approach

- New `type_text_direct()` function in `paste.rs` using `CGEventKeyboardSetUnicodeString` (macOS)
  and `SendInput` with `KEYEVENTF_UNICODE` (Windows) — types text via keyboard events, no clipboard
- New `type_text_live` Tauri command in `commands.rs`
- Frontend delta computation in `App.tsx` — on each `transcription-update`, compute new text since
  last type and invoke `type_text_live` with only the delta
- Skip final `paste_transcription` when live typing was active (text is already in the app)

## Files to modify

- `src-tauri/src/paste.rs` — add `type_text_direct()` (macOS + Windows + fallback)
- `src-tauri/src/commands.rs` — add `type_text_live` command
- `src-tauri/src/lib.rs` — register command in imports + invoke_handler
- `src/App.tsx` — add `typedTextLengthRef` + `liveTypingActiveRef`, modify `transcription-update`
  listener for delta typing, modify `transcription-complete` handler to skip paste when live typed

## Known design decisions (for when we implement)

- Live typing only for regular recording, not smart dictation
- Delta-based: track `typedTextLengthRef` to only type new text each chunk
- CGEvent chunks text into 20-char batches (API limit)
- If `apply_polish_to_regular` is on, polished text pastes at the end (may cause double text — acceptable for v1)
- App focus follows naturally — text goes to whichever app is focused at the moment

## Full implementation details

The complete task-by-task implementation spec was prepared and is preserved below for when
this feature is picked up. See the Tasks section for exact code.

---
layout: default

## Task 1: Add `type_text_direct` function to `paste.rs`

**File:** `src-tauri/src/paste.rs`

### macOS implementation

```rust
/// Type text directly into the focused app via keyboard events.
/// Uses CGEventKeyboardSetUnicodeString — does NOT touch the clipboard.
#[cfg(target_os = "macos")]
pub fn type_text_direct(text: &str) -> Result<()> {
    use std::os::raw::{c_int, c_uint, c_void};

    type CGEventRef = *mut c_void;
    type CGEventSourceRef = *mut c_void;
    type CGKeyCode = u16;
    type CGEventTapLocation = c_uint;

    const K_CG_HID_EVENT_TAP: CGEventTapLocation = 0;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreateKeyboardEvent(
            source: CGEventSourceRef,
            virtualKey: CGKeyCode,
            keyDown: c_int,
        ) -> CGEventRef;
        fn CGEventKeyboardSetUnicodeString(
            event: CGEventRef,
            stringLength: u64,
            unicodeString: *const u16,
        );
        fn CGEventPost(tap: CGEventTapLocation, event: CGEventRef);
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    if !unsafe { AXIsProcessTrusted() } {
        return Err(anyhow::anyhow!(
            "Accessibility permission required for live typing"
        ));
    }

    let utf16: Vec<u16> = text.encode_utf16().collect();
    if utf16.is_empty() {
        return Ok(());
    }

    const CHUNK_SIZE: usize = 20;

    for chunk in utf16.chunks(CHUNK_SIZE) {
        unsafe {
            let event_down = CGEventCreateKeyboardEvent(std::ptr::null_mut(), 0, 1);
            if event_down.is_null() {
                return Err(anyhow::anyhow!("CGEventCreateKeyboardEvent returned null"));
            }
            CGEventKeyboardSetUnicodeString(event_down, chunk.len() as u64, chunk.as_ptr());
            CGEventPost(K_CG_HID_EVENT_TAP, event_down);
            CFRelease(event_down);

            let event_up = CGEventCreateKeyboardEvent(std::ptr::null_mut(), 0, 0);
            if event_up.is_null() {
                return Err(anyhow::anyhow!("CGEventCreateKeyboardEvent returned null"));
            }
            CGEventKeyboardSetUnicodeString(event_up, chunk.len() as u64, chunk.as_ptr());
            CGEventPost(K_CG_HID_EVENT_TAP, event_up);
            CFRelease(event_up);
        }

        if utf16.len() > CHUNK_SIZE {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    Ok(())
}
```

### Windows implementation

```rust
#[cfg(target_os = "windows")]
pub fn type_text_direct(text: &str) -> Result<()> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    };

    let utf16: Vec<u16> = text.encode_utf16().collect();
    if utf16.is_empty() {
        return Ok(());
    }

    let mut inputs: Vec<INPUT> = Vec::with_capacity(utf16.len() * 2);
    for &ch in &utf16 {
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0, wScan: ch, dwFlags: KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0,
                },
            },
        });
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0, wScan: ch, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0,
                },
            },
        });
    }

    let count = inputs.len() as u32;
    let sent = unsafe { SendInput(count, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    if sent != count {
        return Err(anyhow::anyhow!("SendInput: only {} of {} events sent", sent, count));
    }
    Ok(())
}
```

### Fallback

```rust
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn type_text_direct(_text: &str) -> Result<()> {
    Ok(())
}
```

## Task 2: Add `type_text_live` Tauri command

**File:** `src-tauri/src/commands.rs`

```rust
#[tauri::command]
pub async fn type_text_live(text: String, app: AppHandle) -> Result<(), String> {
    if text.is_empty() { return Ok(()); }
    let app_name = {
        let guard = previous_app().lock().unwrap_or_else(|e| e.into_inner());
        guard.clone()
    };
    if let Some(name) = &app_name {
        if name.to_lowercase().contains("omwhisper") { return Ok(()); }
    }
    tokio::task::spawn_blocking(move || {
        paste::type_text_direct(&text).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
```

## Task 3: Register command in `lib.rs`

Add `type_text_live` to imports and `invoke_handler` list.

## Task 4: Frontend wiring in `App.tsx`

Add `typedTextLengthRef` + `liveTypingActiveRef` refs. In `transcription-update` listener, compute
delta and call `invoke("type_text_live", { text: delta })`. In `transcription-complete` handler,
skip `paste_transcription` when `liveTypingActiveRef.current` is true (text already in the app).
