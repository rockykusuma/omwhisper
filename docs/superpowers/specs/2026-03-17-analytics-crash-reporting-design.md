# Analytics & Crash Reporting — Design Spec

**Date:** 2026-03-17
**Status:** Approved

---

## Overview

Integrate Aptabase for anonymous usage analytics and Sentry for crash reporting. Both are on by default with opt-out toggles in Settings → About. No audio, transcription text, or PII is ever sent.

---

## Architecture

Two independent integrations sharing a single opt-out mechanism via `settings.rs`.

### Aptabase (Analytics)

**Crate/package:** `tauri-plugin-aptabase` (official Tauri 2 plugin)

The plugin exposes `trackEvent` to both Rust and the JS frontend. A thin `analytics.rs` wrapper checks `settings.analytics_enabled` before forwarding calls to the plugin — this means every callsite is a one-liner and the opt-out is enforced in one place.

**New file:** `src-tauri/src/analytics.rs`

```rust
// Example interface
pub fn track(app: &AppHandle, name: &str, props: Option<serde_json::Value>) {
    let settings = load_settings_sync();
    if !settings.analytics_enabled { return; }
    let _ = app.aptabase().track_event(name, props);
}
```

Events are fired from Rust callsites (commands.rs, lib.rs) for backend events and from the React frontend via the plugin's JS `trackEvent` binding for UI events.

**Events tracked:**

| Event | Properties | Fired from |
|---|---|---|
| `app_launched` | `version`, `platform` | `lib.rs` setup |
| `recording_started` | `mode` (toggle/ptt/smart_dictation) | `commands.rs` `start_transcription` |
| `transcription_completed` | `model`, `duration_ms`, `word_count`, `vad_engine` | `commands.rs` `stop_transcription` |
| `model_downloaded` | `model_name` | `whisper/models.rs` |
| `ai_polish_used` | `backend`, `style` | `commands.rs` `polish_text_cmd` |
| `onboarding_completed` | — | `commands.rs` `complete_onboarding` |

No event carries audio data, transcription text, file paths, usernames, or device identifiers beyond what Aptabase collects by default (anonymous session ID).

### Sentry (Crash Reporting)

**Rust crate:** `sentry` with `anyhow` feature
**Frontend package:** `@sentry/react`

**Rust:** Sentry is initialized early in `lib.rs` (before the Tauri builder runs). It captures:
- Panics via the default panic integration
- Explicit `sentry::capture_anyhow(&e)` calls at key error boundaries: Whisper engine, VAD inference, audio capture, model download

The Sentry guard returned by `sentry::init()` is stored in `AppState` to keep it alive for the process lifetime.

Gated by `crash_reporting_enabled`: the DSN is passed as `""` (empty) when disabled, which causes Sentry to initialize in no-op mode — no network calls, no performance overhead.

**Frontend:** `Sentry.init()` called in `main.tsx` before React renders. The existing `ErrorBoundary` component is replaced with `Sentry.ErrorBoundary` (which wraps the same fallback UI). The React integration captures unhandled JS errors and React render errors.

Same gate: `get_settings` is called at startup and `Sentry.init` is called with `dsn: ""` when `crash_reporting_enabled` is false.

**No PII in Sentry payloads:** `beforeSend` hook strips `request.url`, `user`, and any breadcrumb data containing file paths before events are sent.

---

## Settings

Two new fields added to `Settings` struct in `settings.rs`:

```rust
#[serde(default = "default_true")]
pub analytics_enabled: bool,

#[serde(default = "default_true")]
pub crash_reporting_enabled: bool,
```

Both default to `true` via the existing `default_true()` helper.

**UI:** New "Privacy" subsection added to the existing About tab in `Settings.tsx`, above the Version row:

```
Privacy
─────────────────────────────────────────────────
Usage Analytics          [toggle — default on]
Anonymous feature usage. No audio or text is sent.

Crash Reporting          [toggle — default on]
Sends crash reports to help fix bugs.
─────────────────────────────────────────────────
```

---

## File Changes

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-aptabase`, `sentry` with `anyhow` feature |
| `src-tauri/src/analytics.rs` | New — `track()` wrapper checking opt-out flag |
| `src-tauri/src/lib.rs` | Init Sentry guard, register aptabase plugin, fire `app_launched` |
| `src-tauri/src/settings.rs` | Add `analytics_enabled`, `crash_reporting_enabled` fields |
| `src-tauri/src/commands.rs` | Add `analytics::track()` calls at recording/transcription/polish/onboarding events |
| `src-tauri/src/whisper/models.rs` | Add `analytics::track()` on successful download |
| `package.json` | Add `@sentry/react` |
| `src/main.tsx` | Init Sentry, gate on settings |
| `src/components/ErrorBoundary.tsx` | Replace with `Sentry.ErrorBoundary` wrapper |
| `src/components/Settings.tsx` | Add Privacy subsection to About tab |

---

## Error Handling

- If Aptabase plugin fails to send (no network, rate limit), it fails silently — `track()` wraps the call in `let _ =`.
- Sentry initialization failure is non-fatal — the app continues normally.
- Toggling either setting takes effect immediately for future events; in-flight Sentry events are not cancelled.

---

## Testing

- Unit tests in `analytics.rs`: verify `track()` is a no-op when `analytics_enabled = false`.
- Settings serialization test: verify `analytics_enabled` and `crash_reporting_enabled` default to `true` when missing from JSON.
- No integration tests for actual Aptabase/Sentry network calls.
