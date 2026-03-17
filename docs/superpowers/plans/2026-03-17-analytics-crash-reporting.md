# Analytics & Crash Reporting Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Aptabase (anonymous usage analytics via HTTP ingest) and Sentry (crash reporting) with opt-out toggles defaulting to on.

**Architecture:** `analytics.rs` is a new module with a `OnceLock`-based session ID and a `track(enabled, name, props)` free function that spawns a `tokio` task for the Aptabase HTTP POST. Sentry is initialized at the top of `run()` in `lib.rs` using `load_settings_sync()` (already called there) before the Tauri builder. The frontend mirrors `crash_reporting_enabled` to `localStorage` so `Sentry.init` in `main.tsx` can read it synchronously without an async IPC race.

**Tech Stack:** `sentry = "0.47"`, `sentry-anyhow = "0.47"` (Rust), `@sentry/react` (frontend), `reqwest` + `tokio::spawn` for Aptabase HTTP (existing deps).

**Spec:** `docs/superpowers/specs/2026-03-17-analytics-crash-reporting-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/build.rs` | Edit | Add `cargo:rerun-if-env-changed` for both secrets |
| `src-tauri/Cargo.toml` | Edit | Add `sentry`, `sentry-anyhow` |
| `src-tauri/src/analytics.rs` | **Create** | Session ID, `track()`, Aptabase HTTP POST |
| `src-tauri/src/lib.rs` | Edit | `mod analytics`, Sentry init, `app_launched` event |
| `src-tauri/src/settings.rs` | Edit | Add `analytics_enabled`, `crash_reporting_enabled` fields |
| `src-tauri/src/commands.rs` | Edit | `analytics::track()` calls at 5 event sites |
| `src-tauri/src/whisper/models.rs` | Edit | `analytics::track()` on download success; `sentry_anyhow::capture_anyhow` on error |
| `src-tauri/src/whisper/engine.rs` | Edit | `sentry_anyhow::capture_anyhow` on Whisper errors |
| `src-tauri/src/audio/vad.rs` | Edit | `sentry_anyhow::capture_anyhow` on inference errors |
| `src-tauri/src/audio/capture.rs` | Edit | `sentry_anyhow::capture_anyhow` on capture errors |
| `package.json` | Edit | Add `@sentry/react` |
| `src/main.tsx` | Edit | `Sentry.init` inside `.then()` before render; skip for overlay |
| `src/components/ErrorBoundary.tsx` | Edit | Wrap class with `Sentry.ErrorBoundary`, preserve fallback UI |
| `src/components/Settings.tsx` | Edit | Privacy subsection in About tab; write to `localStorage` on change |
| `src/types/index.ts` | Edit | Add `analytics_enabled`, `crash_reporting_enabled` to `AppSettings` |

---

## Task 1: Settings — Add opt-out fields (TDD)

**Files:**
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Write two failing tests**

In `src-tauri/src/settings.rs`, inside the `#[cfg(test)] mod tests` block (after line 297, after `default_vad_engine_is_rms`), add:

```rust
#[test]
fn default_analytics_enabled_is_true() {
    assert!(Settings::default().analytics_enabled);
}

#[test]
fn default_crash_reporting_enabled_is_true() {
    assert!(Settings::default().crash_reporting_enabled);
}

#[test]
fn analytics_fields_default_when_missing_from_json() {
    let json = r#"{"hotkey":"CmdOrCtrl+Shift+V","active_model":"tiny.en","language":"en","auto_launch":false,"auto_paste":true,"show_overlay":true,"vad_sensitivity":0.5,"onboarding_complete":false}"#;
    let s: Settings = serde_json::from_str(json).unwrap();
    assert!(s.analytics_enabled);
    assert!(s.crash_reporting_enabled);
}
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml analytics_enabled 2>&1 | tail -10
```

Expected: `error[E0609]: no field 'analytics_enabled' on type 'Settings'`

