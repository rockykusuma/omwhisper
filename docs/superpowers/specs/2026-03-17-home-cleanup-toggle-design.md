# Home Screen AI Cleanup Toggle — Design Spec

## Goal

Add a ✨ Cleanup toggle to the home screen so users can enable AI polish on every regular ⌘⇧V recording without opening any settings panel. The toggle is off by default; when on, every completed recording is silently cleaned up by the bundled qwen2.5 model before pasting.

## Context

Smart Dictation (⌘⇧B) already applies AI polish. Regular dictation (⌘⇧V) optionally does the same via the `apply_polish_to_regular` setting, but that setting is buried in the AI settings tab. This feature surfaces the toggle on the home screen and wires it to a new CLEANUP style that is better suited to voice-to-text cleanup than the existing Professional style.

The qwen2.5 model is the default built-in model (`qwen2.5-0.5b-instruct-q4_k_m.gguf`). It must be downloaded before first use. The toggle must use it regardless of the `ai_backend` setting (which controls the Smart Dictation backend and may be set to `"disabled"`). If the model has not been downloaded or the LlmEngine is not ready, the toggle gracefully falls back to raw paste.

## Design Decisions

### UI: Third cell in the mic/model row

The existing two-cell setup row (Mic | Model) gains a third cell: ✨ Cleanup. The cell contains:
- A ✨ icon and "Cleanup" label on the left
- A toggle pill on the right (off by default, emerald when on)

When ON, the cell background gets a subtle emerald tint (`color-mix(in srgb, var(--accent) 8%, transparent)`), consistent with active-state patterns used elsewhere in the app.

**Initial value:** `HomeView` loads `apply_polish_to_regular` itself from `get_settings` on mount, consistent with how it already loads `micName`. It also re-reads on `settings-changed` events. The state is local to `HomeView` as `applyPolishToRegular: boolean`.

**Toggling:** Clicking anywhere on the Cleanup cell:
1. Loads current full settings: `const s = await invoke<AppSettings>("get_settings")`
2. Saves the updated full settings: `await invoke("update_settings", { newSettings: { ...s, apply_polish_to_regular: !applyPolishToRegular } })`
3. Updates local state optimistically.

The cell is visible at all times (including during recording). The toggle pill is not interactive during recording (pointer-events: none while `isRecording`).

**Rejected alternatives:**
- Dedicated card between setup row and tips — adds vertical height; the third-cell approach is more compact and consistent
- Badge/pill beside the record button — less discoverable, breaks the established pattern

### Style: New CLEANUP built-in style

A new `"cleanup"` entry is added to `styles.rs`. This requires changes in two places:

1. **`built_in_styles()` function** — add a new `BuiltInStyle { id: "cleanup", name: "Cleanup", description: "Remove fillers, fix grammar, preserve your voice" }` entry. Update four inline tests in `styles.rs`:
   - `built_in_styles_has_six_entries` (line ~174): change `assert_eq!(...len(), 6)` to `7`
   - `built_in_style_ids_are_unique` (line ~184): change `assert_eq!(ids.len(), 6)` to `7`
   - `all_builtin_prompts_nonempty` (line ~230): add `"cleanup"` to the hardcoded id list
   - `expected_style_ids_present` (line ~188): add `"cleanup"` to the asserted id list

2. **`system_prompt_for()` match block** — add a `"cleanup"` arm returning the CLEANUP system prompt:

```
---
MODE : CLEANUP (default)
---
Process transcribed speech into clean, polished text. This is your default.

Rules:
- Remove filler words (um, uh, er, like, you know, basically) unless meaningful
- Fix grammar, spelling, punctuation. Break up run-on sentences
- Remove false starts, stutters, and accidental repetitions
- Correct obvious transcription errors
- Preserve the speaker's voice, tone, vocabulary, and intent
- Preserve technical terms, proper nouns, names, and jargon exactly as spoken

Self-corrections ("wait no", "I meant", "scratch that"): use only the corrected version. "Actually" used for emphasis is NOT a correction.
Spoken punctuation ("period", "comma", "new line"): convert to symbols.
Numbers & dates: standard written forms (January 15, 2026 / $300 / 5:30 PM).
Broken phrases: reconstruct the speaker's likely intent from context.
Formatting: bullets/numbered lists/paragraph breaks only when they genuinely improve readability. Do not over-format.
```

