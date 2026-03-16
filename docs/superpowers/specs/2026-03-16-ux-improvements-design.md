# UX Improvements Design

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Frontend only — no backend changes required (except debug-mode flag)

---

## Problem

Nine targeted UX issues across the app reduce usability, discoverability, and clarity for new and returning users. These are independent, low-risk improvements with no architectural dependencies between them.

---

## Changes by Component

### 1. Home — Pure Recording Focus

**Problem:** The Home screen shows a 4-stat strip (today's count, total words, streak, total time) and the last 2 recent transcriptions below the record button. This competes for attention with the core job of the screen: recording. Additionally, the live transcript auto-hides after 5 seconds — exactly when the user most wants to read it.

**Changes:**
- Remove the inline stats grid (4-column grid, implemented directly in `HomeView.tsx` — not a separate component) entirely, along with the `stats` state, `loadStats` function, and all calls to `loadStats` (including the mount call and the post-recording call inside the 5-second timer `useEffect`)
- Remove the "recent 2" transcriptions section from `HomeView.tsx`, along with the `recentItems` state, `loadRecent` function, and all calls to `loadRecent` — including any call inside the Clear button's `onClick` handler (strip it down to just clearing `segments`)
- Change the transcript clear behaviour: instead of a 5-second `setTimeout`, clear `segments` (and hide the transcript panel) only when a new recording starts (i.e., on `startRecording`). Remove the `postRecordingTimerRef`, the `setTimeout`, and the cleanup `useEffect` for that timer entirely.
- The "Clear" button remains for manual dismissal (its `onClick` clears `segments` only — `loadRecent` call removed as above)

**Result:** Home is the record button, waveform meter, and live transcript. Nothing else.

---

### 2. History — Multi-Select Batch Delete

**Problem:** Users can only act on one transcription at a time. "Clear All" is too destructive. There is no middle ground for selectively cleaning up old entries.

**Changes in `TranscriptionHistory.tsx`:**
- Add a `selecting` boolean state (default `false`)
- Add a `selected` Set\<number\> state (entry IDs)
- Add a **"Select"** button in the History header (top-right, beside search). When clicked, sets `selecting = true`
- When `selecting`:
  - Each entry row shows a checkbox (left side). Clicking the row toggles selection instead of expanding
  - A sticky action bar appears at the bottom: **"X selected · Delete selected"** button + **"Cancel"** button
  - "Cancel" sets `selecting = false` and clears `selected`
  - "Delete selected" calls `invoke("cmd_delete_transcription", { id })` for each selected ID sequentially, then sets `selecting = false`, clears `selected`, refreshes list
- When not selecting, existing expand/collapse behaviour is unchanged

**No new Tauri commands needed** — reuses existing `cmd_delete_transcription`.

---

### 3. AI Models — Cloud API Model Preset Dropdown

**Problem:** The Cloud API section requires users to manually type the exact model ID. No suggestions, no validation until "Test Connection" is hit.

**Change in `AiModelsView.tsx` (`SmartDictationTab`):**

Replace the free-text `<input>` for `ai_cloud_model` with a `<select>` that shows preset models for the active provider, plus a "Custom…" option that reveals a text input.

Model presets per provider:
- **OpenAI:** `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`
- **Groq:** `llama3-8b-8192`, `llama3-70b-8192`, `mixtral-8x7b-32768`, `gemma-7b-it`
- **Custom:** free-text input (existing behaviour)

Implementation:
- Derive active provider from `settings.ai_cloud_api_url` (same logic already used for the Provider `<select>`)
- The existing Provider `<select>` `onChange` handler already resets `ai_cloud_model` when switching providers (OpenAI → `gpt-4o-mini`, Groq → `llama3-8b-8192`, Custom → current value). This behaviour is preserved. The new model `<select>` reads its value from `settings.ai_cloud_model` — it stays in sync automatically because `update()` writes through to settings state.
- When user selects "Custom…" from the model dropdown, show the free-text input below the dropdown. The "Custom…" option value should be a sentinel (e.g., `"__custom__"`) distinct from any real model name.
- The custom model value is stored as-is in settings

---

### 4. Vocabulary — Inline Edit

**Problem:** Fixing a typo in a custom word or replacement requires deleting and re-adding it. There is no edit-in-place.

**Changes in `Vocabulary.tsx`:**

**Custom Words chips:**
- Add `editingWord: string | null` state (the word currently being edited)
- Clicking a chip sets `editingWord = word` — the chip re-renders as a small `<input>` pre-filled with the word
- Pressing Enter: calls `invoke("remove_vocabulary_word", { word: old })` then `invoke("add_vocabulary_word", { word: new })`, clears `editingWord`
- Pressing Esc: clears `editingWord` (no change)
- Clicking outside (onBlur): same as Esc

**Replacements rows:**
- Add `editingReplacement: string | null` state (the `from` value of the row being edited)
- Clicking a row's `from` or `to` text sets `editingReplacement = from` — both `from` and `to` cells become `<input>` fields
- Pressing Enter: calls `remove_word_replacement(old_from)` then `add_word_replacement(new_from, new_to)`, clears `editingReplacement`
- Pressing Esc: clears `editingReplacement`

---

### 5. Home — Vocabulary Empty-State Nudge

**Problem:** Most users never visit Vocabulary. The feature is invisible until they stumble upon it.

**Change in `HomeView.tsx`:**
- On mount, invoke `get_vocabulary` (returns `{ words: string[], replacements: Record<string, string> }`) and check if `words.length === 0 && Object.keys(replacements).length === 0`
- If both are empty, render a small dismissible nudge below the record button (above the empty state if no recent transcriptions):

```
┌─────────────────────────────────────────────────┐
│  Whisper keeps mishearing a word?               │
│  Add it to Vocabulary for better accuracy  →    │
└─────────────────────────────────────────────────┘
```

- Clicking the nudge calls `onNavigate("vocabulary")`
- A dismiss button (✕) hides the nudge for the session (no persistence — it reappears next launch until vocabulary has at least one entry)
- The nudge does NOT appear while recording or while a live transcript is visible

---

### 6. Settings — Move Log Level to About Tab

**Problem:** "Log Level" (Normal / Debug) is a developer diagnostic control sitting in Settings → General alongside user-facing settings like theme and launch-at-login. Regular users will never use it.

**Changes:**
- In `Settings.tsx`, remove the `SettingRow` for `log_level` from the **General** tab
- Add it to the **About** tab, above the "Copy Debug Info" button, with label "Log Level" and description "Increase for troubleshooting" (the existing description "Verbosity of log file" also changes to this new text)

---

### 7. Sidebar — Free Tier Label Clarity

**Problem:** The usage bar shows "Free today" which doesn't tell users when the limit resets.

**Change in `Sidebar.tsx`:**

The current expanded layout is a single-line flex row with two `<span>` elements: `"Free today"` (left) and `"Xm Ys"` (right). Replace both spans with a single span containing the combined text:

```
28m 12s left · resets at midnight
```

Implementation: replace the `<div className="flex justify-between ...">` with the two spans with a single `<span>` formatted as `` `${Math.floor(remaining / 60)}m ${remaining % 60}s left · resets at midnight` ``. The amber/red colour thresholds remain unchanged. This change only affects the **expanded** sidebar (`isOpen = true`) label — the collapsed sidebar shows only the Sparkles icon and is unaffected.

---

### 8. Debug Mode — Bypass License Checks

**Problem:** During development, all gated features (export, model access, etc.) require a valid license to test. This slows down development iteration.

**Change in `src-tauri/src/lib.rs` or `commands.rs`:**
- In debug builds (`#[cfg(debug_assertions)]`), the `get_license_status` command returns `"Licensed"` unconditionally
- This means all frontend license checks pass in debug without needing to activate a real license
- No change to production behaviour

---

## Files Affected

| File | Changes |
|------|---------|
| `src/components/HomeView.tsx` | Remove StatsCard + recent-2; change transcript clear to on-new-recording; add vocabulary nudge |
| `src/components/TranscriptionHistory.tsx` | Add multi-select mode with batch delete |
| `src/components/AiModelsView.tsx` | Replace cloud model text input with preset dropdown + Custom fallback |
| `src/components/Vocabulary.tsx` | Add inline edit for words and replacements |
| `src/components/Settings.tsx` | Move Log Level row from General to About |
| `src/components/Sidebar.tsx` | Update free tier label to "Xm Ys left · resets at midnight" |
| `src-tauri/src/commands.rs` | Add `#[cfg(debug_assertions)]` bypass to `get_license_status` |

---

## What Does NOT Change

- All Tauri backend commands unchanged (except debug bypass in `get_license_status`)
- History search, pagination, copy, export — unchanged
- Vocabulary add/remove logic — unchanged (inline edit reuses existing commands)
- AI Models Whisper tab — unchanged
- Settings General / Audio / Transcription / Shortcuts tabs — unchanged (except Log Level removal from General)
- Sidebar nav items, collapse behaviour, PRO badge — unchanged
- Export gating — deferred (monetization strategy TBD)