- [ ] **Step 3: Add fields to the Settings struct**

In `src-tauri/src/settings.rs`, after the `vad_engine` field (after line 104, before the closing `}`):

```rust
    /// Allow anonymous usage analytics via Aptabase. Default: true.
    #[serde(default = "default_true")]
    pub analytics_enabled: bool,
    /// Allow crash reports to be sent via Sentry. Default: true. Takes effect after restart.
    #[serde(default = "default_true")]
    pub crash_reporting_enabled: bool,
```

- [ ] **Step 4: Add both fields to `impl Default for Settings`**

In `src-tauri/src/settings.rs`, inside `impl Default`, after `vad_engine: default_vad_engine()` (line 172), add:

```rust
            analytics_enabled: true,
            crash_reporting_enabled: true,
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: `test result: ok. N passed`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat(settings): add analytics_enabled and crash_reporting_enabled fields"
```

---

## Task 2: `analytics.rs` — Aptabase HTTP ingest module (TDD)

**Files:**
- Create: `src-tauri/src/analytics.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod analytics;`)

- [ ] **Step 1: Create `analytics.rs` with failing test first**

Create `src-tauri/src/analytics.rs`:

```rust
use std::sync::OnceLock;
use serde_json::{json, Value};

const APTABASE_APP_KEY: &str = option_env!("APTABASE_APP_KEY").unwrap_or("");
const APTABASE_URL: &str = "https://eu.aptabase.com/api/v0/events";

static SESSION_ID: OnceLock<String> = OnceLock::new();

/// Call once at process start (from lib.rs run()) to generate a session ID.
pub fn init() {
    SESSION_ID.get_or_init(|| uuid::Uuid::new_v4().to_string());
}

/// Fire an analytics event. No-op when disabled or when APTABASE_APP_KEY is empty.
///
/// `enabled` — pass `settings.analytics_enabled` from the calling context.
/// `props`   — arbitrary JSON object with event properties. No PII.
pub fn track(enabled: bool, name: &str, props: Value) {
    if !enabled || APTABASE_APP_KEY.is_empty() {
        return;
    }
    let session_id = SESSION_ID.get().cloned().unwrap_or_default();
    let event_name = name.to_string();
    let os_name = if cfg!(target_os = "macos") { "macOS" } else { "Windows" };
    let version = env!("CARGO_PKG_VERSION");

    tokio::spawn(async move {
        let body = json!({
            "events": [{
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "sessionId": session_id,
                "eventName": event_name,
                "props": props,
                "systemProps": {
                    "appVersion": version,
                    "osName": os_name,
                }
            }]
        });
        let client = reqwest::Client::new();
        let result = client
            .post(APTABASE_URL)
            .header("App-Key", APTABASE_APP_KEY)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;
        if let Err(e) = result {
            tracing::debug!("Aptabase track failed (non-fatal): {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_is_noop_when_disabled() {
        // When analytics_enabled = false, track() returns immediately.
        // We verify this by calling it without panicking (no network, no session init needed).
        track(false, "test_event", json!({}));
        // If we reach here without panic, the no-op gate works.
    }

    #[test]
    fn track_is_noop_when_key_empty() {
        // APTABASE_APP_KEY is "" in test builds (env var not set).
        // Call with enabled=true — should still be a no-op because key is empty.
        init(); // ensure session ID is set
        track(true, "test_event", json!({}));
        // No network call is made (key is empty). Just verifies no panic.
    }

    #[test]
    fn init_is_idempotent() {
        init();
        let id1 = SESSION_ID.get().cloned();
        init(); // second call is a no-op
        let id2 = SESSION_ID.get().cloned();
        assert_eq!(id1, id2, "init() must not change the session ID after first call");
    }
}
```

- [ ] **Step 2: Add `mod analytics;` to `lib.rs`**

In `src-tauri/src/lib.rs`, after `mod styles;` (line 11), add:

```rust
mod analytics;
```

