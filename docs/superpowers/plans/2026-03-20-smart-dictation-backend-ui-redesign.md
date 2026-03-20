# Smart Dictation Backend UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the segmented backend selector and flat config rows in the AI tab with radio cards and status-banner config sections that show live connection state and guide first-time setup.

**Architecture:** All UI changes are in `src/components/AiModelsView.tsx` (`SmartDictationTab` function). One new boolean field `ai_cloud_verified` is added to the Rust `Settings` struct and mirrored in the TypeScript `AppSettings` interface. No Tauri command signatures change.

**Tech Stack:** React 18 + TypeScript, Tauri 2 (invoke/update_settings), Tailwind CSS v4, existing commands: `check_ollama_status`, `get_ollama_models`, `test_ai_connection`, `save_cloud_api_key`, `delete_cloud_api_key_cmd`, `update_settings`

**Key facts about the codebase before touching anything:**
- Cloud backend string value is `"cloud"` (not `"cloud_api"`) — used in both Rust and TS
- `built_in` backend is macOS-only; the `effectiveBackend` variable currently gates it per platform
- `update(patch)` is a local async function that merges the patch into settings and calls `invoke("update_settings", { newSettings })`
- Provider is detected by URL-matching against `settings.ai_cloud_api_url` — this pattern repeats twice (provider dropdown value + model preset lookup); do not change the logic, only extend it
- `customModelInput` local state already exists for the custom-provider text input; we extend it for the "Other…" case
- `ollamaStatus` starts as `null` (never checked); currently the user must click Refresh manually

---

## File Structure

| File | Change |
|------|--------|
| `src-tauri/src/settings.rs` | Add `ai_cloud_verified: bool` field + `#[serde(default)]` |
| `src/types/index.ts` | Add `ai_cloud_verified: boolean` to `AppSettings` |
| `src/components/AiModelsView.tsx` | All UI changes — backend selector + Ollama banner + Cloud banner + Other… model |

---

## Task 1: Add `ai_cloud_verified` to Settings

**Files:**
- Modify: `src-tauri/src/settings.rs` — add field after `crash_reporting_enabled` (line ~117)
- Modify: `src/types/index.ts` — add field to `AppSettings` interface

- [ ] **Step 1: Add the Rust field — struct declaration AND Default impl**

`Settings` has a manual `impl Default for Settings` block (line ~147) — you must update **both** places or the code will not compile.

