# Windows Support Sub-project 1: Cross-Platform Paste + Machine ID — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OmWhisper's auto-paste and license machine ID work on Windows, with a `get_platform` Tauri command for frontend platform detection and platform-neutral onboarding copy.

**Architecture:** All changes use `#[cfg(target_os)]` guards to add Windows implementations alongside existing macOS code. The existing `#[cfg(not(target_os = "macos"))]` stubs in `paste.rs` and `license/mod.rs` are replaced with three-way splits (`macos` / `windows` / `not(any(macos, windows))`). No new files created.

**Tech Stack:** Rust (`windows-sys` for Win32 SendInput, `winreg` for registry), React/TypeScript (Tauri invoke)

**Spec:** `docs/superpowers/specs/2026-03-17-windows-support-sub1-paste-design.md`

---

## Chunk 1: Backend — get_platform, paste, machine ID

### Task 1: Add get_platform Tauri command

**Files:**
- Modify: `src-tauri/src/commands.rs` (add `get_platform` near end of file, before last command)
- Modify: `src-tauri/src/lib.rs:683` (add `get_platform` to `generate_handler!`)

The `invoke_handler` in `lib.rs` ends at line 683:
```rust
            styles::remove_custom_style,
        ])
```

- [ ] **Step 1: Add command to commands.rs**

At the end of `src-tauri/src/commands.rs`, append after the closing `}` of the last function (`get_model_recommendation`, currently at line 1117). The new function is a top-level free function, not nested inside anything:

```rust
#[tauri::command]
pub fn get_platform() -> &'static str {
    if cfg!(target_os = "macos") { "macos" }
    else if cfg!(target_os = "windows") { "windows" }
    else { "linux" }
}
```

- [ ] **Step 2: Register in lib.rs**

In `src-tauri/src/lib.rs` at line 682, after `styles::remove_custom_style,` and before `])`, add:

```rust
            get_platform,
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add get_platform Tauri command"
```

---

### Task 2: Windows paste implementation (paste.rs + Cargo.toml)

**Files:**
- Modify: `src-tauri/src/paste.rs` (replace all four `#[cfg(not(target_os = "macos"))]` stubs with three-way splits)
- Modify: `src-tauri/Cargo.toml` (add `windows-sys` as Windows-only dep)

The current `paste.rs` has four functions with `#[cfg(not(target_os = "macos"))]` stubs:
- `has_accessibility_permission()` — line 25, returns `false`
- `get_frontmost_app()` — line 44, returns `None`
- `paste_to_app()` — line 140, returns `Ok(())`
- `open_accessibility_settings()` — line 153, empty body

Each of these needs to become a **three-way split**. The pattern:
```rust
#[cfg(target_os = "macos")]
fn foo() { /* existing macOS impl */ }

#[cfg(target_os = "windows")]
fn foo() { /* new Windows impl */ }

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn foo() { /* existing stub body */ }
```

- [ ] **Step 1: Add windows-sys to Cargo.toml**

In `src-tauri/Cargo.toml`, after the `[dependencies]` section (after line 52 `sysinfo = ...`), add a new section:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows-sys = { version = "0.52", features = ["Win32_UI_Input_KeyboardAndMouse"] }
winreg = "0.55"
```

Notes:
- `windows-sys = "0.52"` — version 0.52.0 is confirmed in `Cargo.lock` as a transitive dep (grep verified). Declaring it explicitly here with the `Win32_UI_Input_KeyboardAndMouse` feature ensures that feature is enabled. No new crate copy is added. The `INPUT_0` anonymous union field path used in Step 4 is correct for 0.52.x; `cargo check` (Step 6) will catch any API mismatch if the resolved version differs.
- `winreg = "0.55"` — version 0.55.0 is confirmed in `Cargo.lock` as a transitive dep (from keyring). Declaring it here makes it a direct dep so we can use it in our code.
- `sha2` and `hex` are already unconditional deps in `[dependencies]` (`sha2 = "0.10"`, `hex = "0.4"` at Cargo.toml lines 37–38). No additional dep declarations needed for the Windows machine ID code in Task 3.
- Both `windows-sys` and `winreg` entries are in `[target.'cfg(target_os = "windows")'.dependencies]` so they do not affect macOS builds.
- `winreg` is added here (used in Task 3) to keep all Windows-only deps together.

- [ ] **Step 2: Replace has_accessibility_permission stubs**

Replace the `#[cfg(not(target_os = "macos"))]` block at line 25-28:
```rust
#[cfg(not(target_os = "macos"))]
pub fn has_accessibility_permission() -> bool {
    false
}
```

