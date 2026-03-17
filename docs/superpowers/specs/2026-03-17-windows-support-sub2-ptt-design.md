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
- `mod fn_key;` in `lib.rs` is already gated with `#[cfg(target_os = "macos")]` (lines 12–13) — no linker issue here. ✅
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

**Change 1 — Gate PTT plugin shortcut registration:**

The block starting at `// --- Push-to-talk shortcut: hold to record, release to stop ---` (currently lines 366–388) is wrapped in a `#[cfg(not(target_os = "windows"))]` block. Using a block (not an attribute on the `if let` expression directly) is the idiomatic stable Rust pattern:

```rust
// --- Push-to-talk shortcut: hold to record, release to stop ---
#[cfg(not(target_os = "windows"))]
{
    if let Some(ptt_sc) = parse_hotkey(&initial_settings.push_to_talk_hotkey) {
        ...
    }
}
```

The guard uses `#[cfg(not(target_os = "windows"))]` rather than `#[cfg(target_os = "macos")]` intentionally — this leaves the door open for a future Linux PTT implementation without another spec change. The existing single-key CGEventTap block below it correctly uses `#[cfg(target_os = "macos")]` since CGEventTap is macOS-only and that distinction is permanent.

This prevents PTT plugin shortcuts from being registered on Windows regardless of what `push_to_talk_hotkey` is set to in settings.json.

### `src/components/Settings.tsx`

**Change 2 — Add platform detection:**

The PTT section lives inside the `SettingsPanel` component's `general` tab render path. Add `platform` state after the existing `useState` declarations (around line 179, after `accessibilityGranted` state):

```typescript
const [platform, setPlatform] = useState<string>("macos");

useEffect(() => {
  invoke<string>("get_platform").then(setPlatform).catch(() => {});
}, []);
```

Default of `"macos"` ensures the PTT section is shown during the brief async fetch window on macOS — no flash of hidden content.

**Change 3 — Conditionally render PTT section:**

Wrap the PTT `<h3>` heading (line ~571) and its card `<div>` (lines ~571–603) in a platform guard. The block ends just before the "Reference" `<h3>` at line ~605:

```tsx
{platform !== "windows" && (
  <>
    <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Push to Talk</h3>
    <div className="card px-5 mb-6">
      ... {/* existing PTT toggle + key dropdown */}
    </div>
  </>
)}
```

On Linux, `platform` will be `"linux"` so `platform !== "windows"` is true — PTT UI remains visible on Linux, consistent with the Rust-side `#[cfg(not(target_os = "windows"))]` guard that keeps PTT shortcuts registered on Linux.

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Wrap PTT plugin shortcut block (`if let Some(ptt_sc)...`) in `#[cfg(not(target_os = "windows"))]` block |
| `src/components/Settings.tsx` | Add `platform` state from `get_platform`; hide PTT section when `platform === "windows"` |

---

## Behavior After This Change

| Scenario | Before | After |
|----------|--------|-------|
| Windows build — compile | Compiles (fn_key already gated) | Unchanged — still compiles |
| Windows runtime — PTT shortcut | PTT plugin shortcut may register | Never registered |
| Windows runtime — Settings UI | PTT section visible (but non-functional) | PTT section hidden |
| Linux runtime — PTT shortcut | PTT plugin shortcut may register | Still registered (not(windows) gate) |
| macOS — all PTT | Unchanged | Unchanged |

---

## Out of Scope

- PTT support on Windows (no Win32 keyboard hook implementation)
- Changes to `fn_key.rs`
- Changes to `settings.rs`
- Resetting `recording_mode` to `"toggle"` for Windows users at startup