**1a. In the struct** (`src-tauri/src/settings.rs`), add after `crash_reporting_enabled` (line ~117, just before the struct's closing `}`):

```rust
    /// Whether the Cloud API connection has been verified by the user. Resets when key/model/URL changes.
    #[serde(default)]
    pub ai_cloud_verified: bool,
```

**1b. In `impl Default for Settings`** (line ~191, after `crash_reporting_enabled: true,` and before the closing `}`):

```rust
            ai_cloud_verified: false,
```

The `#[serde(default)]` handles deserialization of existing settings files (missing field → `false`). The `impl Default` update is required for Rust to compile — the struct initialiser in `default()` must list every field.

- [ ] **Step 2: Run Rust tests to verify no breakage**

```bash
cd src-tauri && cargo test 2>&1 | tail -20
```

Expected: all tests pass. The new field has a `serde(default)` so existing test fixtures won't break.

- [ ] **Step 3: Add the TypeScript field**

In `src/types/index.ts`, find the `AppSettings` interface (around line 50–75) and add after `crash_reporting_enabled`:

```typescript
  ai_cloud_verified: boolean;
```

- [ ] **Step 4: Run TypeScript check**

```bash
cd /Users/rakeshkusuma/Documents/PersonalProjects/omwhisper && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (the new field is now declared).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings.rs src/types/index.ts
git commit -m "feat: add ai_cloud_verified setting field"
```

---

## Task 2: Replace Segmented Control with Radio Cards

**Files:**
- Modify: `src/components/AiModelsView.tsx` — lines 413–459 (the backend selector section inside `SmartDictationTab`)

- [ ] **Step 1: Update `effectiveBackend` to always hide `built_in`**

Find this line (~411):
```tsx
const effectiveBackend = platform === "macos" ? settings.ai_backend : (settings.ai_backend === "built_in" ? "disabled" : settings.ai_backend);
```

Replace with:
```tsx
const effectiveBackend = settings.ai_backend === "built_in" ? "disabled" : settings.ai_backend;
```

This hides `built_in` on all platforms without touching any other logic.

- [ ] **Step 2: Replace the backend selector JSX**

Find the entire backend selector `<div>` block by searching for the unique anchor string `<SettingRow label="Backend" description="Where text is sent for polishing">` (~line 419). The full block to replace spans from the `{/* Backend selector */}` comment (~line 417) through the closing `</div>` of the `.card` wrapper (~line 459), including the two conditional `<p>` blocks below the `SettingRow`.

Replace the entire block with:
```tsx
      {/* Backend selector — radio cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {(
          [
            { value: "disabled", icon: "🚫", name: "Disabled",           description: "No AI polishing" },
            { value: "ollama",   icon: "🦙", name: "On-Device (Ollama)", description: "Local model, private" },
            { value: "cloud",    icon: "☁️", name: "Cloud API",          description: "OpenAI, Groq, or custom" },
          ] as const
        ).map(({ value, icon, name, description }) => {
          const isSelected = effectiveBackend === value;
          const badge =
            value === "ollama"
              ? ollamaStatus === null
                ? null
                : ollamaStatus.running
                ? "Running"
                : "Setup needed"
              : value === "cloud"
              ? settings.ai_cloud_verified
                ? "Connected"
                : "Needs setup"
              : null;
          return (
            <button
              key={value}
              onClick={() => update({ ai_backend: value, ...(value === "disabled" ? { apply_polish_to_regular: false } : {}) })}
              className="relative flex flex-col items-start gap-1.5 rounded-xl p-3 text-left transition-all duration-150 cursor-pointer"
              style={{
                border: isSelected ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.07)",
                background: isSelected ? "rgba(139,92,246,0.07)" : "rgba(255,255,255,0.02)",
              }}
            >
              {/* radio dot */}
              <div
                className="absolute top-3 right-3 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                style={{
                  border: isSelected ? "1.5px solid rgb(139,92,246)" : "1.5px solid rgba(255,255,255,0.2)",
                  background: isSelected ? "rgb(139,92,246)" : "transparent",
                }}
              >
                {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <span className="text-base leading-none">{icon}</span>
              <span className="text-xs font-semibold pr-5" style={{ color: isSelected ? "rgb(167,139,250)" : "rgba(255,255,255,0.8)" }}>
                {name}
              </span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{description}</span>
              {badge && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: badge === "Running" || badge === "Connected" ? "rgba(52,211,153,0.1)" : "rgba(251,191,36,0.1)",
                    color:      badge === "Running" || badge === "Connected" ? "rgba(52,211,153,0.8)"  : "rgba(251,191,36,0.8)",
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. If there are errors about `"cloud"` not matching the `as const` tuple, double-check the value strings match exactly.

- [ ] **Step 4: Verify in dev**

```bash
cargo tauri dev
```

Open Settings → AI tab. Verify: 3 cards render, clicking each card selects it (purple border), Disabled card hides the config section below. The "Built-in" option is gone.

- [ ] **Step 5: Remove the now-dead `built_in` JSX block and its associated state**

After Task 2's `effectiveBackend` change, `effectiveBackend === "built_in"` is always `false`. The entire block at lines ~461–542 is dead code and must be removed along with its supporting state.

**5a. Remove state declarations** — find these 3 lines (~line 314):
```tsx
  const [llmModels, setLlmModels] = useState<LlmModelInfo[]>([]);
  const [llmDownloading, setLlmDownloading] = useState<Record<string, number>>({});
  const [llmErrors, setLlmErrors] = useState<Record<string, string>>({});
```
Delete all 3 lines.

**5b. Remove the LLM download progress subscription** inside the init `useEffect` (~lines 330–352). Find and delete:
```tsx
    // Load LLM model list
    invoke<LlmModelInfo[]>("get_llm_models").then(setLlmModels).catch(() => {});

    // Subscribe to LLM download progress
    const unlistenLlmPromise = listen<LlmDownloadProgress>("llm-download-progress", (event) => {
      const { name, progress, done, error } = event.payload;
      if (done) {
        setLlmDownloading((prev) => { const next = { ...prev }; delete next[name]; return next; });
        if (error) {
          setLlmErrors((prev) => ({ ...prev, [name]: error }));
        } else {
          invoke<LlmModelInfo[]>("get_llm_models").then(setLlmModels).catch(() => {});
          if (platform === "macos") {
            invoke("load_llm_engine", { name }).catch(() => {});
          }
        }
      } else {
        setLlmDownloading((prev) => ({ ...prev, [name]: progress }));
        setLlmErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
      }
    });

    return () => { unlistenLlmPromise.then((f) => f()); };
```

Replace `return () => { unlistenLlmPromise.then((f) => f()); };` with just `return () => {};` (or remove the return entirely if this is the only cleanup).

**5c. Remove the `built_in` card click handler** — in the new radio cards JSX from Step 2, the `"built_in"` value is no longer in the array, so there is no click handler to remove. This is already handled.

**5d. Remove the `{/* Built-in LLM section */}` JSX block** (~lines 461–542). Find the block starting with:
```tsx
      {/* Built-in LLM section */}
      {effectiveBackend === "built_in" && (
```
and delete through its closing `)}`.

**5e. Remove unused `LlmModelInfo` and `LlmDownloadProgress` imports** from the `import type` line at the top of the file if they are no longer referenced anywhere.

- [ ] **Step 6: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. Verify no unused-variable warnings remain.

- [ ] **Step 7: Commit**

```bash
git add src/components/AiModelsView.tsx
git commit -m "feat: replace backend segmented control with radio cards"
```

---

## Task 3: Ollama Status Banner

**Files:**
- Modify: `src/components/AiModelsView.tsx` — state declarations + `refreshOllamaStatus` + new `useEffect` + Ollama section JSX (~lines 544–624)

- [ ] **Step 1: Add `ollamaChecking` state**

Find the existing state declarations in `SmartDictationTab` (~line 311):
```tsx
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
```

Add after those two lines:
```tsx
  const [ollamaChecking, setOllamaChecking] = useState(false);
```

- [ ] **Step 2: Update `refreshOllamaStatus` to track loading**

Find the existing function (~line 355):
```tsx
  async function refreshOllamaStatus() {
    const status = await invoke<OllamaStatus>("check_ollama_status");
    setOllamaStatus(status);
  }
```

Replace with:
```tsx
  async function refreshOllamaStatus() {
    setOllamaChecking(true);
    try {
      const status = await invoke<OllamaStatus>("check_ollama_status");
      setOllamaStatus(status);
    } finally {
      setOllamaChecking(false);
    }
  }
```

- [ ] **Step 3: Add `useEffect` for auto-check on mount / backend switch**

Find the existing `useEffect` that clears `customModelInput` (~line 318):
```tsx
  useEffect(() => {
    setCustomModelInput("");
  }, [settings?.ai_cloud_api_url]);
```

Add a new `useEffect` directly after it:
```tsx
  useEffect(() => {
    if (settings?.ai_backend === "ollama") {
      setOllamaChecking(true);
      invoke<OllamaStatus>("check_ollama_status")
        .then((status) => { setOllamaStatus(status); setOllamaChecking(false); })
        .catch(() => { setOllamaChecking(false); });
    }
  }, [settings?.ai_backend]);
```

- [ ] **Step 4: Replace the Ollama section JSX**

Find the entire `{/* Ollama section */}` block (~lines 544–624):
```tsx
      {/* Ollama section */}
      {effectiveBackend === "ollama" && (
        <div className="card px-5 mb-5">
          ...
        </div>
      )}
```

Replace with:
```tsx
      {/* Ollama section */}
      {effectiveBackend === "ollama" && (
        <div className="card mb-5 overflow-hidden">
          {/* Status banner */}
          {ollamaChecking ? (
            <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}>
              <div className="w-2.5 h-2.5 rounded-full bg-white/20 animate-pulse flex-shrink-0" />
              <span className="text-xs text-white/50">Checking Ollama…</span>
            </div>
          ) : ollamaStatus?.running ? (
            <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(52,211,153,0.05)" }}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.5)" }} />
              <div className="flex-1 min-w-0 text-xs">
                <span className="font-semibold" style={{ color: "#34d399" }}>Connected</span>
                <span className="text-white/40 ml-2 font-mono">
                  {settings.ai_ollama_model} · {settings.ai_ollama_url} · {ollamaStatus.models.length} models
                </span>
              </div>
              <button onClick={refreshOllamaStatus} disabled={ollamaChecking} className="btn-ghost text-xs py-1 px-3 flex-shrink-0">Refresh</button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(251,191,36,0.05)" }}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#fbbf24", boxShadow: "0 0 6px rgba(251,191,36,0.5)" }} />
              <div className="flex-1 text-xs">
                <span className="font-semibold" style={{ color: "#fbbf24" }}>Ollama not detected</span>
                <span className="text-white/40 ml-2">Install and start Ollama to continue</span>
              </div>
              <button onClick={refreshOllamaStatus} disabled={ollamaChecking} className="btn-ghost text-xs py-1 px-3 flex-shrink-0">Refresh</button>
            </div>
          )}

          {/* Config fields — only when connected */}
          {ollamaStatus?.running && (
            <div className="px-5">
              <SettingRow label="Model" description="Ollama model for text polishing">
                <select
                  value={settings.ai_ollama_model}
                  onChange={(e) => update({ ai_ollama_model: e.target.value })}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none max-w-[160px]"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                >
                  {ollamaStatus.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </SettingRow>
              <SettingRow label="Server URL" description="Advanced">
                <input
                  type="text"
                  value={settings.ai_ollama_url}
                  onChange={(e) => update({ ai_ollama_url: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 outline-none max-w-[200px]"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                />
              </SettingRow>
            </div>
          )}

          {/* Setup guide — only when not running */}
          {!ollamaChecking && ollamaStatus !== null && !ollamaStatus.running && (
            <div className="px-5 py-4 space-y-2 text-xs leading-relaxed">
              <p className="text-white/50">1. Download from{" "}
                <button
                  onClick={() => invoke("plugin:opener|open_url", { url: "https://ollama.com" }).catch(() => {})}
                  className="text-violet-400 underline cursor-pointer hover:text-violet-300 transition-colors"
                >
                  ollama.com
                </button>
              </p>
              <p className="text-white/50">2. Run:{" "}
                <button
                  onClick={() => navigator.clipboard.writeText("ollama pull llama3.2")}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono cursor-pointer hover:bg-white/[0.06] transition-colors"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                  title="Click to copy"
                >
                  <code className="text-white/70">ollama pull llama3.2</code>
                </button>
              </p>
              <p className="text-white/50">3. Click <span className="text-white/70">Refresh</span> above</p>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Verify in dev**

Start `cargo tauri dev`. Select "On-Device (Ollama)" card. Verify:
- "Checking Ollama…" banner appears briefly on mount
- If Ollama running: green "Connected" banner shows model + URL + model count
- If Ollama not running: amber banner + 3-step guide visible
- Refresh button re-triggers the check (Checking… state shows again)

- [ ] **Step 7: Commit**

```bash
git add src/components/AiModelsView.tsx
git commit -m "feat: add Ollama status banner with auto-check on mount"
```

---

## Task 4: Cloud API Status Banner + Verified Persistence

**Files:**
- Modify: `src/components/AiModelsView.tsx` — state declarations + handlers + Cloud API section JSX (~lines 626–750)

- [ ] **Step 1: Add `cloudTestError` state**

In the state declarations section (~line 311), add:
```tsx
  const [cloudTestError, setCloudTestError] = useState<string | null>(null);
```

- [ ] **Step 2: Update `handleTestConnection` to persist result**

Find `handleTestConnection` (~line 372):
```tsx
  async function handleTestConnection(backend: string) {
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await invoke<string>("test_ai_connection", { backend });
      setTestResult("✓ " + result);
    } catch (e) {
      setTestResult("✗ " + String(e));
    } finally {
      setTestLoading(false);
    }
  }
```

Replace with:
```tsx
  async function handleTestConnection(backend: string) {
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await invoke<string>("test_ai_connection", { backend });
      setTestResult("✓ " + result);
      if (backend === "cloud") {
        setCloudTestError(null);
        await update({ ai_cloud_verified: true });
      }
    } catch (e) {
      const msg = String(e);
      setTestResult("✗ " + msg);
      if (backend === "cloud") {
        setCloudTestError(msg);
        await update({ ai_cloud_verified: false });
      }
    } finally {
      setTestLoading(false);
    }
  }
```

Note: After all tasks are complete, `testResult` / `setTestResult` become write-only (neither the new Ollama nor Cloud sections render the inline badge anymore). Add `testResult` and `setTestResult` to the removal list in Task 2 Step 5a, and remove the two `setTestResult(...)` calls from this function at that point.

- [ ] **Step 3: Reset `ai_cloud_verified` when API key changes**

Find `handleSaveApiKey` (~line 360):
```tsx
  async function handleSaveApiKey() {
    if (!apiKeyInput.trim()) return;
    await invoke("save_cloud_api_key", { key: apiKeyInput.trim() });
    setApiKeySet(true);
    setApiKeyInput("");
  }
```

Replace with:
```tsx
  async function handleSaveApiKey() {
    if (!apiKeyInput.trim()) return;
    await invoke("save_cloud_api_key", { key: apiKeyInput.trim() });
    setApiKeySet(true);
    setApiKeyInput("");
    setCloudTestError(null);
    await update({ ai_cloud_verified: false });
  }
```

Find `handleDeleteApiKey` (~line 367):
```tsx
  async function handleDeleteApiKey() {
    await invoke("delete_cloud_api_key_cmd").catch(() => {});
    setApiKeySet(false);
  }
```

Replace with:
```tsx
  async function handleDeleteApiKey() {
    await invoke("delete_cloud_api_key_cmd").catch(() => {});
    setApiKeySet(false);
    setCloudTestError(null);
    await update({ ai_cloud_verified: false });
  }
```

- [ ] **Step 4: Replace the Cloud API section JSX**

Find the provider-detection helper at the top of the Cloud API section — it appears twice (provider dropdown value, and model preset lookup). A local helper is needed to avoid repetition. Find the entire `{/* Cloud API section */}` block (~lines 626–750):

```tsx
      {/* Cloud API section */}
      {effectiveBackend === "cloud" && (
        <div className="card px-5 mb-5">
          ...
        </div>
      )}
```

Replace with:
```tsx
      {/* Cloud API section */}
      {effectiveBackend === "cloud" && (() => {
        const activeProvider =
          settings.ai_cloud_api_url.includes("openai.com")      ? "openai"
          : settings.ai_cloud_api_url.includes("anthropic.com") ? "anthropic"
          : settings.ai_cloud_api_url.includes("googleapis.com") || settings.ai_cloud_api_url.includes("generativelanguage") ? "google"
          : settings.ai_cloud_api_url.includes("groq.com")      ? "groq"
          : settings.ai_cloud_api_url.includes("mistral.ai")    ? "mistral"
          : settings.ai_cloud_api_url.includes("openrouter.ai") ? "openrouter"
          : "custom";

        return (
          <div className="card mb-5 overflow-hidden">
            {/* Status banner */}
            {settings.ai_cloud_verified ? (
              <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(52,211,153,0.05)" }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.5)" }} />
                <div className="flex-1 text-xs">
                  <span className="font-semibold" style={{ color: "#34d399" }}>Connected</span>
                  <span className="text-white/40 ml-2 font-mono capitalize">{activeProvider} · {settings.ai_cloud_model}</span>
                </div>
              </div>
            ) : cloudTestError ? (
              <div className="flex items-start gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(248,113,113,0.05)" }}>
                <div className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ background: "#f87171", boxShadow: "0 0 6px rgba(248,113,113,0.5)" }} />
                <div className="flex-1 text-xs">
                  <span className="font-semibold text-red-400">Connection failed</span>
                  <span className="text-white/40 ml-2">{cloudTestError}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(251,191,36,0.05)" }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#fbbf24", boxShadow: "0 0 6px rgba(251,191,36,0.5)" }} />
                <span className="text-xs" style={{ color: "#fbbf24" }}>Not verified — enter your API key and test the connection</span>
              </div>
            )}

            <div className="px-5">
              {/* Provider */}
              <SettingRow label="Provider" description="OpenAI-compatible API">
                <select
                  value={activeProvider}
                  onChange={(e) => {
                    const presets: Record<string, { url: string; model: string }> = {
                      openai:     { url: "https://api.openai.com/v1",                                  model: "gpt-4o-mini" },
                      anthropic:  { url: "https://api.anthropic.com/v1",                               model: "claude-haiku-4-5-20251001" },
                      google:     { url: "https://generativelanguage.googleapis.com/v1beta/openai",     model: "gemini-2.0-flash" },
                      groq:       { url: "https://api.groq.com/openai/v1",                             model: "llama3-8b-8192" },
                      mistral:    { url: "https://api.mistral.ai/v1",                                  model: "mistral-small-latest" },
                      openrouter: { url: "https://openrouter.ai/api/v1",                               model: "openai/gpt-4o-mini" },
                      custom:     { url: "", model: "" },
                    };
                    const p = presets[e.target.value];
                    setCloudTestError(null);
                    update({ ai_cloud_api_url: p.url, ai_cloud_model: p.model, ai_cloud_verified: false });
                  }}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google Gemini</option>
                  <option value="groq">Groq</option>
                  <option value="mistral">Mistral</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="custom">Custom</option>
                </select>
              </SettingRow>

              {/* Custom API URL — only for custom provider */}
              {activeProvider === "custom" && (
                <SettingRow label="API URL" description="Base URL of your OpenAI-compatible endpoint">
                  <input
                    type="text"
                    value={settings.ai_cloud_api_url}
                    onChange={(e) => { setCloudTestError(null); update({ ai_cloud_api_url: e.target.value, ai_cloud_verified: false }); }}
                    placeholder="https://your-api.example.com/v1"
                    className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-56 font-mono"
                    style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                  />
                </SettingRow>
              )}

              {/* API Key */}
              <SettingRow label="API Key" description={apiKeySet ? "Key stored in macOS Keychain" : "Paste your API key"}>
                {apiKeySet ? (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 text-xs font-mono">●●●●●●●●</span>
                    <button onClick={handleDeleteApiKey} className="text-red-400/60 hover:text-red-400 text-xs cursor-pointer">Remove</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="API key…"
                      className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-56 font-mono"
                      style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                    />
                    <button onClick={() => setShowApiKey((v) => !v)} className="text-white/50 hover:text-white/60 text-xs cursor-pointer">{showApiKey ? "Hide" : "Show"}</button>
                    <button onClick={handleSaveApiKey} disabled={!apiKeyInput.trim()} className="btn-ghost text-xs py-1 px-2">Save</button>
                  </div>
                )}
              </SettingRow>

              {/* Model — preset dropdown + "Other…" option (Task 5 fills this in) */}
              <SettingRow label="Model" description="Model name">
                <div className="flex flex-col items-end gap-1.5">
                  {(() => {
                    const presets = MODEL_PRESETS[activeProvider] ?? [];
                    const isOther = presets.length > 0 && !presets.includes(settings.ai_cloud_model);
                    return presets.length > 0 ? (
                      <>
                        <select
                          value={isOther ? "__other__" : settings.ai_cloud_model}
                          onChange={(e) => {
                            if (e.target.value === "__other__") {
                              setCustomModelInput(settings.ai_cloud_model);
                            } else {
                              setCustomModelInput("");
                              update({ ai_cloud_model: e.target.value, ai_cloud_verified: false });
                              setCloudTestError(null);
                            }
                          }}
                          className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none w-40 font-mono"
                          style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                        >
                          {presets.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="__other__">Other…</option>
                        </select>
                        {isOther && (
                          <input
                            type="text"
                            value={customModelInput || settings.ai_cloud_model}
                            onChange={(e) => setCustomModelInput(e.target.value)}
                            onBlur={() => {
                              if (customModelInput.trim()) {
                                update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                                setCloudTestError(null);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && customModelInput.trim()) {
                                update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                                setCloudTestError(null);
                              }
                            }}
                            placeholder="model-id"
                            className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-40 font-mono"
                            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                          />
                        )}
                      </>
                    ) : (
                      <input
                        type="text"
                        value={customModelInput || settings.ai_cloud_model}
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        onBlur={() => {
                          if (customModelInput.trim()) {
                            update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                            setCloudTestError(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && customModelInput.trim()) {
                            update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                            setCloudTestError(null);
                          }
                        }}
                        placeholder="model-name"
                        className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-40 font-mono"
                        style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                      />
                    );
                  })()}
                </div>
              </SettingRow>

              {/* Test Connection */}
              <div className="py-3 flex items-center gap-3">
                <button
                  onClick={() => handleTestConnection("cloud")}
                  disabled={testLoading || !apiKeySet}
                  className="btn-ghost text-xs py-1 px-3"
                >
                  {testLoading ? "Testing…" : "Test Connection"}
                </button>
              </div>

              <p className="text-white/35 text-xs pb-3 leading-relaxed">
                When using Cloud API, your transcription text is sent to the provider. Audio never leaves your device.
              </p>
            </div>
          </div>
        );
      })()}
```

Note: Tasks 4 and 5 are combined here — the "Other…" model logic is included inline in the Model field section above. There is no separate Task 5.

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Verify in dev**

Start `cargo tauri dev`. Select "Cloud API" card. Verify:
- Amber "Not verified" banner shows by default
- Enter API key and click Test Connection:
  - On success → green "Connected · openai · gpt-4o-mini" banner persists after app restart
  - On failure → red "Connection failed" banner with error message
- Change provider → banner resets to amber
- Remove API key → banner resets to amber
- Select "Other…" in model dropdown → text input appears below
- Type custom model, press Enter → model saves, banner resets to amber (re-test required)

- [ ] **Step 7: Run Rust tests**

```bash
cd src-tauri && cargo test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/AiModelsView.tsx
git commit -m "feat: Cloud API status banner with verified persistence and Other model option"
```

---

## Final Verification

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 2: Full Rust test suite**

```bash
cd src-tauri && cargo test 2>&1 | tail -5
```

Expected: all tests pass (133 tests green).

- [ ] **Step 3: Manual acceptance checklist**

Boot `cargo tauri dev` and verify each acceptance criterion from the spec:
- [ ] 3 radio cards replace the segmented control
- [ ] `built_in` backend not visible; opening settings with `ai_backend: "built_in"` in settings.json shows Disabled
- [ ] Selecting a card saves immediately (check settings.json)
- [ ] Disabled: no config section below
- [ ] Ollama selected: "Checking…" → green/amber banner based on actual Ollama state
- [ ] Ollama Refresh re-checks
- [ ] Cloud API amber banner on fresh install
- [ ] Cloud API green banner after successful test, persists after restart
- [ ] Cloud API red banner after failed test
- [ ] Changing key/model/provider resets to amber
- [ ] "Other…" in model dropdown reveals text input, saves on Enter/blur
- [ ] All existing fields (provider, URL, key, test button) still work
