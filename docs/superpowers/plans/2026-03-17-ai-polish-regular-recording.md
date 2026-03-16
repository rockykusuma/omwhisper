# AI Polish for Regular Recording — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle in AI settings that applies LLM polish (Professional style) to regular ⌘⇧V recordings before pasting, with a teal sparkle badge in the overlay and graceful fallback to raw paste when AI is unavailable.

**Architecture:** New `apply_polish_to_regular` bool field in Rust settings + TypeScript types. App.tsx `transcription-complete` handler gains an `else if` branch that calls `polish_text_cmd("professional")` with full fallback. OverlayWindow reads the setting and renders a teal "AI Polish" badge. AiModelsView gets a toggle row in the Smart Dictation sub-tab.

**Tech Stack:** Rust (serde + settings.rs), React 18 + TypeScript, Tauri invoke, lucide-react (`Sparkles`)

**Spec:** `docs/superpowers/specs/2026-03-17-ai-polish-regular-recording-design.md`

---

## Chunk 1: Settings types + recording flow

### Task 1: Add `apply_polish_to_regular` to Rust settings

**Files:**
- Modify: `src-tauri/src/settings.rs:88-99` (Settings struct, after `llm_nudge_shown`)
- Modify: `src-tauri/src/settings.rs:125-165` (Default impl)
- Modify: `src/types/index.ts:38-71` (AppSettings interface)

- [ ] **Step 1: Add field to Settings struct**

In `src-tauri/src/settings.rs`, add after the `llm_nudge_shown` field (line 98):

```rust
    /// Apply AI polish to regular ⌘⇧V recordings using the Professional style.
    #[serde(default)]
    pub apply_polish_to_regular: bool,
```

`#[serde(default)]` means existing `settings.json` files without this key will deserialize it as `false`. No migration needed.

- [ ] **Step 2: Add field to Default impl**

In the `impl Default for Settings` block (around line 163), add after `llm_nudge_shown: false,`:

```rust
            apply_polish_to_regular: false,
```

- [ ] **Step 3: Add field to TypeScript AppSettings**

In `src/types/index.ts`, add after `llm_nudge_shown: boolean;` (line 70):

```typescript
  apply_polish_to_regular: boolean;
```

- [ ] **Step 4: Verify Rust build**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper/src-tauri
cargo check
```

Expected: no errors. If you see "missing field `apply_polish_to_regular` in initializer", you forgot to add it to the Default impl.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings.rs src/types/index.ts
git commit -m "feat: add apply_polish_to_regular setting field"
```

---

### Task 2: Add polish branch in App.tsx transcription-complete handler

**Files:**
- Modify: `src/App.tsx:208-214` (the `else` branch in `transcription-complete`)

The current `else` block (regular recording, lines 208–214) is:

```typescript
      } else {
        invoke<void>("paste_transcription", { text: rawText })
          .then(() => showToast("✓ Copied to clipboard"))
          .catch((e) => logger.error("paste_transcription failed:", e));
        invoke("save_transcription", { text: rawText, durationSeconds, modelUsed })
          .catch((e) => logger.error("save_transcription failed:", e));
      }
```

Replace it with an async block that checks `apply_polish_to_regular`:

- [ ] **Step 1: Replace the else block**

Replace the entire `} else {` block (lines 208–214) with:

```typescript
      } else {
        (async () => {
          try {
            const settings = await invoke<{ apply_polish_to_regular: boolean }>("get_settings");
            if (settings.apply_polish_to_regular) {
              try {
                const polished = await invoke<string>("polish_text_cmd", { text: rawText, style: "professional" });
                await invoke("paste_transcription", { text: polished });
                showToast("✓ AI-polished & copied");
                invoke("save_transcription", { text: polished, durationSeconds, modelUsed, source: "regular_polished", rawText, polishStyle: "professional" })
                  .catch((e) => logger.error("save_transcription failed:", e));
              } catch {
                showToast("AI not ready — pasting raw text");
                await invoke("paste_transcription", { text: rawText }).catch(() => {});
                invoke("save_transcription", { text: rawText, durationSeconds, modelUsed })
                  .catch((e) => logger.error("save_transcription failed:", e));
              }
            } else {
              await invoke<void>("paste_transcription", { text: rawText });
              showToast("✓ Copied to clipboard");
              invoke("save_transcription", { text: rawText, durationSeconds, modelUsed })
                .catch((e) => logger.error("save_transcription failed:", e));
            }
          } catch {
            // get_settings failed — fall back to raw paste
            await invoke<void>("paste_transcription", { text: rawText }).catch(() => {});
            invoke("save_transcription", { text: rawText, durationSeconds, modelUsed }).catch(() => {});
          }
        })();
      }
```

