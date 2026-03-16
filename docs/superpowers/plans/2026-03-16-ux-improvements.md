# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 7 targeted UX improvements across 6 frontend components and 1 Rust command, making Home focused on recording, History deletable in bulk, AI Models guided with presets, Vocabulary editable inline, Settings cleaner, and the free tier label clearer.

**Architecture:** Each change is isolated to a single component with no cross-component state. Frontend changes use existing Tauri IPC commands; the only backend change adds a `#[cfg(debug_assertions)]` early return to `get_license_status`. No new commands, no schema changes.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS v4, Tauri 2 `invoke()` / `listen()`, Rust `#[cfg(debug_assertions)]`

**Spec:** `docs/superpowers/specs/2026-03-16-ux-improvements-design.md`

---

## Chunk 1: HomeView, History, AiModels

---

### Task 1: HomeView — Remove Stats/Recent, Fix Clear Behaviour, Add Vocab Nudge

**Files:**
- Modify: `src/components/HomeView.tsx`

**What changes:**
- Remove stats strip (4-col grid), `stats` state, `loadStats` callback
- Remove recent-2 section, `recentItems` state, `loadRecent` callback
- Remove `postRecordingTimerRef`, `wasRecordingRef`, the on-stop `useEffect`, the cleanup `useEffect`
- Remove dead helper functions `formatRelativeTime` and `formatDurationShort` (only used by the recent-2 section)
- Clear button: only calls `setSegments([])` and `setShowLiveTranscript(false)` — no other calls
- On recording start: remove the `postRecordingTimerRef.current` cancel block (it no longer exists)
- Add `vocabEmpty: boolean` + `nudgeDismissed: boolean` states
- On mount: `invoke("get_vocabulary")` → if `words.length === 0 && Object.keys(replacements).length === 0` → `setVocabEmpty(true)`
- Render nudge when `vocabEmpty && !nudgeDismissed && !isRecording && !showLiveTranscript`
- Nudge click → `onNavigate("vocabulary")`; dismiss button → `setNudgeDismissed(true)`

- [ ] **Step 1: Remove dead imports and state**

  Open `src/components/HomeView.tsx` and apply the following changes:

  **Remove from import line 4** — `Clock, Hash, Flame` (keep `Mic, MicOff, Sparkles, ChevronRight, Cpu`):
  ```tsx
  import { Mic, MicOff, Sparkles, ChevronRight, Cpu } from "lucide-react";
  ```

  **Remove from type import line 5** — `TranscriptionEntry, UsageStats` (keep `TranscriptionSegment`):
  ```tsx
  import type { TranscriptionSegment } from "../types";
  ```

  **Delete these four exact declarations** (search by name — leave `micName` untouched):
  ```tsx
  // DELETE: postRecordingTimerRef ref
  const postRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // DELETE: wasRecordingRef ref
  const wasRecordingRef = useRef(false);
  // DELETE: stats state
  const [stats, setStats] = useState<UsageStats | null>(null);
  // DELETE: recentItems state
  const [recentItems, setRecentItems] = useState<TranscriptionEntry[]>([]);
  ```
  The `micName` state on the line between `stats` and `recentItems` must be kept.

  **Remove `loadStats` and `loadRecent` callbacks:**
  ```tsx
  // DELETE both:
  const loadStats = useCallback(async () => { ... }, []);
  const loadRecent = useCallback(async () => { ... }, []);
  ```

  **Remove dead helper functions `formatRelativeTime` and `formatDurationShort`** (lines 39–54 in the original file, just after `formatSegTime`):
  ```tsx
  // DELETE both:
  function formatRelativeTime(isoString: string): string { ... }
  function formatDurationShort(secs: number): string { ... }
  ```

- [ ] **Step 2: Fix initial load useEffect**

  Change lines 110–114 from:
  ```tsx
  useEffect(() => {
    loadStats();
    loadSettings();
    loadRecent();
  }, [loadStats, loadSettings, loadRecent]);
  ```
  To:
  ```tsx
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);
  ```

