# Analytics & Crash Reporting — Design Spec

**Date:** 2026-03-17
**Status:** Approved

---

## Overview

Integrate Aptabase for anonymous usage analytics and Sentry for crash reporting. Both are on by default with opt-out toggles in Settings → About. No audio, transcription text, or PII is ever sent.

---

## Architecture

Two independent integrations sharing a single opt-out mechanism via `settings.rs`.

---

### Aptabase (Analytics)

**Approach:** Direct HTTP ingest via existing `reqwest` dependency — no Tauri plugin required. (`aptabase-tauri` is not compatible with Tauri 2 and is not published as an official Tauri plugin.)

Aptabase exposes a simple REST endpoint:

```
POST https://eu.aptabase.com/api/v0/events
App-Key: <APP_KEY>
Content-Type: application/json

{
  "events": [{
    "timestamp": "2026-03-17T10:00:00Z",
    "sessionId": "<uuid-per-launch>",
    "eventName": "recording_started",
    "props": { "mode": "toggle" },
    "systemProps": { "appVersion": "0.1.0", "osName": "macOS", "osVersion": "15.0" }
  }]
}
```

**New file:** `src-tauri/src/analytics.rs`

- Holds a `session_id: Uuid` generated once at process start
- Exposes a single `track(app: &AppHandle, name: &str, props: serde_json::Value)` function
- Reads `analytics_enabled` from the caller-provided `bool` (passed from command context — no per-call disk read)
- Fires a `tokio::spawn` for the reqwest POST so it never blocks the calling thread
- Fails silently: network errors are logged at `debug` level and dropped

**App key:** Embedded as a compile-time constant `const APTABASE_APP_KEY: &str = option_env!("APTABASE_APP_KEY").unwrap_or("")`. Injected via CI environment variable; for local dev, set in the shell environment before running `cargo tauri dev`. When the var is absent (contributor builds), the constant is `""` and events are dropped silently — Aptabase rejects requests with an empty key.

**Events tracked:**

| Event | Properties | Fired from |
|---|---|---|
| `app_launched` | `version`, `platform` | `lib.rs` setup |
| `recording_started` | `mode` (toggle / ptt / smart_dictation) | `commands.rs` `start_transcription` |
| `transcription_completed` | `model`, `duration_ms`, `vad_engine` | `commands.rs` `stop_transcription` |
| `model_downloaded` | `model_name` | `whisper/models.rs` |
| `ai_polish_used` | `backend`, `style` | `commands.rs` `polish_text_cmd` |
| `onboarding_completed` | — | `commands.rs` `complete_onboarding` |

`word_count` is intentionally excluded — even as a derived integer it could correlate with transcription content, which conflicts with the "no transcription data" promise.

No event carries audio data, transcription text, file paths, usernames, or device identifiers.

---

### Sentry (Crash Reporting)

**Rust crates:** `sentry = "0.47"` + `sentry-anyhow = "0.47"` (separate crate; `sentry` itself has no `anyhow` feature)
**Frontend package:** `@sentry/react`

#### Rust side

Sentry is initialized at the very top of `run()` in `lib.rs`, before the Tauri builder is constructed. Settings are loaded synchronously via the existing `load_settings_sync()` at this point — no async race exists on the Rust side.

```rust
let settings = load_settings_sync();
let dsn = if settings.crash_reporting_enabled { SENTRY_DSN } else { "" };
let _sentry_guard = sentry::init((dsn, sentry::ClientOptions {
    release: sentry::release_name!(),
    ..Default::default()
}));
```

The guard is bound to the stack of `run()` — it lives for the entire process lifetime without needing to be stored in `AppState`. Passing `""` as DSN puts Sentry in no-op mode with zero network activity.

Explicit capture at key error boundaries using `sentry_anyhow::capture_anyhow(&e)`:
- Whisper engine errors in `engine.rs`
- VAD inference errors in `vad.rs`
- Audio capture errors in `capture.rs`
- Model download errors in `models.rs`

**DSN delivery:** `const SENTRY_DSN: &str = option_env!("SENTRY_DSN").unwrap_or("")` — same pattern as Aptabase key. Passing `""` to `sentry::init` with no DSN puts Sentry in no-op mode, so contributor builds work without secrets. The DSN being public is acceptable Sentry practice (it can only receive events, not read them).

**System metadata:** Sentry's default integrations attach OS name/version and architecture. This is not PII and is acceptable for crash diagnosis. No additional stripping is needed for the Rust SDK.

#### Frontend side

**Async race fix:** Rather than awaiting `get_settings` before `Sentry.init` (which would leave early render errors in a gap), the opt-out preference is mirrored to `localStorage` whenever the setting changes. On startup, `main.tsx` reads `localStorage.getItem("crash_reporting_enabled")` synchronously before calling `Sentry.init` — no async IPC call needed.

`localStorage` is updated by the `update()` function in `Settings.tsx` whenever `crash_reporting_enabled` changes. On first launch (key absent), Sentry initializes with the DSN (default on).

The current `main.tsx` uses `getWindowLabel().then(label => { ... })` to route windows. Sentry init is placed at the **top of the `.then()` callback, before the `if (label === "overlay")` branch**, so it runs for the main window only and before `ReactDOM.createRoot`:

```ts
getWindowLabel().then(label => {
  // Sentry init — main window only, before any render
  if (label !== "overlay") {
    const crashEnabled = localStorage.getItem("crash_reporting_enabled") !== "false";
    Sentry.init({
      dsn: crashEnabled ? SENTRY_DSN : "",
      beforeSend(event) {
        // Strip breadcrumbs that could contain file paths or URLs
        delete event.request;
        if (event.breadcrumbs?.values) {
          event.breadcrumbs.values = event.breadcrumbs.values.filter(
            b => b.category !== "navigation" && b.category !== "xhr"
          );
        }
        return event;
      },
    });
  }

  const root = document.getElementById("root")!;
  if (label === "overlay") {
    ReactDOM.createRoot(root).render(<OverlayWindow />);
  } else {
    ReactDOM.createRoot(root).render(<App />);
  }
});
```

No `integrations` array is specified — the app uses no React Router, so `browserTracingIntegration` provides no value. Default integrations (error capture, breadcrumbs) are sufficient.

**ErrorBoundary:** `ErrorBoundary.tsx` is wrapped with `Sentry.ErrorBoundary`, using the **existing branded fallback UI** as the `fallback` prop. The custom fallback (ॐ glyph, dark background, "Try Again" button) is preserved — only the outer component changes.

**Restart note:** Toggling `crash_reporting_enabled` off takes effect on next app launch (Sentry's panic hook cannot be unregistered at runtime). The Settings UI toggle carries a "(takes effect after restart)" label.

---

## Settings

Two new fields in `settings.rs`:

```rust
#[serde(default = "default_true")]
pub analytics_enabled: bool,

#[serde(default = "default_true")]
pub crash_reporting_enabled: bool,
```

Both use the existing `default_true()` helper. Default is `true` for fresh installs and for existing `settings.json` files that lack the field (serde default).

---

## Settings UI

New "Privacy" subsection at the top of the About tab in `Settings.tsx`, above the Version row:

```
Privacy
────────────────────────────────────────────────
Usage Analytics                        [toggle]
Anonymous feature usage. No audio or
transcription text is ever sent.

Crash Reporting                        [toggle]
Sends crash reports to help fix bugs.
Takes effect after restart.
────────────────────────────────────────────────
```

Both toggles call `update({ analytics_enabled: v })` / `update({ crash_reporting_enabled: v })` and also write to `localStorage` immediately.

---

## File Changes

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `sentry = "0.47"`, `sentry-anyhow = "0.47"` |
| `src-tauri/build.rs` | **Edit existing file** (currently just `tauri_build::build()`) — add two `println!("cargo:rerun-if-env-changed=...")` lines before the existing call so incremental builds invalidate when secrets change |
| `src-tauri/src/analytics.rs` | New — `track()` taking `enabled: bool` and spawning reqwest POST |
| `src-tauri/src/lib.rs` | Init Sentry guard, fire `app_launched` event |
| `src-tauri/src/settings.rs` | Add `analytics_enabled`, `crash_reporting_enabled` fields |
| `src-tauri/src/commands.rs` | Add `analytics::track()` calls at recording / transcription / polish / onboarding |
| `src-tauri/src/whisper/models.rs` | Add `analytics::track()` on successful download; `sentry_anyhow::capture_anyhow` on error |
| `src-tauri/src/whisper/engine.rs` | Add `sentry_anyhow::capture_anyhow` on Whisper errors |
| `src-tauri/src/audio/vad.rs` | Add `sentry_anyhow::capture_anyhow` on inference errors |
| `src-tauri/src/audio/capture.rs` | Add `sentry_anyhow::capture_anyhow` on capture errors |
| `package.json` | Add `@sentry/react` |
| `src/main.tsx` | Init Sentry from localStorage flag before render; skip for overlay window |
| `src/components/ErrorBoundary.tsx` | Wrap with `Sentry.ErrorBoundary`, pass existing fallback as `fallback` prop |
| `src/components/Settings.tsx` | Add Privacy subsection to About tab; write to localStorage on change |

`capabilities/default.json` requires **no change** — outbound HTTP via `reqwest` in Rust uses the existing network capability; no new Tauri plugin permissions are needed.

---

## Error Handling

- Aptabase POST failures are logged at `debug` level and silently dropped — never surface to the user.
- Sentry initialization failure is non-fatal — the app continues normally.
- If `APTABASE_APP_KEY` or `SENTRY_DSN` env vars are unset at build time, `option_env!()` returns `""` and both SDKs run in no-op mode — contributor builds work without any secrets configured.

---

## Testing

**Rust unit tests (`analytics.rs`):**
- `track_is_noop_when_disabled`: call `track(false, ...)` and assert no HTTP request is made (mock with a local test server or assert the spawn future is not created).
- Settings serde: verify `analytics_enabled` and `crash_reporting_enabled` default to `true` when absent from JSON.

**Manual smoke tests (documented in PR description):**
- Toggle crash reporting off, force a React render error, confirm no event in Sentry dashboard.
- Toggle analytics off, trigger a recording, confirm no event in Aptabase dashboard.
- Re-enable both, verify events appear.