- [ ] **Step 3: Run analytics tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml analytics 2>&1 | tail -15
```

Expected: `test result: ok. 3 passed`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/analytics.rs src-tauri/src/lib.rs
git commit -m "feat(analytics): add Aptabase HTTP ingest module with opt-out gate"
```

---

## Task 3: Wire analytics callsites

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/whisper/models.rs`

- [ ] **Step 1: Init analytics session and fire `app_launched` in `lib.rs`**

`analytics::init()` only sets a `OnceLock` — safe to call anywhere. But `analytics::track()` calls `tokio::spawn`, which requires an active tokio runtime. Tauri's runtime is only live inside the `setup` closure, so the `track()` call must go there.

**Part A — call `analytics::init()` after the log guard** (before the builder, line ~140):

```rust
    crate::analytics::init();
```

**Part B — fire `app_launched` inside the `setup` closure**, alongside the existing `load_settings_sync()` call at line ~170:

```rust
        // Analytics: fire app_launched (tokio runtime is live here)
        {
            let s = crate::settings::load_settings_sync();
            crate::analytics::track(s.analytics_enabled, "app_launched", serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "platform": if cfg!(target_os = "macos") { "macos" } else { "windows" }
            }));
        }
```

Place this block at the top of the `setup` closure body (after the opening `move |app| {`), before the tray setup begins.

- [ ] **Step 2: Fire `recording_started` in `commands.rs`**

In `src-tauri/src/commands.rs`, find the `start_transcription` command. After the settings are loaded (find the `load_settings_sync()` call in that function), add:

```rust
    crate::analytics::track(settings.analytics_enabled, "recording_started", serde_json::json!({
        "mode": if is_smart_dictation { "smart_dictation" } else { &settings.recording_mode }
    }));
```

Place this after the early-return guard (after the recording-already-active check) and before the `AudioCapture::new` call.

- [ ] **Step 3: Fire `transcription_completed` in `commands.rs`**

In `src-tauri/src/commands.rs`, find the `stop_transcription` command. After `whisper_result` is obtained and before the final return, add:

```rust
    crate::analytics::track(settings.analytics_enabled, "transcription_completed", serde_json::json!({
        "model": &settings.active_model,
        "vad_engine": &settings.vad_engine,
        "duration_ms": duration_ms   // use whatever variable holds recording duration
    }));
```

Note: If `stop_transcription` does not already compute `duration_ms`, use `0` as a placeholder — the important fields are `model` and `vad_engine`.

- [ ] **Step 4: Fire `ai_polish_used` in `commands.rs`**

In `src-tauri/src/commands.rs`, find `polish_text_cmd`. After a successful polish result, add:

```rust
    crate::analytics::track(settings.analytics_enabled, "ai_polish_used", serde_json::json!({
        "backend": &settings.ai_backend,
        "style": &settings.active_polish_style
    }));
```

- [ ] **Step 5: Fire `onboarding_completed` in `commands.rs`**

In `src-tauri/src/commands.rs`, find `complete_onboarding`. After the settings save, add:

```rust
    crate::analytics::track(settings.analytics_enabled, "onboarding_completed", serde_json::json!({}));
```

- [ ] **Step 6: Fire `model_downloaded` in `models.rs`**

In `src-tauri/src/whisper/models.rs`, find the `download_model` function. After a successful download and SHA256 verification, add:

```rust
    let s = crate::settings::load_settings_sync();
    crate::analytics::track(s.analytics_enabled, "model_downloaded", serde_json::json!({
        "model_name": model_name
    }));
```

- [ ] **Step 7: Build to confirm no compile errors**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error" | head -20
```

Expected: no output (clean build)

- [ ] **Step 8: Run all tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: `test result: ok. N passed`

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands.rs src-tauri/src/whisper/models.rs
git commit -m "feat(analytics): wire track() calls at all five event sites"
```

---

## Task 4: Sentry Rust — crates, init, error boundaries

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/build.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/whisper/engine.rs`
- Modify: `src-tauri/src/whisper/models.rs`
- Modify: `src-tauri/src/audio/vad.rs`
- Modify: `src-tauri/src/audio/capture.rs`

- [ ] **Step 1: Update `rust-version` in `Cargo.toml`**

`sentry = "0.47"` requires Rust 1.81+. The project currently declares `rust-version = "1.77.2"` in `src-tauri/Cargo.toml`. Update it:

```toml
rust-version = "1.81"
```

Verify your toolchain can satisfy this:

```bash
rustc --version
```

If the version is below 1.81, run `rustup update stable` first.

- [ ] **Step 2: Add crates to `Cargo.toml`**

In `src-tauri/Cargo.toml`, in the `[dependencies]` section, add after the `ndarray` line:

```toml
sentry = { version = "0.47", default-features = false, features = ["backtrace", "contexts", "panic", "reqwest", "rustls"] }
sentry-anyhow = "0.47"
```

- [ ] **Step 3: Update `build.rs` to declare env var dependencies**

Edit `src-tauri/build.rs` (existing file currently containing only `tauri_build::build()`):

```rust
fn main() {
    println!("cargo:rerun-if-env-changed=APTABASE_APP_KEY");
    println!("cargo:rerun-if-env-changed=SENTRY_DSN");
    tauri_build::build()
}
```

- [ ] **Step 4: Add Sentry init to `lib.rs`**

In `src-tauri/src/lib.rs`, add this constant near the top of the file (after the `mod` declarations, before `use` imports):

```rust
const SENTRY_DSN: &str = option_env!("SENTRY_DSN").unwrap_or("");
```

In the `run()` function, add the Sentry guard **as the very first line** (before the `ensure_single_instance()` check so panics during init are also captured). Pass `""` when `crash_reporting_enabled` is false — Sentry treats an empty DSN as no-op mode:

```rust
    let _crash_settings = crate::settings::load_settings_sync();
    let _sentry_dsn = if _crash_settings.crash_reporting_enabled { SENTRY_DSN } else { "" };
    let _sentry_guard = sentry::init((_sentry_dsn, sentry::ClientOptions {
        release: sentry::release_name!(),
        ..Default::default()
    }));
```

- [ ] **Step 5: Add `sentry_anyhow::capture_anyhow` to `engine.rs`**

In `src-tauri/src/whisper/engine.rs`, find where `anyhow::Error` values are returned or logged. Add at each `Err` branch that currently only logs:

```rust
sentry_anyhow::capture_anyhow(&e);
```

Specifically look for the `catch_unwind` result handling and any `Err(e)` that currently calls `tracing::error!`.

- [ ] **Step 6: Add `sentry_anyhow::capture_anyhow` to `models.rs`**

In `src-tauri/src/whisper/models.rs`, find `Err(e)` branches in the download and SHA256 verification functions. Add after each `tracing::error!` call:

```rust
sentry_anyhow::capture_anyhow(&e);
```

- [ ] **Step 7: Add error capture to `vad.rs`**

`vad.rs` uses `ort::Error` (not `anyhow::Error`), so `sentry_anyhow::capture_anyhow` does not apply. Use `sentry::capture_error` instead, which accepts any `std::error::Error`:

In `src-tauri/src/audio/vad.rs`, find `Err(e)` branches in the `process()` / inference function. Add after each `tracing::error!` call:

```rust
sentry::capture_error(&e);
```

- [ ] **Step 8: Add error capture to `capture.rs`**

`capture.rs` uses `cpal::StreamError` in the stream callback (also not `anyhow::Error`). Use `sentry::capture_error`:

In `src-tauri/src/audio/capture.rs`, find error handling in the audio stream callback or device init. Add `sentry::capture_error(&e)` at each `tracing::error!` site.

- [ ] **Step 9: Build to confirm clean compile**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error" | head -20
```

Expected: no output

- [ ] **Step 10: Run all tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: `test result: ok. N passed`

- [ ] **Step 11: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/build.rs src-tauri/src/lib.rs src-tauri/src/whisper/engine.rs src-tauri/src/whisper/models.rs src-tauri/src/audio/vad.rs src-tauri/src/audio/capture.rs
git commit -m "feat(sentry): add Rust crash reporting with opt-out gate"
```

---

## Task 5: Sentry frontend — install and init

**Files:**
- Modify: `package.json`
- Modify: `src/main.tsx`
- Modify: `src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Install `@sentry/react`**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper && npm install @sentry/react
```

Expected: package added to `node_modules` and `package.json`

- [ ] **Step 2: Update `main.tsx` — add Sentry init**

Replace the entire contents of `src/main.tsx` with:

```tsx
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import OverlayWindow from "./components/OverlayWindow";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles/globals.css";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN ?? "";

async function getWindowLabel(): Promise<string> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

getWindowLabel().then(label => {
  const root = document.getElementById("root") as HTMLElement;

  if (label === "overlay") {
    document.documentElement.style.cssText = "background: transparent !important; margin: 0; padding: 0;";
    document.body.style.cssText = "background: transparent !important; margin: 0; padding: 0; height: 100vh; overflow: hidden; display: flex; align-items: center; justify-content: center;";
    ReactDOM.createRoot(root).render(<OverlayWindow />);
    return;
  }

  // Main window: init Sentry before first render.
  // localStorage key is written by Settings.tsx whenever the user changes the toggle.
  // Absent key = first launch = default on.
  const crashEnabled = localStorage.getItem("crash_reporting_enabled") !== "false";
  Sentry.init({
    dsn: crashEnabled ? SENTRY_DSN : "",
    beforeSend(event) {
      delete event.request;
      if (event.breadcrumbs?.values) {
        event.breadcrumbs.values = event.breadcrumbs.values.filter(
          b => b.category !== "navigation" && b.category !== "xhr"
        );
      }
      return event;
    },
  });

  ReactDOM.createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
});
```

- [ ] **Step 3: Wrap `ErrorBoundary` with `Sentry.ErrorBoundary`**

Replace the entire contents of `src/components/ErrorBoundary.tsx` with:

```tsx
import { Component, ReactNode } from "react";
import * as Sentry from "@sentry/react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
}

class OmWhisperErrorFallback extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error) {
    console.error("OmWhisper UI error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: "#0a0f0d" }}
        >
          <div className="text-center max-w-sm px-8">
            <div className="text-4xl mb-4 opacity-30">ॐ</div>
            <h2
              className="text-white/70 font-semibold mb-2"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Something went wrong
            </h2>
            <p
              className="text-white/50 text-sm mb-6 leading-relaxed"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              {this.state.error || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: "" })}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 text-black text-sm font-semibold hover:bg-emerald-400 transition-colors cursor-pointer"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wrap with Sentry.ErrorBoundary so React errors are captured by Sentry.
// The fallback prop preserves the existing branded error UI.
export default function ErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary fallback={({ error }) => (
      <OmWhisperErrorFallback>
        {/* Children are not used in error state; the fallback renders directly */}
        <span />
      </OmWhisperErrorFallback>
    )}>
      <OmWhisperErrorFallback>
        {children}
      </OmWhisperErrorFallback>
    </Sentry.ErrorBoundary>
  );
}
```

**Note on the above:** `Sentry.ErrorBoundary` itself handles catching and reporting to Sentry. The inner `OmWhisperErrorFallback` handles displaying the branded UI. If `Sentry.ErrorBoundary` catches the error first and calls its `fallback`, it renders our branded fallback directly.

Simpler alternative — keep it as two independent layers which is cleaner:

```tsx
import { Component, ReactNode } from "react";
import * as Sentry from "@sentry/react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
}

// Branded fallback UI — unchanged from original
class InnerErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error) {
    console.error("OmWhisper UI error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: "#0a0f0d" }}
        >
          <div className="text-center max-w-sm px-8">
            <div className="text-4xl mb-4 opacity-30">ॐ</div>
            <h2
              className="text-white/70 font-semibold mb-2"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Something went wrong
            </h2>
            <p
              className="text-white/50 text-sm mb-6 leading-relaxed"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              {this.state.error || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: "" })}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 text-black text-sm font-semibold hover:bg-emerald-400 transition-colors cursor-pointer"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Outer Sentry wrapper reports errors, then InnerErrorBoundary shows the branded UI.
export default function ErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary>
      <InnerErrorBoundary>{children}</InnerErrorBoundary>
    </Sentry.ErrorBoundary>
  );
}
```

Use the **simpler alternative** above — Sentry catches and reports, then the inner class boundary shows the branded UI.

- [ ] **Step 4: Build frontend to confirm no TypeScript errors**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper && npm run build 2>&1 | tail -20
```

Expected: `✓ built in` with no errors

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/components/ErrorBoundary.tsx
git commit -m "feat(sentry): add React crash reporting with Sentry.ErrorBoundary"
```

---

## Task 6: TypeScript types + Settings UI with localStorage mirror

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/Settings.tsx`

- [ ] **Step 1: Add fields to `AppSettings` type**

In `src/types/index.ts`, find the `AppSettings` interface and add (following the same pattern as other bool fields):

```ts
  analytics_enabled: boolean;
  crash_reporting_enabled: boolean;
```

- [ ] **Step 2: Add Privacy section to the About tab in `Settings.tsx`**

In `src/components/Settings.tsx`, find the `AboutSection` component. Locate the opening `<div className="card px-5">` inside the About section render. Add a Privacy subsection **before** the Version `SettingRow`:

```tsx
{/* Privacy subsection */}
<div className="py-3" style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
  <h4 className="text-t3 text-[10px] uppercase tracking-widest mb-3 font-mono">Privacy</h4>
  <div>
    <SettingRow
      label="Usage Analytics"
      description="Anonymous feature usage. No audio or text is sent."
    >
      <Toggle
        value={settings.analytics_enabled}
        onChange={(v) => update({ analytics_enabled: v })}
        label="Usage analytics"
      />
    </SettingRow>
    <SettingRow
      label="Crash Reporting"
      description="Sends crash reports to help fix bugs. Takes effect after restart."
    >
      <Toggle
        value={settings.crash_reporting_enabled}
        onChange={(v) => {
          update({ crash_reporting_enabled: v });
          localStorage.setItem("crash_reporting_enabled", String(v));
        }}
        label="Crash reporting"
      />
    </SettingRow>
  </div>
</div>
```

**Note:** `AboutSection` receives `settings` and `update` as props already — no signature change needed.

- [ ] **Step 3: Build frontend**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper && npm run build 2>&1 | tail -10
```

Expected: clean build

- [ ] **Step 4: Run all Rust tests one final time**

```bash
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10
```

Expected: `test result: ok. N passed`

- [ ] **Step 5: Final commit**

```bash
git add src/types/index.ts src/components/Settings.tsx
git commit -m "feat(analytics): add Privacy section to Settings with opt-out toggles"
```

---

## Manual Smoke Tests (document results in PR description)

After running the app with `cargo tauri dev`:

1. **Analytics default on:** Open Settings → About → confirm both Privacy toggles are on.
2. **Crash reporting localStorage:** Toggle "Crash Reporting" off → open browser DevTools → Application → Local Storage → confirm `crash_reporting_enabled = false`.
3. **Analytics opt-out:** Toggle "Usage Analytics" off → start a recording → confirm no Aptabase event in the dashboard (or no network request to `eu.aptabase.com` in proxy).
4. **Contributor build:** Run `cargo build` without `APTABASE_APP_KEY` or `SENTRY_DSN` set → confirm clean build with no compile errors.
