# Windows Support Sub-project 1: Cross-Platform Paste + Machine ID — Design Spec

**Date:** 2026-03-17
**Branch:** feature/windows-support
**Status:** Approved

---

## Goal

Make OmWhisper's auto-paste and license machine ID work on Windows, with no regressions on macOS. This is Sub-project 1 of 5 in the Windows support effort.

---

## Scope

This sub-project covers:
- Auto-paste via Win32 `SendInput` (Ctrl+V) on Windows
- Accessibility permission stubs on Windows (no permission system needed)
- Machine ID via Windows registry `MachineGuid` for license validation
- Platform-aware onboarding copy (macOS text strings updated to be platform-neutral)
- New `get_platform` Tauri command for frontend platform detection

**Out of scope (addressed in other sub-projects):**
- PTT/Fn key on Windows (Sub-project 2)
- LLM CPU backend on Windows (Sub-project 3)
- Build pipeline and distribution (Sub-project 4)
- whisper.cpp Windows build (Sub-project 5)

---

## Architecture

All platform-specific code stays in `paste.rs` and `license/mod.rs` using `#[cfg(target_os)]` guards — the same pattern already used throughout the codebase. No new files. One new lightweight crate (`winreg`) for registry access. The frontend detects platform via a new `get_platform` Tauri command and adjusts platform-specific text strings in onboarding.

---

## paste.rs — Windows Implementation

### cfg guard pattern

The existing `paste.rs` uses `#[cfg(not(target_os = "macos"))]` stubs for the non-macOS path. These stubs must be **replaced** (not supplemented) with a three-way split to avoid duplicate definitions on Windows:

```rust
#[cfg(target_os = "macos")]
fn paste_to_app(...) { /* CoreGraphics implementation */ }

#[cfg(target_os = "windows")]
fn paste_to_app(...) { /* SendInput implementation */ }

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn paste_to_app(...) { /* stub for Linux/other */ }
```

Apply this three-way pattern to all four platform-specific functions: `paste_to_app`, `has_accessibility_permission`, `open_accessibility_settings`, `get_frontmost_app`.

### `paste_to_app()` — Windows

Uses Win32 `SendInput` with a single call containing 4 `INPUT` events (atomic — no interleaved input from other processes):

```rust
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    VK_CONTROL,
};

// Build 4 INPUT structs:
// 1. VK_CONTROL (0x11) keydown: wVk=VK_CONTROL, dwFlags=0
// 2. 'V' (0x56) keydown:        wVk=0x56, dwFlags=0
// 3. 'V' (0x56) keyup:          wVk=0x56, dwFlags=KEYEVENTF_KEYUP (0x0002)
// 4. VK_CONTROL (0x11) keyup:   wVk=VK_CONTROL, dwFlags=KEYEVENTF_KEYUP
// All events: type=INPUT_KEYBOARD (1), wScan=0, time=0, dwExtraInfo=0
SendInput(4, inputs.as_ptr(), size_of::<INPUT>() as i32);
```

`windows-sys` is already a transitive dependency in the lock file — no new crate needed for the paste side.

### `has_accessibility_permission()` — Windows

Returns `true` unconditionally. Windows has no equivalent to macOS TCC Accessibility permission for `SendInput`. The existing `#[cfg(not(target_os = "macos"))]` stub returns `false` — this is replaced by the Windows block returning `true`.

### `open_accessibility_settings()` — Windows

Returns `Ok(())` as a no-op.

### `get_frontmost_app()` — Windows

Returns `Ok("Windows".to_string())` as a stub — used for logging only.

### `read_clipboard()` and `write_clipboard()`

Already use `arboard` which is cross-platform. No changes needed.

---

## license/mod.rs — Windows Machine ID

Add a `#[cfg(target_os = "windows")]` block for `get_machine_id()`, replacing the existing `#[cfg(not(target_os = "macos"))]` stub:

Read `MachineGuid` from the Windows registry:
- Key: `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography`
- Value name: `MachineGuid`
- Type: `REG_SZ` (string)

```rust
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
let key = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography")?;
let guid: String = key.get_value("MachineGuid")?;
```

If the key is missing (unusual but possible on stripped Windows installs), fall back to a random UUID generated once and stored in the settings directory alongside `settings.json`.

`MachineGuid` is a stable UUID assigned at Windows installation. The same SHA-256 hash applied to the result as on macOS keeps license validation logic identical.

`keyring` already supports Windows Credential Manager — no changes to keyring storage.

---

## commands.rs — get_platform Command

Add a `get_platform` command returning the current OS as a string. Using a string rather than `is_macos: bool` avoids adding separate `is_windows` / `is_linux` commands for Sub-projects 2 and 3:

```rust
#[tauri::command]
pub fn get_platform() -> &'static str {
    if cfg!(target_os = "macos") { "macos" }
    else if cfg!(target_os = "windows") { "windows" }
    else { "linux" }
}
```

Register in `lib.rs` alongside other commands.

---

## Onboarding.tsx — Platform-Neutral Copy

The current onboarding has no Accessibility step — it was not implemented in the final UI. The 5 steps are:
- Step 0: Welcome
- Step 1: Microphone Access
- Step 2: Download AI Model
- Step 3: Say Something! (try it out)
- Step 4: You're All Set!

No steps need to be removed. Three strings contain macOS-specific copy that must be updated for Windows:

**Step 2** (line ~189): `"running locally on your Mac"` → `"running locally on your device"`

**Step 4** (line ~296): `"OmWhisper lives in your menu bar"` → on Windows: `"OmWhisper lives in your system tray"`

**Step 1** (line ~174): The denied-permission help text `"Go to System Settings → Privacy & Security → Microphone"` is macOS-specific → on Windows: `"Go to Settings → Privacy & Security → Microphone Privacy Settings"`

**Implementation:** Call `invoke<string>("get_platform")` on mount (store as `platform` state). Use it to conditionally render the three strings above. All `setStep(N)` calls and `TOTAL_STEPS` remain unchanged.

---

## Cargo.toml — winreg Dependency

Add as a Windows-only dependency (verify latest published version at implementation time; `0.52` or later):

```toml
[target.'cfg(target_os = "windows")'.dependencies]
winreg = "0.52"
```

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/paste.rs` | Replace `#[cfg(not(target_os = "macos"))]` stubs with three-way cfg split; add Windows `SendInput` implementation |
| `src-tauri/src/license/mod.rs` | Replace `#[cfg(not(target_os = "macos"))]` machine ID stub with three-way cfg split; add Windows `MachineGuid` registry read with fallback |
| `src-tauri/Cargo.toml` | Add `winreg` as Windows-only target dependency |
| `src-tauri/src/commands.rs` | Add `get_platform` command |
| `src-tauri/src/lib.rs` | Register `get_platform` in `.invoke_handler()` |
| `src/components/Onboarding.tsx` | Read `get_platform` on mount; conditionally render 3 platform-specific strings |

---

## Out of Scope

- CUDA or GPU acceleration for LLM on Windows (CPU-only, Sub-project 3)
- PTT key detection on Windows (toggle-only, Sub-project 2)
- Code signing for Windows distribution (Sub-project 4)
- whisper-rs build flags for Windows (Sub-project 5)
- Any changes to the recording, transcription, or AI polish pipeline
