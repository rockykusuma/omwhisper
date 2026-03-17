# Home Screen AI Cleanup Toggle — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ✨ Cleanup toggle as a third cell in the home screen mic/model row that applies the new CLEANUP style to every regular ⌘⇧V recording using the built-in qwen2.5 model, regardless of the `ai_backend` setting.

**Architecture:** Three independent changes: (1) add a `"cleanup"` style to Rust's `styles.rs`, (2) add `force_builtin: Option<bool>` to `polish_text_cmd` in `commands.rs`, (3) wire up the toggle UI in `HomeView.tsx` and update the `App.tsx` transcription-complete handler. Each chunk can be committed independently and tested in isolation.

**Tech Stack:** Rust (Tauri 2 commands), React 18 + TypeScript, Tailwind CSS v4, Vitest + React Testing Library, `cargo test`

---

## Chunk 1: Add CLEANUP style to Rust

### Task 1: Add `"cleanup"` to `styles.rs` and update tests

**Files:**
- Modify: `src-tauri/src/styles.rs`

---

- [ ] **Step 1: Update the count tests first (they will fail after we add the style)**

In `src-tauri/src/styles.rs`, find and update these four tests (all inside the `#[cfg(test)]` block):

```rust
// Change: built_in_styles_has_six_entries
// From:
assert_eq!(built_in_styles().len(), 6);
// To:
assert_eq!(built_in_styles().len(), 7);

// Change: built_in_style_ids_are_unique
// From:
assert_eq!(ids.len(), 6);
// To:
assert_eq!(ids.len(), 7);

// Change: expected_style_ids_present — add "cleanup" to the list
// From:
for expected in &["professional", "casual", "concise", "translate", "email", "meeting_notes"] {
// To:
for expected in &["professional", "casual", "concise", "translate", "email", "meeting_notes", "cleanup"] {

// Change: all_builtin_prompts_nonempty — add "cleanup" to the list
// From:
for id in &["professional", "casual", "concise", "email", "meeting_notes"] {
// To:
for id in &["professional", "casual", "concise", "email", "meeting_notes", "cleanup"] {
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test styles -- --nocapture 2>&1 | tail -20
```

Expected: FAIL — `built_in_styles_has_six_entries` and `built_in_style_ids_are_unique` fail because the count is still 6. `expected_style_ids_present` and `all_builtin_prompts_nonempty` may also fail depending on order.

- [ ] **Step 3: Add `"cleanup"` to `built_in_styles()`**

In `src-tauri/src/styles.rs`, inside the `built_in_styles()` function, add after the `meeting_notes` entry (before the closing `]`):

```rust
        BuiltInStyle {
            id: "cleanup".to_string(),
            name: "Cleanup".to_string(),
            description: "Remove fillers, fix grammar, preserve your voice".to_string(),
        },
```

- [ ] **Step 4: Add `"cleanup"` arm to `system_prompt_for()`**

In `src-tauri/src/styles.rs`, inside the `system_prompt_for()` match block, add a new arm **before** the `other =>` catch-all arm:

```rust
        "cleanup" => "\
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

Self-corrections (\"wait no\", \"I meant\", \"scratch that\"): use only the corrected version. \"Actually\" used for emphasis is NOT a correction.
Spoken punctuation (\"period\", \"comma\", \"new line\"): convert to symbols.
Numbers & dates: standard written forms (January 15, 2026 / $300 / 5:30 PM).
Broken phrases: reconstruct the speaker's likely intent from context.
Formatting: bullets/numbered lists/paragraph breaks only when they genuinely improve readability. Do not over-format."
            .to_string(),
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd src-tauri && cargo test styles -- --nocapture 2>&1 | tail -20
```

