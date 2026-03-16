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
if smartDictation → polish with active style → paste → save(source: "smart_dictation", rawText, polishStyle)
else → paste raw → save(source: "regular")
```

New logic:
```
if smartDictation → polish with active style → paste → save(source: "smart_dictation", rawText, polishStyle)
else if apply_polish_to_regular → polish with "professional" → paste → save(source: "regular_polished", rawText, polishStyle: "professional")
  [on error] → toast("AI not ready — pasting raw text") → paste raw → save(source: "regular")
else → paste raw → save(source: "regular")
```

**Fallback behavior:** All `polish_text_cmd` errors — including `llm_not_ready` — must fall back to raw paste for regular recording. This differs intentionally from Smart Dictation, where `llm_not_ready` drops the paste entirely (Smart Dictation has no value without AI). For regular recording, the raw transcription is still useful, so it must always paste.

Specifically:
1. Show toast: `"AI not ready — pasting raw text"`
2. Call `paste_transcription(rawText)` with the original unpolished text
3. Save with `source: "regular"` (not `"regular_polished"`)

The `pendingIsSmartDictation` ref stays unchanged. The new flag is read from the settings object already loaded in App.tsx state.

---

## Visual Indicator (OverlayWindow.tsx)

When `apply_polish_to_regular` is on and a regular ⌘⇧V recording is active, the overlay shows:
- A `<Sparkles>` icon badge (same lucide-react icon used by Smart Dictation)
- Label: **"AI Polish"** in small text below the recording dot
- Color: **teal/emerald** (the app's primary color, `#34d399`) — distinct from Smart Dictation's **violet**

This preserves the visual language: violet = Smart Dictation, teal sparkle = regular + AI polish.

**Data flow:** `OverlayWindow.tsx` has an existing `recording-state` listener that, when it fires `true`, calls `invoke("get_settings")` to refresh `overlay_style`. `apply_polish_to_regular` should be read from that same `get_settings` call, inside the existing `recording-state: true` branch. No new listeners, no Rust payload changes needed.

---

## Settings UI (AiModelsView.tsx — Smart Dictation sub-tab)

New toggle row added in the **Smart Dictation sub-tab** of `AiModelsView.tsx`, after the entire active style + translate language block (i.e., after the conditional translate language picker). Place it after the last item in that group, before the Timeout row.

**Label:** Apply AI polish to regular recording
**Sub-text:** ⌘⇧V recordings are polished using the Professional style before pasting. Falls back to raw paste if AI is unavailable.

**Disabled state:** Toggle is grayed out (non-interactive) when `settings.ai_backend === "disabled"`. A hint appears: *"Enable an AI backend above to use this feature."*

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/settings.rs` | Add `apply_polish_to_regular: bool` field, default `false` |
| `src/types/index.ts` | Add `apply_polish_to_regular: boolean` to `AppSettings` interface |
| `src/App.tsx` | Add second polish branch in `transcription-complete` handler with fallback toast and correct `save_transcription` arguments |
| `src/components/OverlayWindow.tsx` | Read `apply_polish_to_regular` from `get_settings` on `hotkey-toggle-recording`, render teal sparkle badge when true |
| `src/components/AiModelsView.tsx` | Add toggle row in Smart Dictation sub-tab, after active style dropdown |

---

## Out of Scope

- Per-style configuration for regular recording (always "professional")
- Separate hotkey for polish-enabled regular recording
- Translation via regular recording toggle (translate style not supported in built-in backend)
- Any changes to Smart Dictation behavior