- [ ] **Step 3: Fix the recording-start useEffect**

  Change lines 125–136 from:
  ```tsx
  useEffect(() => {
    if (isRecording) {
      recordingStartRef.current = Date.now();
      setSegments([]);
      setTranscriptionComplete(false);
      setShowLiveTranscript(true);
      if (postRecordingTimerRef.current) {
        clearTimeout(postRecordingTimerRef.current);
        postRecordingTimerRef.current = null;
      }
    }
  }, [isRecording]);
  ```
  To:
  ```tsx
  useEffect(() => {
    if (isRecording) {
      recordingStartRef.current = Date.now();
      setSegments([]);
      setTranscriptionComplete(false);
      setShowLiveTranscript(true);
    }
  }, [isRecording]);
  ```

- [ ] **Step 4: Remove the two on-stop/cleanup useEffects**

  Delete the entire on-stop `useEffect` (lines 139–149):
  ```tsx
  // DELETE:
  useEffect(() => {
    if (wasRecordingRef.current && !isRecording) {
      loadStats();
      postRecordingTimerRef.current = setTimeout(() => {
        setShowLiveTranscript(false);
        loadRecent();
        postRecordingTimerRef.current = null;
      }, 5000);
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording, loadStats, loadRecent]);
  ```

  Delete the cleanup `useEffect` (lines 151–156):
  ```tsx
  // DELETE:
  useEffect(() => {
    return () => {
      if (postRecordingTimerRef.current) clearTimeout(postRecordingTimerRef.current);
    };
  }, []);
  ```

- [ ] **Step 5: Fix the Clear button**

  Change the Clear button `onClick` in the transcript panel header (around line 299) from:
  ```tsx
  onClick={() => {
    setShowLiveTranscript(false);
    if (postRecordingTimerRef.current) {
      clearTimeout(postRecordingTimerRef.current);
      postRecordingTimerRef.current = null;
    }
    loadRecent();
  }}
  ```
  To:
  ```tsx
  onClick={() => { setSegments([]); setShowLiveTranscript(false); }}
  ```

- [ ] **Step 6: Remove the stats strip JSX**

  Delete the entire stats strip section (the `{stats && stats.total_recordings > 0 && (...)` block, around lines 331–388).

- [ ] **Step 7: Remove the recent recordings JSX**

  Delete the entire recent recordings section (the `{!showLiveTranscript && recentItems.length > 0 && (...)` block, around lines 422–475).

- [ ] **Step 8: Add vocabulary nudge state and load**

  After the `loadSettings` callback definition, add:
  ```tsx
  const [vocabEmpty, setVocabEmpty] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  useEffect(() => {
    invoke<{ words: string[]; replacements: Record<string, string> }>("get_vocabulary")
      .then((v) => {
        if (v.words.length === 0 && Object.keys(v.replacements).length === 0) {
          setVocabEmpty(true);
        }
      })
      .catch(() => {});
  }, []);
  ```

- [ ] **Step 9: Add nudge JSX**

  Place the nudge **between the live transcript panel and the active setup row** — after the `{showLiveTranscript && (...)}` block (around line 328) and before the mic/model setup row `<div>`. This satisfies the spec's "below the record button" placement. Add:
  ```tsx
  {/* ── Vocabulary nudge ──────────────────────────────────────────── */}
  {vocabEmpty && !nudgeDismissed && !isRecording && !showLiveTranscript && (
    <div
      className="rounded-2xl flex items-center gap-3 px-4 py-3 cursor-pointer flex-shrink-0"
      style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)", border: "1px solid color-mix(in srgb, var(--accent) 15%, transparent)" }}
      onClick={() => onNavigate("vocabulary")}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold leading-snug" style={{ color: "var(--t2)" }}>
          Whisper keeps mishearing a word?
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--accent)" }}>
          Add it to Vocabulary for better accuracy →
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setNudgeDismissed(true); }}
        className="shrink-0 cursor-pointer transition-colors"
        style={{ color: "var(--t4)" }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )}
  ```