With:
```rust
#[cfg(target_os = "windows")]
pub fn has_accessibility_permission() -> bool {
    true // Windows does not require Accessibility permission for SendInput
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn has_accessibility_permission() -> bool {
    false
}
```

- [ ] **Step 3: Replace get_frontmost_app stub**

Replace the `#[cfg(not(target_os = "macos"))]` block at lines 44-47:
```rust
#[cfg(not(target_os = "macos"))]
pub fn get_frontmost_app() -> Option<String> {
    None
}
```

With:
```rust
#[cfg(target_os = "windows")]
pub fn get_frontmost_app() -> Option<String> {
    Some("Windows".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn get_frontmost_app() -> Option<String> {
    None
}
```

- [ ] **Step 4: Add Windows paste_to_app implementation**

Replace the `#[cfg(not(target_os = "macos"))]` stub at lines 140-143:
```rust
#[cfg(not(target_os = "macos"))]
pub fn paste_to_app(_app_name: &str) -> Result<()> {
    Ok(())
}
```

With:
```rust
#[cfg(target_os = "windows")]
pub fn paste_to_app(_app_name: &str) -> Result<()> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VK_CONTROL,
    };

    // Brief pause to allow recording to fully stop before paste
    std::thread::sleep(std::time::Duration::from_millis(200));

    let make_key = |vk: u16, flags: u32| -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    };

    let inputs: [INPUT; 4] = [
        make_key(VK_CONTROL, 0),         // Ctrl down
        make_key(0x56, 0),               // V down
        make_key(0x56, KEYEVENTF_KEYUP), // V up
        make_key(VK_CONTROL, KEYEVENTF_KEYUP), // Ctrl up
    ];

    unsafe {
        let sent = SendInput(4, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
        if sent != 4 {
            return Err(anyhow::anyhow!("SendInput failed: only {} of 4 events sent", sent));
        }
    }

    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn paste_to_app(_app_name: &str) -> Result<()> {
    Ok(())
}
```

- [ ] **Step 5: Replace open_accessibility_settings stub**

Replace the `#[cfg(not(target_os = "macos"))]` stub at lines 153-154:
```rust
#[cfg(not(target_os = "macos"))]
pub fn open_accessibility_settings() {}
```

With:
```rust
#[cfg(target_os = "windows")]
pub fn open_accessibility_settings() {
    // No accessibility settings needed on Windows
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn open_accessibility_settings() {}
```

- [ ] **Step 6: Verify macOS build still passes**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: no errors. The macOS implementations are unchanged; only the non-macOS stubs have been split.

- [ ] **Step 7: Verify unit tests pass**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo test
```

Expected: all tests pass, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/paste.rs src-tauri/Cargo.toml
git commit -m "feat: add Windows paste implementation via SendInput"
```

---

### Task 3: Windows machine ID (license/mod.rs)

**Depends on:** Task 2 must complete first (Task 2, Step 1 adds `winreg` to Cargo.toml, which this task uses)

