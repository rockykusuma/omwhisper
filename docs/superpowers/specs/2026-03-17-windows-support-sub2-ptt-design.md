# Windows Support Sub-project 2: Disable PTT on Windows — Design Spec

**Date:** 2026-03-17
**Branch:** feature/windows-support
**Status:** Approved

---

## Goal

Prevent Push-to-Talk (PTT) from being compiled, registered, or shown to users on Windows. OmWhisper on Windows is toggle-only (⌘+Shift+V / Ctrl+Shift+V). This is Sub-project 2 of 5 in the Windows support effort.

---

## Background

PTT on macOS uses two mechanisms:
1. **`tauri_plugin_global_shortcut`** — for custom modifier+key combos (e.g. `Ctrl+Shift+R`). Registered at startup in `lib.rs` if `recording_mode == "push_to_talk"` and `push_to_talk_hotkey` parses as a valid hotkey.
2. **CGEventTap** — for bare single keys (Fn, CapsLock, Right Option, Right Control). Implemented entirely in `fn_key.rs` using CoreGraphics/CoreFoundation framework calls. The `lib.rs` single-key PTT block is already guarded with `#[cfg(target_os = "macos")]`.

The problem on Windows:
- `mod fn_key;` in `lib.rs` is **not** gated → `fn_key.rs` would be compiled on Windows, and its `#[link(name = "CoreGraphics", kind = "framework")]` / `#[link(name = "CoreFoundation", kind = "framework")]` declarations would cause a **linker error** on Windows.
- The PTT plugin shortcut registration block is **not** gated → on Windows, if `push_to_talk_hotkey` parses as a valid combo, a PTT shortcut would be registered.
- The Settings UI PTT section is **not** platform-conditional → Windows users would see PTT controls that do nothing.

---

## Scope

This sub-project covers:
- Gating `mod fn_key;` so `fn_key.rs` is not compiled on Windows
- Gating the PTT plugin shortcut registration block so no PTT shortcuts are registered on Windows
- Hiding the PTT section in Settings.tsx on Windows

**Out of scope:**
- Any PTT support on Windows (deferred indefinitely; toggle-only is the design decision)
- Changes to `fn_key.rs` itself — the module-level gate is sufficient
- Changes to `settings.rs` — `recording_mode` and `push_to_talk_hotkey` fields remain in the struct; Windows simply never acts on them
- Forced reset of `recording_mode` to `"toggle"` in settings.json on Windows — not needed since all PTT code paths are gated

---

## Architecture

Two files changed. No new files created.

### `src-tauri/src/lib.rs`

**Change 1 — Gate `mod fn_key` (line 13):**

```rust
// Before:
mod fn_key;

// After:
#[cfg(target_os = "macos")]
mod fn_key;
```

This prevents `fn_key.rs` from being compiled on Windows. The CoreGraphics and CoreFoundation `#[link]` declarations inside `fn_key.rs` become invisible to the Windows linker. All call sites (`crate::fn_key::spawn_fn_key_tap`, etc.) are already inside the existing `#[cfg(target_os = "macos")]` block at lines 391–455, so no call site changes are needed.

**Change 2 — Gate PTT plugin shortcut registration:**

The block starting at `// --- Push-to-talk shortcut: hold to record, release to stop ---` (currently lines 366–388) is wrapped in `#[cfg(not(target_os = "windows"))]`:

```rust
// --- Push-to-talk shortcut: hold to record, release to stop ---
#[cfg(not(target_os = "windows"))]
if let Some(ptt_sc) = parse_hotkey(&initial_settings.push_to_talk_hotkey) {
    ...
}
```

This prevents PTT plugin shortcuts from being registered on Windows regardless of what `push_to_talk_hotkey` is set to in settings.json.

### `src/components/Settings.tsx`

**Change 3 — Add platform detection:**

After the existing `useState` declarations in the `GeneralSettings` component (or the parent `SettingsPanel` component that renders the PTT section), add:

```typescript
const [platform, setPlatform] = useState<string>("macos");

useEffect(() => {
  invoke<string>("get_platform").then(setPlatform).catch(() => {});
}, []);
```

Default of `"macos"` ensures the PTT section is shown during the brief async fetch window on macOS — no flash of hidden content.

**Change 4 — Conditionally render PTT section:**

Wrap the PTT `<h3>` heading and its card `<div>` in a platform guard:

```tsx
{platform !== "windows" && (
  <>
    <h3 ...>Push to Talk</h3>
    <div className="card px-5 mb-6">
      ...
    </div>
  </>
)}
```

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `#[cfg(target_os = "macos")]` to `mod fn_key;`; wrap PTT plugin shortcut block in `#[cfg(not(target_os = "windows"))]` |
| `src/components/Settings.tsx` | Add `platform` state from `get_platform`; hide PTT section when `platform === "windows"` |

---

## Behavior After This Change

| Scenario | Before | After |
|----------|--------|-------|
| Windows build — compile | Linker error (CoreGraphics missing) | Compiles cleanly |
| Windows runtime — PTT shortcut | PTT plugin shortcut may register | Never registered |
| Windows runtime — Settings UI | PTT section visible (but non-functional) | PTT section hidden |
| macOS — all PTT | Unchanged | Unchanged |

---

## Out of Scope

- PTT support on Windows (no Win32 keyboard hook implementation)
- Changes to `fn_key.rs`
- Changes to `settings.rs`
- Resetting `recording_mode` to `"toggle"` for Windows users at startup