- [ ] **Step 10: Verify in dev build**

  Run `cargo tauri dev`. Check:
  - Home screen shows: record button, mic/model row, vocab nudge (if vocab is empty). No stats grid, no recent recordings.
  - Record and stop — transcript stays visible after recording ends (no 5-second hide).
  - Click Clear — transcript panel hides immediately.
  - Start a new recording — transcript panel clears and shows fresh.
  - Click vocab nudge → navigates to Vocabulary tab.
  - Click ✕ on nudge → nudge disappears for the session.

- [ ] **Step 11: Commit**

  ```bash
  git add src/components/HomeView.tsx
  git commit -m "🔥 fix(home): remove stats strip, recent-2, and 5s transcript auto-hide

  Transcript now persists until next recording starts. Stats and recent
  items removed — Home is now purely focused on recording.

  Also adds a dismissible vocabulary nudge for empty-vocab users."
  ```

---

### Task 2: TranscriptionHistory — Multi-Select Batch Delete

**Files:**
- Modify: `src/components/TranscriptionHistory.tsx`

**What changes:**
- Add `selecting: boolean` + `selected: Set<number>` state
- "Select" button in header (beside search/export buttons)
- When selecting: each row shows a checkbox; clicking row toggles selection
- Sticky action bar at bottom: "X selected · Delete selected" + "Cancel"
- Delete iterates selected IDs sequentially using existing `cmd_delete_transcription`, then calls `loadHistory(0, "")` to refresh (preserves pagination state)

- [ ] **Step 1: Add multi-select state**

  After the existing state declarations (around line 35), add:
  ```tsx
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  ```

- [ ] **Step 2: Add "Select" button to header**

  In the header's button row (around line 130, alongside Export and Clear All), add a "Select" button before the Export button:
  ```tsx
  {!selecting && (
    <button
      onClick={() => setSelecting(true)}
      className="text-white/50 hover:text-white/70 transition-colors text-xs px-3 py-1.5 rounded-lg cursor-pointer font-sans"
      style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
    >
      Select
    </button>
  )}
  ```

- [ ] **Step 3: Add a batch delete handler**

  After `handleClearAll`, add:
  ```tsx
  async function handleDeleteSelected() {
    const deletedCount = selected.size;
    for (const id of selected) {
      await invoke("cmd_delete_transcription", { id }).catch((e) => logger.error("Delete failed:", e));
    }
    setSelected(new Set());
    setSelecting(false);
    await loadHistory(0, "");
    showToast(`Deleted ${deletedCount}`);
  }
  ```

- [ ] **Step 4: Add toggle-selection helper**

  ```tsx
  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  ```

- [ ] **Step 5: Update each entry row to support selection mode**

  Find the entry row rendering section (around lines 200+). Each entry is currently a `<div>` with an expand/collapse `onClick`. Wrap the existing row to conditionally show a checkbox and change click behaviour:

  For each entry row, change the outer `div`'s `onClick` to:
  ```tsx
  onClick={() => {
    if (selecting) {
      toggleSelect(entry.id);
    } else {
      setExpandedId(expandedId === entry.id ? null : entry.id);
    }
  }}
  ```

  And prepend a checkbox indicator inside the row when in select mode:
  ```tsx
  {selecting && (
    <div className="shrink-0 w-4 h-4 rounded border flex items-center justify-center mr-2"
      style={{
        borderColor: selected.has(entry.id) ? "var(--accent)" : "color-mix(in srgb, var(--t1) 25%, transparent)",
        background: selected.has(entry.id) ? "var(--accent)" : "transparent",
      }}
    >
      {selected.has(entry.id) && (
        <span className="text-[9px] font-bold" style={{ color: "#0a0f0d" }}>✓</span>
      )}
    </div>
  )}
  ```

