# AI Polish for Regular Recording — Design Spec

**Date:** 2026-03-17
**Branch:** feature/ui-upgradation
**Status:** Approved

---

## Goal

Add a Settings toggle that applies LLM polishing (Professional style) to regular ⌘⇧V recordings, not just Smart Dictation (⌘⇧B). When enabled, transcribed text is polished before pasting, with a visual indicator during recording and a graceful fallback to raw paste if AI is unavailable.

---

## Architecture

Three targeted changes — no new Tauri commands, no new files:

1. **New setting** — `apply_polish_to_regular: bool` (default `false`) in Rust `settings.rs` and TypeScript `types/index.ts`
2. **Recording flow** — `transcription-complete` handler in `App.tsx` gains a second polish path
3. **Visual indicator** — `OverlayWindow.tsx` shows a teal sparkle badge when toggle is on and regular recording is active

Reuses the existing `polish_text_cmd` Tauri command with `style = "professional"`.

---

## Recording Flow (App.tsx)

Current `transcription-complete` logic:
```
if smartDictation → polish with active style → paste
else → paste raw
```

New logic:
```
if smartDictation → polish with active style → paste
else if apply_polish_to_regular → polish with "professional" → paste (with fallback)
else → paste raw
```

**Fallback behavior:** If `polish_text_cmd` throws (e.g., `llm_not_ready`, network error):
1. Show toast: `"AI not ready — pasting raw text"`
2. Call `paste_transcription(rawText)` with the original unpolished text

The `pendingIsSmartDictation` ref stays unchanged. The new flag is read from the settings object already loaded in App.tsx state.

---

## Visual Indicator (OverlayWindow.tsx)

When `apply_polish_to_regular` is on and a regular ⌘⇧V recording is active, the overlay shows:
- A `<Sparkles>` icon badge (same lucide-react icon used by Smart Dictation)
- Label: **"AI Polish"** in small text below the recording dot
- Color: **teal/emerald** (the app's primary color, `#34d399`) — distinct from Smart Dictation's **violet**

This preserves the visual language: violet = Smart Dictation, teal sparkle = regular + AI polish.

**Data flow:** The `apply_polish_to_regular` setting is emitted as part of the `recording-state` event payload when recording starts, so `OverlayWindow.tsx` receives it without needing to fetch settings independently.

---

## Settings UI (Settings.tsx — AI Tab)

New toggle row added in the AI tab, after the active style dropdown, before the translate language picker:

**Label:** Apply AI polish to regular recording
**Sub-text:** ⌘⇧V recordings are polished using the Professional style before pasting. Falls back to raw paste if AI is unavailable.

**Disabled state:** Toggle is grayed out (non-interactive) when `ai_backend === "disabled"`. A hint appears: *"Enable an AI backend above to use this feature."*

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/settings.rs` | Add `apply_polish_to_regular: bool` field, default `false` |
| `src/types/index.ts` | Add `apply_polish_to_regular: boolean` to `AppSettings` interface |
| `src/App.tsx` | Add second polish branch in `transcription-complete` handler with fallback toast |
| `src/components/OverlayWindow.tsx` | Accept `applyPolishRegular` prop/event, render teal sparkle badge |
| `src/components/Settings.tsx` | Add toggle row in AI tab |

---

## Out of Scope

- Per-style configuration for regular recording (always "professional")
- Separate hotkey for polish-enabled regular recording
- Translation via regular recording toggle (translate style not supported in built-in backend)
- Any changes to Smart Dictation behavior