**Key behavior notes:**
- `apply_polish_to_regular = true` path: calls `polish_text_cmd` with `style: "professional"`, saves as `source: "regular_polished"` with `rawText` and `polishStyle: "professional"`
- Any error from `polish_text_cmd` (including `llm_not_ready`) → toast + raw paste + save as regular (no `source` field = backend defaults to "regular"). Unlike Smart Dictation which drops the paste on `llm_not_ready`, this always pastes.
- `apply_polish_to_regular = false` path: same as before (`paste_transcription`, `save_transcription` with no source)
- Outer `get_settings` catch: safety net, pastes raw silently

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test — toggle OFF (default)**

```bash
cargo tauri dev
```

Do a regular ⌘⇧V recording. Verify:
- Toast shows "✓ Copied to clipboard"
- Text is pasted raw (no AI processing)

- [ ] **Step 4: Smoke test — toggle ON**

Manually set `apply_polish_to_regular: true` in `~/Library/Application Support/com.omwhisper.app/settings.json`. Restart app. Do a regular ⌘⇧V recording with filler words (e.g., "Um so I wanted to like tell you something").

Verify:
- Toast shows "✓ AI-polished & copied"
- Pasted text has filler words removed

- [ ] **Step 5: Smoke test — AI not ready fallback**

Set `ai_backend: "disabled"` in settings.json while `apply_polish_to_regular: true`. Do a ⌘⇧V recording.

Verify:
- Toast shows "AI not ready — pasting raw text"
- Raw text is still pasted

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: apply AI polish to regular recording when setting enabled"
```

---

## Chunk 2: Visual indicator + Settings UI

### Task 3: Overlay teal sparkle badge

**Files:**
- Modify: `src/components/OverlayWindow.tsx:1-4` (imports)
- Modify: `src/components/OverlayWindow.tsx:122-151` (OverlayWindow component)

The overlay currently shows `overlayStyle` (micro/waveform). It needs to also track `applyPolishRegular` and show a teal badge below the pill when true.

- [ ] **Step 1: Add Sparkles import**

At the top of `src/components/OverlayWindow.tsx`, add `Sparkles` to imports:

```typescript
import { Sparkles } from "lucide-react";
```

- [ ] **Step 2: Add applyPolishRegular state**

In `OverlayWindow` component, after `const [overlayStyle, setOverlayStyle] = useState<string>("micro");` (line 123), add:

```typescript
  const [applyPolishRegular, setApplyPolishRegular] = useState(false);
```

- [ ] **Step 3: Read apply_polish_to_regular in the mount/settings-changed effect**

The existing load function (lines 127–131) reads `overlay_style`. Extend it to also read `apply_polish_to_regular`:

Replace:
```typescript
    const load = () =>
      invoke<AppSettings>("get_settings")
        .then((s) => setOverlayStyle(s.overlay_style ?? "micro"))
        .catch(() => {});
```

With:
```typescript
    const load = () =>
      invoke<AppSettings>("get_settings")
        .then((s) => {
          setOverlayStyle(s.overlay_style ?? "micro");
          setApplyPolishRegular(s.apply_polish_to_regular ?? false);
        })
        .catch(() => {});
```

- [ ] **Step 4: Read apply_polish_to_regular in the recording-state:true branch**

The existing `recording-state: true` branch (lines 143–145) reads `overlay_style`. Extend it similarly:

Replace:
```typescript
        invoke<AppSettings>("get_settings")
          .then((s) => setOverlayStyle(s.overlay_style ?? "micro"))
          .catch(() => {});
```

With:
```typescript
        invoke<AppSettings>("get_settings")
          .then((s) => {
            setOverlayStyle(s.overlay_style ?? "micro");
            setApplyPolishRegular(s.apply_polish_to_regular ?? false);
          })
          .catch(() => {});
```

- [ ] **Step 5: Render the teal badge**

Replace the return statement (line 151):

```typescript
  return overlayStyle === "waveform" ? <WaveformPill /> : <MicroPill />;