- [ ] **Step 6: Add sticky action bar**

  After the entry list `</div>`, add the action bar (rendered when `selecting`):
  ```tsx
  {selecting && (
    <div
      className="sticky bottom-0 left-0 right-0 flex items-center justify-between gap-3 px-4 py-3 mt-2 rounded-2xl"
      style={{
        background: "var(--bg)",
        boxShadow: "var(--nm-raised)",
        border: "1px solid color-mix(in srgb, var(--t1) 8%, transparent)",
      }}
    >
      <span className="text-xs font-mono" style={{ color: "var(--t3)" }}>
        {selected.size} selected
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setSelecting(false); setSelected(new Set()); }}
          className="text-xs px-3 py-1.5 rounded-lg cursor-pointer font-sans"
          style={{ color: "var(--t3)", background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
        >
          Cancel
        </button>
        <button
          onClick={handleDeleteSelected}
          disabled={selected.size === 0}
          className="text-xs px-3 py-1.5 rounded-lg cursor-pointer font-sans disabled:opacity-40"
          style={{ color: "rgb(248,113,113)", background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
        >
          Delete selected
        </button>
      </div>
    </div>
  )}
  ```

- [ ] **Step 7: Verify in dev build**

  - History tab: "Select" button visible in header.
  - Click Select → checkboxes appear, existing expand/collapse stops working, action bar appears at bottom.
  - Click rows to select/deselect — checkboxes toggle, counter updates.
  - Click Cancel → select mode exits, no deletions.
  - Select 2 items → Delete selected → both removed from list, toast shown, exit select mode.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/TranscriptionHistory.tsx
  git commit -m "✨ feat(history): add multi-select batch delete

  Users can now select multiple transcriptions and delete them at once
  via a Select button + sticky action bar, without touching Clear All."
  ```

---

### Task 3: AiModelsView — Cloud API Model Preset Dropdown

**Files:**
- Modify: `src/components/AiModelsView.tsx`

**What changes (inside `SmartDictationTab`, Cloud API section):**
- Extract provider detection to a local variable
- Define preset models per provider
- Replace the text `<input>` for `ai_cloud_model` with a `<select>` showing presets + `"__custom__"` option
- Add `customModelInput` state — only populated/shown when the user picks "Custom…"
- Sentinel `"__custom__"` is UI-only: never written to settings
- Provider switching preserves existing provider-reset behaviour (handled by the Provider `<select>` already)

- [ ] **Step 1: Add MODEL_PRESETS constant and customModelInput state**

  Add `MODEL_PRESETS` as a **module-level constant** (outside `SmartDictationTab`, near the top of the file alongside other constants/helpers):
  ```tsx
  const MODEL_PRESETS: Record<string, string[]> = {
    openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
    groq: ["llama3-8b-8192", "llama3-70b-8192", "mixtral-8x7b-32768", "gemma-7b-it"],
    custom: [],
  };
  ```

  Inside `SmartDictationTab`, after the existing state declarations (around line 290), add:
  ```tsx
  const [customModelInput, setCustomModelInput] = useState("");
  ```

  Then add a `useEffect` to reset `customModelInput` whenever the provider changes (so stale typed values don't persist across provider switches):
  ```tsx
  useEffect(() => {
    setCustomModelInput("");
  }, [settings?.ai_cloud_api_url]);
  ```

- [ ] **Step 2: Replace the Model text input with a select + custom fallback**

  Find the `SettingRow label="Model"` block (around lines 473–481):
  ```tsx
  <SettingRow label="Model" description="Model name">
    <input
      type="text"
      value={settings.ai_cloud_model}
      onChange={(e) => update({ ai_cloud_model: e.target.value })}
      className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-32 font-mono"
      style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
    />
  </SettingRow>
  ```

  Replace with:
  ```tsx
  <SettingRow label="Model" description="Model name">
    <div className="flex flex-col items-end gap-1.5">
      {(() => {
        const activeProvider = settings.ai_cloud_api_url.includes("openai.com") ? "openai"
          : settings.ai_cloud_api_url.includes("groq.com") ? "groq"
          : "custom";
        const presets = MODEL_PRESETS[activeProvider] ?? [];
        const isCustomValue = presets.length > 0 && !presets.includes(settings.ai_cloud_model);
        const selectValue = isCustomValue ? "__custom__" : settings.ai_cloud_model;
        return (
          <>
            <select
              value={selectValue}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setCustomModelInput(settings.ai_cloud_model);
                } else {
                  setCustomModelInput("");
                  update({ ai_cloud_model: e.target.value });
                }
              }}
              className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none w-40 font-mono"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
            >
              {presets.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              {presets.length === 0 ? null : <option value="__custom__">Custom…</option>}
              {presets.length === 0 && (
                <option value={settings.ai_cloud_model}>{settings.ai_cloud_model || "Enter model…"}</option>
              )}
            </select>
            {(selectValue === "__custom__" || presets.length === 0) && (
              <input
                type="text"
                value={customModelInput || (presets.length === 0 ? settings.ai_cloud_model : "")}
                onChange={(e) => setCustomModelInput(e.target.value)}
                onBlur={() => { if (customModelInput.trim()) update({ ai_cloud_model: customModelInput.trim() }); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customModelInput.trim()) {
                    update({ ai_cloud_model: customModelInput.trim() });
                  }
                }}
                placeholder="model-name"
                className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-40 font-mono"
                style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
              />
            )}
          </>
        );
      })()}
    </div>
  </SettingRow>
  ```

- [ ] **Step 3: Verify in dev build**

  - AI Models → Smart Dictation tab → Cloud API section.
  - Switch provider to OpenAI → Model dropdown shows `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo` + "Custom…"
  - Select `gpt-4o` → model updates in settings (verify via Test Connection or re-open Settings).
  - Select "Custom…" → free-text input appears below dropdown; type a model name → press Enter → settings updated.
  - Switch provider to Groq → dropdown shows Groq models.
  - Switch provider to Custom → only free-text input shown (no presets).

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/AiModelsView.tsx
  git commit -m "✨ feat(ai-models): add cloud API model preset dropdown

  Replace free-text model input with per-provider presets (OpenAI/Groq)
  plus a Custom fallback for arbitrary model IDs."
  ```