Expected: All `styles` tests PASS (8 tests total now including the count tests updated to 7).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/styles.rs
git commit -m "✨ feat(styles): add cleanup built-in style for voice-to-text cleanup"
```

---

## Chunk 2: Add `force_builtin` to `polish_text_cmd`

### Task 2: Add `force_builtin: Option<bool>` parameter to `polish_text_cmd`

**Files:**
- Modify: `src-tauri/src/commands.rs`

---

- [ ] **Step 1: Update `polish_text_cmd` signature and routing logic**

In `src-tauri/src/commands.rs`, find `polish_text_cmd` (around line 970). Replace the entire function with:

```rust
#[tauri::command]
pub async fn polish_text_cmd(
    text: String,
    style: String,
    force_builtin: Option<bool>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Manager;
    let settings = crate::settings::load_settings().await;

    let use_builtin = force_builtin == Some(true) || settings.ai_backend == "built_in";

    // built_in is intercepted here — ai::polish has no access to managed state
    #[cfg(target_os = "macos")]
    if use_builtin {
        let engine_state = app.state::<LlmEngineState>();
        let vocab = settings.custom_vocabulary.clone();
        let result: anyhow::Result<String> = {
            let guard = engine_state.lock().unwrap();
            match guard.as_ref() {
                Some(engine) => engine.polish(&text, &style, &vocab),
                None => return Err("llm_not_ready".to_string()),
            }
        };
        return result.map_err(|e: anyhow::Error| e.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    if use_builtin {
        return Err("On-Device LLM is not available on this platform".to_string());
    }

    // ollama / cloud path — unchanged
    let system_prompt = crate::styles::system_prompt_for(&style, &settings.translate_target_language);
    let request = crate::ai::PolishRequest { text, system_prompt };
    crate::ai::polish(request, &settings)
        .await
        .map(|r| r.text)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Verify Rust compiles**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error" | head -20
```

Expected: No errors. (Warnings are fine.)

- [ ] **Step 3: Run full Rust test suite**

```bash
cd src-tauri && cargo test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "✨ feat(commands): add force_builtin param to polish_text_cmd"
```

---

## Chunk 3: Frontend — HomeView toggle + App.tsx wiring

> **Prerequisite:** Chunk 1 must be complete before this chunk. The `"cleanup"` style string used in Step 5 is only valid once `system_prompt_for()` has a `"cleanup"` arm (added in Chunk 1, Task 1, Step 4).

### Task 3: Add Cleanup toggle cell to HomeView and update App.tsx

**Files:**
- Modify: `src/components/HomeView.tsx`
- Modify: `src/App.tsx`

---

- [ ] **Step 1: Add `applyPolishToRegular` state and loader to `HomeView.tsx`**

In `src/components/HomeView.tsx`, find the `// ── Home state ──` comment (around line 70). After the `micName` state line, add:

```tsx
  const [applyPolishToRegular, setApplyPolishToRegular] = useState(false);
```

Then find the `loadSettings` callback (around line 75) and extend it to also load `apply_polish_to_regular`:

```tsx
  const loadSettings = useCallback(async () => {
    const s = await invoke<{ audio_input_device: string | null; apply_polish_to_regular: boolean }>("get_settings").catch(() => null);
    setMicName(s?.audio_input_device || "Default Microphone");
    setApplyPolishToRegular(s?.apply_polish_to_regular ?? false);
  }, []);
```

- [ ] **Step 2: Add the toggle handler to `HomeView.tsx`**

After the `loadSettings` callback (and before the `// Initial load` useEffect), add:

```tsx
  const handleToggleCleanup = useCallback(async () => {
    try {
      const s = await invoke<import("../types").AppSettings>("get_settings");
      const next = !applyPolishToRegular;
      setApplyPolishToRegular(next); // optimistic update
      await invoke("update_settings", { newSettings: { ...s, apply_polish_to_regular: next } });
    } catch (e) {
      setApplyPolishToRegular(applyPolishToRegular); // revert on failure
    }
  }, [applyPolishToRegular]);
```

- [ ] **Step 3: Add the Cleanup cell to the setup row in `HomeView.tsx`**

Find the closing `</button>` of the Model cell (the second `<button>` in the `{/* ── Active setup row */}` div, around line 335). After that closing `</button>`, add a divider and the Cleanup cell:

```tsx
        <div className="w-px self-stretch shrink-0" style={{ background: "color-mix(in srgb, var(--t1) 6%, transparent)" }} />
        <button
          onClick={isRecording ? undefined : handleToggleCleanup}
          className="group flex items-center gap-2 px-3 py-3 text-left transition-all duration-150 min-w-0 flex-shrink-0"
          style={{
            background: applyPolishToRegular
              ? "color-mix(in srgb, var(--accent) 8%, transparent)"
              : "transparent",
            cursor: isRecording ? "default" : "pointer",
            pointerEvents: isRecording ? "none" : "auto",
          }}
          onMouseEnter={(e) => {
            if (!isRecording && !applyPolishToRegular)
              e.currentTarget.style.background = "color-mix(in srgb, var(--t1) 4%, transparent)";
          }}
          onMouseLeave={(e) => {
            if (!applyPolishToRegular) e.currentTarget.style.background = "transparent";
          }}
          title="Toggle AI Cleanup"
          aria-pressed={applyPolishToRegular}
        >
          <Sparkles size={13} style={{ color: applyPolishToRegular ? "var(--accent)" : "var(--t3)", flexShrink: 0 }} strokeWidth={2} />
          {/* Toggle pill */}
          <div
            className="relative w-7 h-4 rounded-full flex-shrink-0 transition-colors duration-200"
            style={{ background: applyPolishToRegular ? "var(--accent)" : "color-mix(in srgb, var(--t1) 20%, transparent)" }}
          >
            <div
              className="absolute top-0.5 w-3 h-3 rounded-full transition-transform duration-200"
              style={{
                background: applyPolishToRegular ? "var(--bg)" : "var(--t3)",
                transform: applyPolishToRegular ? "translateX(14px)" : "translateX(2px)",
              }}
            />
          </div>
        </button>
```

- [ ] **Step 4: Run frontend tests**

```bash
npm test 2>&1 | tail -20
```

Expected: All existing tests pass (no new tests for this task — the HomeView has no test file; the toggle logic is tested by the App.tsx test coverage of invoke calls).

- [ ] **Step 5: Update `App.tsx` — regular recording polish call**

In `src/App.tsx`, find the regular-recording polish block (around line 213). Update these two lines:

```tsx
// Change line ~214 from:
const polished = await invoke<string>("polish_text_cmd", { text: rawText, style: "professional" });
// To:
const polished = await invoke<string>("polish_text_cmd", { text: rawText, style: "cleanup", forceBuiltin: true });
// NOTE: forceBuiltin: true means the built-in qwen2.5 LLM is always used, regardless of ai_backend setting.
// If the model is not downloaded or not yet loaded, polish_text_cmd returns "llm_not_ready"
// and the catch block below falls back to raw paste + toast — this is intentional.

// Change line ~217 from:
invoke("save_transcription", { text: polished, durationSeconds, modelUsed, source: "regular_polished", rawText, polishStyle: "professional" })
// To:
invoke("save_transcription", { text: polished, durationSeconds, modelUsed, source: "regular_polished", rawText, polishStyle: "cleanup" })
```

- [ ] **Step 6: Update `App.tsx` — Smart Dictation polish call**

In `src/App.tsx`, find the Smart Dictation polish call (around line 192). Update it to pass `forceBuiltin: null` explicitly:

```tsx
// Change from:
const polished = await invoke<string>("polish_text_cmd", { text: rawText, style });
// To:
const polished = await invoke<string>("polish_text_cmd", { text: rawText, style, forceBuiltin: null });
```

- [ ] **Step 7: Run TypeScript build check**

```bash
npm run build 2>&1 | grep -E "error TS" | head -20
```

Expected: No TypeScript errors.

- [ ] **Step 8: Run full frontend test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/HomeView.tsx src/App.tsx
git commit -m "✨ feat(home): add AI cleanup toggle to setup row"
```

---

## Verification

After all three chunks are committed:

1. Run `cargo tauri dev`
2. Open the app — the home screen setup row should show three cells: **Mic | Model | ✨ (toggle pill)**
3. Toggle should be OFF by default (pill left, grey)
4. Click the toggle — pill moves right, cell gets emerald tint
5. Click the toggle again — returns to off state
6. Toggle ON, then dictate (⌘⇧V) — transcription should be cleaned up before pasting
7. Toggle OFF, then dictate — raw transcription is pasted (no AI delay)
8. While recording, verify the Cleanup cell is visible but not clickable
9. Toggle ON while `ai_backend = "disabled"` in Settings — cleanup should still work (force_builtin bypasses the setting)

## Done