**Files:**
- Modify: `src-tauri/src/license/mod.rs:96-115` (the `get_machine_id` function's macOS block)

The current `get_machine_id()` function (lines 96-136) has:
- `#[cfg(target_os = "macos")]` block that reads `ioreg` (lines 98-115)
- A shared fallback at lines 117-135 that generates+persists a random UUID

The macOS block has no matching `#[cfg(not(target_os = "macos"))]` stub — the fallback UUID is shared code. This means a Windows build already works (uses the UUID fallback), but we can improve it by reading the stable `MachineGuid` from the Windows registry.

- [ ] **Step 1: Add Windows machine ID block**

In `src-tauri/src/license/mod.rs`, after the closing `}` of the macOS block (after line 115), add a Windows block before the shared fallback comment at line 117:

```rust
    // Windows: read stable MachineGuid from registry
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        use sha2::{Digest, Sha256};

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(key) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
            if let Ok(guid) = key.get_value::<String, _>("MachineGuid") {
                let hash = hex::encode(Sha256::digest(guid.as_bytes()));
                return hash[..16].to_string();
            }
        }
        // Falls through to the shared UUID fallback below if registry read fails
    }
```

Insert this block between line 115 (`}`) and line 117 (`// Fallback: generate and persist a random UUID`).

- [ ] **Step 2: Verify macOS build**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo check
```

Expected: no errors. `winreg` is gated behind `#[cfg(target_os = "windows")]` so it won't affect macOS compilation.

- [ ] **Step 3: Verify tests still pass**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri && cargo test
```

Expected: all tests pass, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/license/mod.rs
git commit -m "feat: add Windows machine ID via registry MachineGuid"
```

---

## Chunk 2: Frontend — Onboarding platform-neutral copy

### Task 4: Platform-aware onboarding copy (Onboarding.tsx)

**Files:**
- Modify: `src/components/Onboarding.tsx` (3 string changes using `get_platform`)

The current onboarding has 3 macOS-specific strings:
1. Line ~189 (Step 2): `"running locally on your Mac"` — inside the Download Model step description
2. Line ~174 (Step 1): `"Go to System Settings → Privacy & Security → Microphone and enable OmWhisper"` — inside the mic denied message
3. Line ~296 (Step 4): `"OmWhisper lives in your menu bar"` — inside the Ready step description

**No step removal, no TOTAL_STEPS changes, no setStep(N) changes.** Only the text content of these three strings changes.

- [ ] **Step 1: Add platform state**

In `Onboarding.tsx`, after the existing `useState` declarations (around line 52), add:

```typescript
const [platform, setPlatform] = useState<string>("macos");

useEffect(() => {
  invoke<string>("get_platform").then(setPlatform).catch(() => {});
}, []);
```

- [ ] **Step 2: Update Step 2 Download Model description**

Find the string `"running locally on your Mac"` (around line 189 in step2). Change:
```typescript
OmWhisper uses OpenAI's Whisper model running locally on your Mac.
```
To:
```typescript
OmWhisper uses OpenAI's Whisper model running locally on your device.
```

(Simple text change — no platform condition needed since "on your device" is accurate for all platforms.)

- [ ] **Step 3: Update Step 1 mic denied message**

Find the mic denied help text (around line 174):
```typescript
Go to System Settings → Privacy & Security → Microphone and enable OmWhisper, then restart the app.
```

Replace with a platform-conditional:
```typescript
{platform === "windows"
  ? "Go to Settings → Privacy & Security → Microphone Privacy Settings and enable OmWhisper, then restart the app."
  : "Go to System Settings → Privacy & Security → Microphone and enable OmWhisper, then restart the app."
}
```

- [ ] **Step 4: Update Step 4 Ready description**

Find the "menu bar" string (around line 296 in step4):
```typescript
OmWhisper lives in your menu bar.
```

Replace with:
```typescript
{platform === "windows" ? "OmWhisper lives in your system tray." : "OmWhisper lives in your menu bar."}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Smoke test on macOS**

Run `cargo tauri dev`. Go through onboarding (or reset `onboarding_complete: false` in settings.json). Verify:
- Step 1 mic denied shows macOS system settings path
- Step 2 says "on your device" (not "on your Mac")
- Step 4 says "in your menu bar"

- [ ] **Step 7: Commit**

```bash
git add src/components/Onboarding.tsx
git commit -m "feat: platform-neutral copy in onboarding for Windows compatibility"
```