---

## Chunk 2: Vocabulary, Settings, Sidebar, Rust

---

### Task 4: Vocabulary — Inline Edit for Words and Replacements

**Files:**
- Modify: `src/components/Vocabulary.tsx`

**What changes:**
- Add `editingWord: string | null` state — clicking a chip shows an `<input>` pre-filled with the word
- Enter: `remove_vocabulary_word(old)` + `add_vocabulary_word(new)`, clear state. Esc/blur: cancel.
- Add `editingReplacement: string | null` state (the `from` value) — clicking a row's text shows inputs
- Enter: `remove_word_replacement(oldFrom)` + `add_word_replacement(newFrom, newTo)`, clear state. Esc: cancel.

- [ ] **Step 1: Add editingWord state and handlers**

  After the existing state declarations (around line 17), add:
  ```tsx
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [editingWordInput, setEditingWordInput] = useState("");
  ```

  Add handler after `handleRemoveWord`:
  ```tsx
  async function handleSaveWordEdit(oldWord: string, newWord: string) {
    const trimmed = newWord.trim();
    if (!trimmed || trimmed === oldWord) { setEditingWord(null); return; }
    await invoke("remove_vocabulary_word", { word: oldWord }).catch((e) => logger.debug("remove_vocabulary_word:", e));
    await invoke("add_vocabulary_word", { word: trimmed }).catch((e) => logger.debug("add_vocabulary_word:", e));
    setEditingWord(null);
    await load();
    showToast(`Updated "${trimmed}"`);
  }
  ```

