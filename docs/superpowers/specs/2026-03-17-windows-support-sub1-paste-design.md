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
- Onboarding Accessibility step skipped on Windows
- New `is_macos` Tauri command for frontend platform detection

**Out of scope (addressed in other sub-projects):**
- PTT/Fn key on Windows (Sub-project 2)
- LLM CPU backend on Windows (Sub-project 3)
- Build pipeline and distribution (Sub-project 4)
- whisper.cpp Windows build (Sub-project 5)

---

## Architecture

All platform-specific code stays in `paste.rs` and `license/mod.rs` using `#[cfg(target_os)]` guards — the same pattern already used throughout the codebase. No new files. One new lightweight crate (`winreg`). The frontend detects platform via a new `is_macos` Tauri command and adjusts onboarding accordingly.

---

## paste.rs — Windows Implementation

Add `#[cfg(target_os = "windows")]` blocks for all four platform-specific functions:

### `paste_to_app()`
Uses Win32 `SendInput` to inject a Ctrl+V keypress:
1. Build two `INPUT` structs: VK_CONTROL keydown + `0x56` (V) keydown
2. Build two `INPUT` structs: `0x56` keyup + VK_CONTROL keyup
3. Call `SendInput` with all four events in sequence

No Accessibility permission needed. `SendInput` works from any process on Windows without special permissions.

### `has_accessibility_permission()`
Returns `true` unconditionally. Windows has no equivalent to macOS TCC Accessibility permission for `SendInput`.

### `open_accessibility_settings()`
Returns `Ok(())` as a no-op. No settings to open.

### `get_frontmost_app()`
Returns `"Windows"` as a stub string. The focused app capture is macOS-specific and is only used for logging — the actual paste targets the frontmost window regardless.

### `read_clipboard()` and `write_clipboard()`
Already use `arboard` which is cross-platform. No changes needed.

---

## license/mod.rs — Windows Machine ID

Add a `#[cfg(target_os = "windows")]` block for the `get_machine_id()` function:

Read `MachineGuid` from the Windows registry:
- Key: `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography`
- Value: `MachineGuid`

This is a stable UUID assigned at Windows installation, equivalent to macOS `IOPlatformUUID`. Reading via the `winreg` crate — no external process, no WMIC (deprecated in Windows 11).

The same SHA-256 hash is applied to the result as on macOS, keeping the license validation logic identical across platforms.

`keyring` already supports Windows Credential Manager — no changes to the keyring storage logic.

---

## commands.rs — is_macos Command

Add a new Tauri command:

```rust
#[tauri::command]
pub fn is_macos() -> bool {
    cfg!(target_os = "macos")
}
```

Register it in `lib.rs` alongside other commands. Used by the frontend to conditionally render platform-specific UI.

---

## Onboarding.tsx — Skip Accessibility Step on Windows

Current 5-step flow: Welcome → Mic → **Accessibility** → Download → Ready.

On Windows, the Accessibility step is skipped:
- On mount, call `invoke<boolean>("is_macos")`
- Filter the steps array to exclude the Accessibility step when `isMacos === false`
- Step numbering and progress indicator adjust automatically (4 steps on Windows)

The Accessibility step content and logic (permission request button, granted state) is unchanged — it simply isn't included in the Windows step sequence.

---

## Cargo.toml — winreg Dependency

Add as a Windows-only dependency:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
winreg = "0.52"
```

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/paste.rs` | Add `#[cfg(target_os = "windows")]` blocks for `paste_to_app`, `has_accessibility_permission`, `open_accessibility_settings`, `get_frontmost_app` |
| `src-tauri/src/license/mod.rs` | Add `#[cfg(target_os = "windows")]` block for `get_machine_id` using `winreg` |
| `src-tauri/Cargo.toml` | Add `winreg = "0.52"` as Windows-only target dependency |
| `src-tauri/src/commands.rs` | Add `is_macos` command |
| `src-tauri/src/lib.rs` | Register `is_macos` command in `.invoke_handler()` |
| `src/components/Onboarding.tsx` | Read `is_macos` on mount, filter out Accessibility step on Windows |

---

## Out of Scope

- CUDA or GPU acceleration for LLM on Windows (CPU-only, Sub-project 3)
- PTT key detection on Windows (toggle-only, Sub-project 2)
- Code signing for Windows distribution (Sub-project 4)
- whisper-rs build flags for Windows (Sub-project 5)
- Any changes to the recording, transcription, or AI polish pipeline
