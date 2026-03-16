# Unified Home Tab Design

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Frontend refactor — no backend changes required

---

## Problem

OmWhisper has two tabs that are both incomplete on their own:

- **Home** has stats, shortcuts, mic/model info, and a "What's New" block — but no record button.
- **Transcribe** has the record button, waveform, and live transcript — but no context or history.

OmWhisper is primarily a global hotkey app. Users press ⌘⇧V from another app, speak, and it pastes. They rarely open the window during a recording. Having a dedicated "Transcribe" tab for that rare case creates an empty, purposeless screen most of the time.

---

## Decision

Merge Home and Transcribe into a single **Home** tab. Remove the Transcribe nav item. The unified Home screen is the single action screen: it handles both the idle overview and the live recording state.

---

## Props Interface

```tsx
interface HomeViewProps {
  isRecording: boolean;
  isSmartDictation: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  activeModel: string;
  onNavigate: (view: string) => void;  // required, not optional
}
```

---

## Design

### Idle State

From top to bottom:

1. **Record button** — 72px circular gradient button, centered. Below it: hint text `⌘⇧V to dictate anywhere · ⌘⇧B for AI polish`.
2. **Stats strip** — 4-column compact row: Today (recordings count), Words, Streak, Total time.
3. **Active Setup row** — Two clickable cells side by side: mic name (→ `onNavigate("settings:audio")`) and active model (→ `onNavigate("models")`). Chevron-on-hover behaviour preserved. Mic name falls back to `"Default Microphone"` when `settings.audio_input_device` is null or empty.
4. **Recent recordings** — Card with header "Recent" + "See all →" link (`onNavigate("history")`). Shows last 2 transcriptions via `invoke("get_transcription_history", { limit: 2, offset: 0 })`. Fewer than 2 results render only available items — no placeholder rows. Hidden entirely when 0 results.

### Recording State

When `isRecording` becomes `true`:

1. **Stop button** replaces the record button — neumorphic inset style with red ping animation (for standard), violet for Smart Dictation.
2. **Waveform meter + status row** — `WaveformMeter` is a controlled component that receives `level: number` as a prop. HomeView listens to `"audio-level"` event and passes value to `WaveformMeter`. Status label: `"Listening…"` or `"Smart Dictation…"`. Elapsed timer beside it.
3. **Live transcript panel** — replaces the Recent block while recording. Scrollable segment list with timestamps, red/violet pulsing dot in header. Panel header shows segment count. Segments state resets to `[]` when `onStartRecording` is called.
4. **Stats strip + Active Setup row** remain visible below throughout recording.

### Post-recording State

After `isRecording` transitions from `true` to `false`:

- Stop button reverts to record button.
- The live transcript panel remains visible for **5 seconds**, then disappears and the Recent block re-renders.
- If a new recording starts before the 5-second timer fires, the timer is cancelled, segments clear immediately, and the live transcript panel continues.
- The `"transcription-complete"` event is handled in `App.tsx` (no change). HomeView should additionally listen for `"transcription-complete"` to: (1) stop the pulsing red dot in the transcript panel header, and (2) update the status line to `"Recording complete — pasted to your app"`.
- Stats strip is re-fetched (`get_usage_stats`) when `isRecording` transitions from `true` to `false`, so the Today count reflects the new recording without a page refresh.
- Recent recordings are re-fetched when the 5-second post-recording timer fires (so the new entry appears in the list).

---

## What Changes

| Change | Type | Detail |
|--------|------|--------|
| `TranscribeView.tsx` | Remove | Component deleted; logic absorbed into HomeView |
| Transcribe nav item | Remove | `Sidebar.tsx` `NAV_ITEMS` drops `"transcribe"` entry (6 → 5 items) |
| `"What's New"` block | Remove | Gets stale immediately; not useful after first launch |
| Keyboard shortcuts section | Remove | Replaced by hint text under record button |
| Record button + waveform + live segments | Move | From TranscribeView into HomeView |
| `isRecording`, `isSmartDictation`, `onStartRecording`, `onStopRecording` | Move | HomeView now receives these from App.tsx |
| `transcription-update`, `audio-level` listeners | Move | HomeView listens internally |
| Recent recordings preview | New | `invoke("get_transcription_history", { limit: 2, offset: 0 })` |
| Stats refresh on stop | New | Re-fetch `get_usage_stats` when `isRecording` goes `true → false` |
| App.tsx render switch | Update | Remove `activeView === "transcribe"` branch; pass recording props to HomeView |
| `activeView === "transcribe"` fallback | Update | App.tsx treats any persisted or emitted `"transcribe"` view as `"home"` |

---

## Data Flow

```
App.tsx
  ├── isRecording, isSmartDictation                    (state)
  ├── startRecording(), stopRecording()                (callbacks)
  └── HomeView
        ├── props: isRecording, isSmartDictation,
        │         onStartRecording, onStopRecording,
        │         activeModel, onNavigate
        ├── internal state: segments, audioLevel,
        │                   stats, micName, recentItems
        ├── listen("transcription-update") → append to segments
        ├── listen("audio-level")          → audioLevel
        ├── listen("transcription-complete") → stop pulsing dot, update status
        ├── invoke("get_usage_stats")       → stats (on mount + on stop)
        ├── invoke("get_settings")          → micName (on mount + settings-changed)
        └── invoke("get_history", { limit: 2, offset: 0 })
                                            → recentItems (on mount + after post-recording timer)
```

---

## What Does NOT Change

- All Tauri backend commands remain unchanged.
- Recording logic in `App.tsx` (start/stop/paste/smart dictation) is untouched.
- `transcription-complete` paste logic stays entirely in `App.tsx`.
- History, Models, Vocabulary, Settings tabs are unaffected.
- The overlay window, hotkeys, tray, and all event emission are unaffected.
- `TranscriptionHistory.tsx` is kept — History tab still exists as a full view.
- `WaveformMeter` function component is moved into `HomeView.tsx` (or kept as an inlined helper in the same file).

---

## Files Affected

| File | Action |
|------|--------|
| `src/components/HomeView.tsx` | Rewrite — absorbs TranscribeView functionality |
| `src/components/TranscribeView.tsx` | Delete |
| `src/components/Sidebar.tsx` | Remove `"transcribe"` from `NAV_ITEMS` |
| `src/App.tsx` | Remove TranscribeView import/render; pass recording props to HomeView; treat `"transcribe"` view as `"home"` |