- [ ] **Step 2: Update word chip render to support inline edit**

  Find the chip `<span>` for each word (around lines 100–113). Replace it with:
  ```tsx
  {data.words.map((word) =>
    editingWord === word ? (
      <span key={word} className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}>
        <input
          type="text"
          autoFocus
          value={editingWordInput}
          onChange={(e) => setEditingWordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveWordEdit(word, editingWordInput);
            if (e.key === "Escape") setEditingWord(null);
          }}
          onBlur={() => setEditingWord(null)}
          className="bg-transparent outline-none text-white/75 text-xs font-mono w-24"
          aria-label={`Edit ${word}`}
        />
      </span>
    ) : (
      <span
        key={word}
        onClick={() => { setEditingWord(word); setEditingWordInput(word); }}
        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-white/65 text-xs font-mono cursor-pointer transition-opacity"
        style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
        title="Click to edit"
      >
        {word}
        <button
          onClick={(e) => { e.stopPropagation(); handleRemoveWord(word); }}
          className="text-white/50 hover:text-red-400 transition-colors cursor-pointer"
          aria-label={`Remove ${word}`}
        >
          <X size={11} />
        </button>
      </span>
    )
  )}
  ```

- [ ] **Step 3: Add editingReplacement state and handlers**

  Add state:
  ```tsx
  const [editingReplacement, setEditingReplacement] = useState<string | null>(null);
  const [editingFromInput, setEditingFromInput] = useState("");
  const [editingToInput, setEditingToInput] = useState("");
  ```

  Add handler after `handleRemoveReplacement`:
  ```tsx
  async function handleSaveReplacementEdit(oldFrom: string, newFrom: string, newTo: string) {
    const trimFrom = newFrom.trim();
    const trimTo = newTo.trim();
    if (!trimFrom || !trimTo) { setEditingReplacement(null); return; }
    await invoke("remove_word_replacement", { from: oldFrom }).catch((e) => logger.debug("remove_word_replacement:", e));
    await invoke("add_word_replacement", { from: trimFrom, to: trimTo }).catch((e) => logger.debug("add_word_replacement:", e));
    setEditingReplacement(null);
    await load();
    showToast("Replacement updated");
  }
  ```

- [ ] **Step 4: Update replacement row render to support inline edit**

  Find the replacement row `<div>` (around lines 163–178). Replace with:
  ```tsx
  {replacementEntries.map(([from, to]) =>
    editingReplacement === from ? (
      <div key={from} className="flex items-center gap-2 py-1.5 px-3 rounded-xl" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}>
        <input
          type="text"
          autoFocus
          value={editingFromInput}
          onChange={(e) => setEditingFromInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveReplacementEdit(from, editingFromInput, editingToInput);
            if (e.key === "Escape") setEditingReplacement(null);
          }}
          className="bg-transparent outline-none text-white/60 text-xs font-mono flex-1"
          aria-label="Edit source word"
        />
        <span className="text-white/35 text-xs shrink-0">→</span>
        <input
          type="text"
          value={editingToInput}
          onChange={(e) => setEditingToInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveReplacementEdit(from, editingFromInput, editingToInput);
            if (e.key === "Escape") setEditingReplacement(null);
          }}
          onBlur={() => setEditingReplacement(null)}
          className="bg-transparent outline-none text-emerald-400/70 text-xs font-mono flex-1"
          aria-label="Edit replacement word"
        />
      </div>
    ) : (
      <div
        key={from}
        className="flex items-center gap-3 py-1.5 px-3 rounded-xl cursor-pointer"
        style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
        onClick={() => { setEditingReplacement(from); setEditingFromInput(from); setEditingToInput(to); }}
        title="Click to edit"
      >
        <span className="text-white/50 text-xs font-mono flex-1">{from}</span>
        <span className="text-white/35 text-xs">→</span>
        <span className="text-emerald-400/70 text-xs font-mono flex-1">{to}</span>
        <button
          onClick={(e) => { e.stopPropagation(); handleRemoveReplacement(from); }}
          className="text-white/35 hover:text-red-400 transition-colors cursor-pointer ml-1"
          aria-label={`Remove replacement for ${from}`}
        >
          <X size={12} />
        </button>
      </div>
    )
  )}
  ```