```

With:

```typescript
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      {overlayStyle === "waveform" ? <WaveformPill /> : <MicroPill />}
      {applyPolishRegular && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "rgba(29,158,117,0.10)",
          border: "0.5px solid rgba(29,158,117,0.25)",
          borderRadius: 10,
          padding: "3px 8px",
        }}>
          <Sparkles size={9} style={{ color: "#34d399" }} />
          <span style={{ color: "#34d399", fontSize: 9, fontWeight: 500, letterSpacing: "0.4px" }}>AI Polish</span>
        </div>
      )}
    </div>
  );
```

- [ ] **Step 6: Verify dev build**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Smoke test — badge visible**

With `apply_polish_to_regular: true` in settings.json and `show_overlay: true`, start a ⌘⇧V recording. The overlay should show the micro/waveform pill AND a small teal "✦ AI Polish" badge below it.

- [ ] **Step 8: Smoke test — badge hidden**

With `apply_polish_to_regular: false`, start a ⌘⇧V recording. Only the pill shows, no badge.

- [ ] **Step 9: Commit**

```bash
git add src/components/OverlayWindow.tsx
git commit -m "feat: show teal AI Polish badge in overlay when setting enabled"
```

---

### Task 4: Toggle UI in AiModelsView Smart Dictation sub-tab

**Files:**
- Modify: `src/components/AiModelsView.tsx:707-720` (after Timeout row, before closing `</div>` of Smart Dictation card)

The Smart Dictation card ends around line 721 with `</div>`. The new toggle goes after the Timeout row.

- [ ] **Step 1: Add the toggle row**

Find the closing of the Smart Dictation card. It's around lines 707–721:

```tsx
        {settings.ai_backend !== "built_in" && (
          <SettingRow label="Timeout" description="Max seconds to wait for AI response">
            ...
          </SettingRow>
        )}
      </div>
```

After the `)}` that closes the Timeout conditional (after line 720) and before the `</div>` that closes the Smart Dictation card (line 721), insert:

```tsx
        <SettingRow
          label="Apply AI polish to regular recording"
          description={
            settings.ai_backend === "disabled"
              ? "Enable an AI backend above to use this feature."
              : "⌘⇧V recordings are polished using Professional style before pasting. Falls back to raw paste if AI is unavailable."
          }
        >
          <button
            onClick={() => {
              if (settings.ai_backend !== "disabled") {
                update({ apply_polish_to_regular: !settings.apply_polish_to_regular });
              }
            }}
            role="switch"
            aria-checked={settings.apply_polish_to_regular}
            aria-label="Apply AI polish to regular recording"
            disabled={settings.ai_backend === "disabled"}
            className="relative w-10 h-6 rounded-full transition-all duration-200"
            style={{
              cursor: settings.ai_backend === "disabled" ? "not-allowed" : "pointer",
              background: "var(--bg)",
              boxShadow: "var(--nm-pressed-sm)",
              opacity: settings.ai_backend === "disabled" ? 0.4 : 1,
            }}
          >
            <div
              className="absolute top-1 w-4 h-4 rounded-full transition-all duration-200"
              style={{
                transform: settings.apply_polish_to_regular ? "translateX(20px)" : "translateX(4px)",
                background: settings.apply_polish_to_regular ? "var(--accent)" : "var(--t4)",
                boxShadow: settings.apply_polish_to_regular ? "0 0 6px var(--accent-glow), var(--nm-raised-sm)" : "var(--nm-raised-sm)",
              }}
            />
          </button>
        </SettingRow>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test — toggle visible and functional**

Open app → AI Models → Smart Dictation tab. Verify:
- When `ai_backend` is "disabled": toggle row shows with grayed-out toggle and hint text "Enable an AI backend above to use this feature."
- When `ai_backend` is "built_in" or "ollama": toggle is active. Clicking it flips the value (emerald when on, gray when off).
- After toggling on, check `settings.json` → `apply_polish_to_regular: true`.

- [ ] **Step 4: End-to-end test**

With toggle ON and an AI backend configured:
1. Press ⌘⇧V, speak "Um so I wanted to like tell you something"
2. Release (or press again to stop)
3. Verify toast "✓ AI-polished & copied"
4. Verify pasted text is cleaned up

- [ ] **Step 5: Commit**

```bash
git add src/components/AiModelsView.tsx
git commit -m "feat: add AI polish toggle to Smart Dictation settings"
```
