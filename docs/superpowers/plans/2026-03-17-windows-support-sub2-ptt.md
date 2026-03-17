# Windows Support Sub-project 2: Disable PTT on Windows — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Push-to-Talk from being registered or shown on Windows, making OmWhisper toggle-only on that platform.

**Architecture:** Two targeted changes — wrap the PTT plugin shortcut registration in a `#[cfg(not(target_os = "windows"))]` block in `lib.rs`, and hide the PTT Settings UI section on Windows using the existing `get_platform` Tauri command. No new files, no new commands, no settings struct changes.

**Tech Stack:** Rust (`#[cfg]` attribute), React/TypeScript (`useState`, `invoke`)

**Spec:** `docs/superpowers/specs/2026-03-17-windows-support-sub2-ptt-design.md`

---

## Chunk 1: All changes (Rust + Frontend)

### Task 1: Gate PTT plugin shortcut in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs:366–389` (wrap `if let Some(ptt_sc)` block)

**Context:** The PTT plugin shortcut block at lines 366–389 registers a modifier+key combo PTT shortcut via `tauri_plugin_global_shortcut`. It is currently ungated, meaning it runs on Windows too. The single-key CGEventTap block below it (lines 391–455) is already `#[cfg(target_os = "macos")]` and needs no change. `mod fn_key;` at lines 12–13 is already `#[cfg(target_os = "macos")]` and needs no change.

The current code at lines 366–389:
```rust
            // --- Push-to-talk shortcut: hold to record, release to stop ---
            if let Some(ptt_sc) = parse_hotkey(&initial_settings.push_to_talk_hotkey) {
                let state_ptt = shared_state.clone();
                if let Err(e) = app.global_shortcut().on_shortcut(ptt_sc, move |app, _shortcut, event| {
                    let is_recording = state_ptt.lock().unwrap().capture.is_some();
                    match event.state {
                        ShortcutState::Pressed => {
                            if !is_recording {
                                let focused = crate::paste::get_frontmost_app();
                                tracing::info!("ptt pressed: captured frontmost app = {:?}", focused);
                                *crate::commands::get_previous_app().lock().unwrap() = focused;
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
```

- [ ] **Step 1: Wrap PTT block in cfg guard**

Replace the block at lines 366–389 with:

```rust
            // --- Push-to-talk shortcut: hold to record, release to stop ---
            // Not(windows): PTT is toggle-only on Windows; plugin shortcut not registered there.
            // Uses not(windows) rather than macos so Linux can use PTT if added in future.
            #[cfg(not(target_os = "windows"))]
            {
                if let Some(ptt_sc) = parse_hotkey(&initial_settings.push_to_talk_hotkey) {
                    let state_ptt = shared_state.clone();
                    if let Err(e) = app.global_shortcut().on_shortcut(ptt_sc, move |app, _shortcut, event| {
                        let is_recording = state_ptt.lock().unwrap().capture.is_some();
                        match event.state {
                            ShortcutState::Pressed => {
                                if !is_recording {
                                    let focused = crate::paste::get_frontmost_app();
                                    tracing::info!("ptt pressed: captured frontmost app = {:?}", focused);
                                    *crate::commands::get_previous_app().lock().unwrap() = focused;
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
```

Note: The only changes are adding `#[cfg(not(target_os = "windows"))]`, wrapping in `{ }`, and indenting the inner code one level. The inner logic is identical.

- [ ] **Step 2: Verify macOS build**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 3: Verify tests pass**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo test
```

Expected: all tests pass, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: gate PTT plugin shortcut registration on non-Windows platforms"
```

---

### Task 2: Hide PTT section in Settings.tsx on Windows

**Files:**
- Modify: `src/components/Settings.tsx` (add `platform` state; wrap PTT section)

**Context:** The `SettingsPanel` component in `Settings.tsx` has a PTT section at lines 571–603 (the `<h3>Push to Talk</h3>` heading and its card `<div>`). This section must be hidden on Windows. The `get_platform` Tauri command (added in Sub-project 1) returns `"macos"`, `"windows"`, or `"linux"`. `useState` and `useEffect` are already imported at line 1. `invoke` is already imported at line 2. The existing `useState` declarations for this component end at line 181 (`accessibilityGranted`). The mount `useEffect` is at line 183.

- [ ] **Step 1: Add platform state**

Find this line (currently line 180):
```typescript
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
```

Insert `platform` state immediately after it:
```typescript
  const [platform, setPlatform] = useState<string>("macos");
```

Then find the existing mount `useEffect` that starts with:
```typescript
  useEffect(() => {
    // Load settings first so the panel renders immediately
    invoke<Settings>("get_settings").then(setSettings);
```

Insert a new `useEffect` immediately before that block:
```typescript
  useEffect(() => {
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
  }, []);
```

Default `"macos"` ensures no flash of hidden PTT section on macOS during the async fetch.

- [ ] **Step 2: Wrap PTT section in platform guard**

Find the PTT section starting at line 571:
```tsx
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Push to Talk</h3>
            <div className="card px-5 mb-6">
              ...
            </div>
```

The section ends at line 603 (`            </div>`), just before the "Reference" `<h3>` at line 605.

Wrap the entire PTT block (from the `<h3>` through the closing `</div>`) with:

```tsx
            {platform !== "windows" && (
              <>
                <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Push to Talk</h3>
                <div className="card px-5 mb-6">
                  <SettingRow label="Push to Talk Mode" description="Hold a key to record, release when done">
                    <Toggle
                      value={settings.recording_mode === "push_to_talk"}
                      onChange={(v) => update({ recording_mode: v ? "push_to_talk" : "toggle" })}
                      label="Push to talk"
                    />
                  </SettingRow>
                  {settings.recording_mode === "push_to_talk" && (
                    <>
                      <SettingRow label="Push to Talk Key" description="Hold this key to record, release to stop">
                        <select
                          value={["Fn","CapsLock","Right Option","Right Control"].includes(settings.push_to_talk_hotkey ?? "") ? settings.push_to_talk_hotkey : "Fn"}
                          onChange={(e) => update({ push_to_talk_hotkey: e.target.value })}
                          className="text-xs rounded-xl px-3 py-1.5 cursor-pointer"
                          style={{
                            background: "var(--bg)",
                            color: "var(--t1)",
                            border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
                            boxShadow: "var(--nm-pressed-sm)",
                            outline: "none",
                          }}
                        >
                          <option value="Fn">Fn</option>
                          <option value="CapsLock">CapsLock ⇪</option>
                          <option value="Right Option">Right Option ⌥</option>
                          <option value="Right Control">Right Control ⌃</option>
                        </select>
                      </SettingRow>
                    </>
                  )}
                </div>
              </>
            )}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: hide PTT settings section on Windows"
```