- [ ] **Step 5: Verify in dev build**

  - Vocabulary tab, add 2 words and 1 replacement.
  - Click a word chip → input appears pre-filled; press Esc → chip restored, no change.
  - Click a word chip → change text; press Enter → old word removed, new word added in list.
  - Click a replacement row → both fields become editable; press Esc → restored.
  - Edit both fields of a replacement; press Enter → old entry replaced with new values.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/Vocabulary.tsx
  git commit -m "✨ feat(vocabulary): add inline edit for words and replacements

  Click any word chip or replacement row to edit in-place. Enter confirms,
  Esc cancels — no more delete-and-re-add for typo fixes."
  ```

---

### Task 5: Settings — Move Log Level to About Tab

**Files:**
- Modify: `src/components/Settings.tsx`

**What changes:**
- Remove `SettingRow` for `log_level` from General tab (around line 344–354)
- Update `AboutSection` function signature to accept `settings: Settings` and `update: (patch: Partial<Settings>) => void`
- Add `log_level` SettingRow inside `AboutSection` above the "Debug Info" row
- Update call site (`{activeTab === "about" && <AboutSection />}`) to pass props

- [ ] **Step 1: Remove Log Level from General tab**

  Find and delete (lines 344–354):
  ```tsx
  <SettingRow label="Log Level" description="Verbosity of log file">
    <select
      value={settings.log_level ?? "normal"}
      onChange={(e) => update({ log_level: e.target.value })}
      className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
      aria-label="Log level"
    >
      <option value="normal">Normal</option>
      <option value="debug">Debug</option>
    </select>
  </SettingRow>
  ```

- [ ] **Step 2: Update AboutSection signature**

  Change (line 742):
  ```tsx
  function AboutSection() {
  ```
  To:
  ```tsx
  function AboutSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  ```

- [ ] **Step 3: Add Log Level row inside AboutSection**

  In `AboutSection`, find the `SettingRow label="Debug Info"` block (around line 784). Add the log level row **above** it:
  ```tsx
  <SettingRow label="Log Level" description="Increase for troubleshooting">
    <select
      value={settings.log_level ?? "normal"}
      onChange={(e) => update({ log_level: e.target.value })}
      className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
      style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
      aria-label="Log level"
    >
      <option value="normal">Normal</option>
      <option value="debug">Debug</option>
    </select>
  </SettingRow>
  ```

- [ ] **Step 4: Update the About tab render call site**

  Change (line 673):
  ```tsx
  {activeTab === "about" && <AboutSection />}
  ```
  To:
  ```tsx
  {activeTab === "about" && <AboutSection settings={settings} update={update} />}
  ```

- [ ] **Step 5: Verify in dev build**

  - Settings → General tab: Log Level no longer appears.
  - Settings → About tab: Log Level row appears above "Debug Info", with description "Increase for troubleshooting".
  - Change from Normal to Debug and back — value persists (reflected in settings file).

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/Settings.tsx
  git commit -m "♻️ refactor(settings): move Log Level from General to About tab

  Log Level is a developer diagnostic — regular users should not see it
  in General. Moved to About tab above Copy Debug Info."
  ```

---

### Task 6: Sidebar — Free Tier Label Update

**Files:**
- Modify: `src/components/Sidebar.tsx`

**What changes:**
- In the expanded sidebar free-tier block, replace the `<div className="flex justify-between ...">` with two `<span>` elements with a single `<span>` showing `"Xm Ys left · resets at midnight"`.
- Amber/red colour thresholds on the progress bar remain unchanged.

- [ ] **Step 1: Replace the two-span flex row with a single combined span**

  Find (lines 189–192):
  ```tsx
  <div className="flex justify-between text-[10px] mb-2 font-mono" style={{ color: "var(--t2)" }}>
    <span>Free today</span>
    <span>{Math.floor(remaining / 60)}m {remaining % 60}s</span>
  </div>
  ```

  Replace with:
  ```tsx
  <span className="text-[10px] mb-2 font-mono block" style={{ color: "var(--t2)" }}>
    {Math.floor(remaining / 60)}m {remaining % 60}s left · resets at midnight
  </span>
  ```

- [ ] **Step 2: Verify in dev build**

  - Expand the sidebar while on free tier.
  - Usage label reads e.g. `"28m 12s left · resets at midnight"`.
  - Progress bar still turns amber/red at the usual thresholds.
  - Collapse sidebar → only Sparkles icon visible (unchanged).

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/Sidebar.tsx
  git commit -m "💬 feat(sidebar): update free tier label to show reset time

  Replace 'Free today / Xm Ys' with 'Xm Ys left · resets at midnight'
  so users know exactly when the limit resets."
  ```

---

### Task 7: Debug Mode — Bypass License Checks in Debug Builds

**Files:**
- Modify: `src-tauri/src/commands.rs`

**What changes:**
- Add a `#[cfg(debug_assertions)]` early return to `get_license_status` that returns `"Licensed"` unconditionally in debug builds.
- Production builds (`--release`) are unaffected.

- [ ] **Step 1: Add debug bypass to get_license_status**

  Find (lines 585–591):
  ```rust
  #[tauri::command]
  pub fn get_license_status() -> String {
      match crate::license::get_status() {
          crate::license::LicenseStatus::Licensed => "Licensed".to_string(),
          crate::license::LicenseStatus::GracePeriod => "GracePeriod".to_string(),
          crate::license::LicenseStatus::Expired => "Expired".to_string(),
          crate::license::LicenseStatus::Free => "Free".to_string(),
  ```

  Change to:
  ```rust
  #[tauri::command]
  pub fn get_license_status() -> String {
      #[cfg(debug_assertions)]
      { return "Licensed".to_string(); }
      match crate::license::get_status() {
          crate::license::LicenseStatus::Licensed => "Licensed".to_string(),
          crate::license::LicenseStatus::GracePeriod => "GracePeriod".to_string(),
          crate::license::LicenseStatus::Expired => "Expired".to_string(),
          crate::license::LicenseStatus::Free => "Free".to_string(),
  ```

- [ ] **Step 2: Verify in dev build**

  Run `cargo tauri dev`.
  - All Pro-gated features (model access, export) should be available without activating a license.
  - Sidebar should show "PRO" badge.
  - No license activation needed during development.

- [ ] **Step 3: Verify production build is unaffected**

  Run `cargo tauri build` (or just `cargo check --release` in `src-tauri/`). Confirm it compiles without warnings — the `#[cfg(debug_assertions)]` block is excluded from release builds.

- [ ] **Step 4: Commit**

  ```bash
  git add src-tauri/src/commands.rs
  git commit -m "🚩 feat(debug): bypass license checks in debug builds

  In debug_assertions builds, get_license_status always returns 'Licensed'
  so all gated features are testable without a real license. No change
  to release/production behaviour."
  ```

---

## Final Verification

- [ ] Run `cargo tauri dev` and manually exercise all 7 changes end-to-end.
- [ ] Run `cargo check --release` (inside `src-tauri/`) to confirm the Rust release build compiles.
- [ ] Use `superpowers:finishing-a-development-branch` to wrap up.