The style key `"cleanup"` follows the existing naming convention (single lowercase word, same as `"professional"`, `"casual"`, `"concise"`, `"translate"`, `"email"`).

### Backend: Force built-in path for regular cleanup

`polish_text_cmd` currently routes to the built-in LlmEngine only when `settings.ai_backend == "built_in"`. For regular-recording cleanup, the built-in path must be used regardless of `ai_backend`.

**Approach:** Change the `force_builtin` parameter to `Option<bool>` in `polish_text_cmd`:

```rust
pub async fn polish_text_cmd(
    text: String,
    style: String,
    force_builtin: Option<bool>,
    app: tauri::AppHandle,
) -> Result<String, String>
```

When `force_builtin == Some(true)`, skip the `ai_backend` check and go directly to the LlmEngine. When `None` or `Some(false)`, preserve existing behaviour (check `ai_backend`).

The existing Smart Dictation call site in `App.tsx` (line ~192) must be updated to pass `forceBuiltin: null` explicitly:

```ts
await invoke<string>("polish_text_cmd", { text: rawText, style, forceBuiltin: null });
```

Passing `null` is unambiguous — Tauri deserialises it as `None` for `Option<bool>`. This is safer than relying on serde's missing-key behaviour.

### Error handling

If the LlmEngine is not ready (model not downloaded, or still loading at startup), `polish_text_cmd` returns `"llm_not_ready"`. The `transcription-complete` handler in `App.tsx` catches this and falls back to raw paste + toast: `"AI not ready — pasting raw text"`. This is the same pattern already used for Smart Dictation failures.

### Existing `style: "professional"` call

The current `App.tsx` regular-recording path (line ~214) calls `polish_text_cmd` with `style: "professional"`. This must be changed to `style: "cleanup"`. The call also gains `forceBuiltin: true`.

## Data Flow

```
User stops ⌘⇧V recording
  → transcription-complete event fires in App.tsx
  → if apply_polish_to_regular is true (read from pendingApplyCleanup ref):
      → invoke polish_text_cmd(text, style="cleanup", forceBuiltin=true)
      → on success: paste polished text, toast "✓ Cleaned up & copied"
      → on error (llm_not_ready): paste raw text, toast "AI not ready — pasting raw text"
  → if apply_polish_to_regular is false:
      → paste raw text, toast "✓ Copied to clipboard"
```

Note: `App.tsx` reads the current `apply_polish_to_regular` value at the time of `transcription-complete` by calling `get_settings` (same as the current implementation). No new ref is needed.

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/styles.rs` | Add `"cleanup"` to `built_in_styles()` and to `system_prompt_for()` match block; update count assertions in tests from `6` to `7` |
| `src-tauri/src/commands.rs` | Add `force_builtin: Option<bool>` param to `polish_text_cmd`; use LlmEngine when `force_builtin == Some(true)` regardless of `ai_backend` |
| `src/components/HomeView.tsx` | Add `applyPolishToRegular` state loaded from `get_settings` on mount + on `settings-changed`; add third cell (✨ Cleanup + toggle pill) to setup row with get-then-save toggle handler |
| `src/App.tsx` | In `transcription-complete` handler: (1) change `style: "professional"` → `"cleanup"` and add `forceBuiltin: true` in the `polish_text_cmd` invoke call; (2) change `polishStyle: "professional"` → `"cleanup"` in the `save_transcription` call immediately below; (3) add `forceBuiltin: null` to the existing Smart Dictation `polish_text_cmd` call |

## Out of Scope

- Exposing the CLEANUP style in the AI settings UI (it exists as a built-in but is not user-editable from the AI tab)
- Changing Smart Dictation behaviour in any way
- Showing a loading spinner on the toggle while the LLM initialises
- Any new Tauri commands (uses existing `polish_text_cmd` and `update_settings`)
- Auto-downloading the qwen2.5 model when the toggle is turned on
