# Smart Dictation Backend UI Redesign — Spec

## Goal

Replace the current segmented control backend selector and flat config rows in the Smart Dictation / AI tab with a clearer radio-card selector and a status-banner-driven config section that makes connection state obvious and guides new users through setup.

---

## Context

**File:** `src/components/AiModelsView.tsx` — AI sub-tab rendered inside the Settings panel.

**Current problems:**
- Segmented control (`Disabled / Built-in / On-Device / Cloud API`) looks like navigation tabs, not a selection control — users click expecting to configure, not select.
- Config fields are always visible as flat rows regardless of connection state — no indication of whether the backend is actually working.
- "Built-in LLM" (qwen2.5-0.5b) produces low-quality output and causes user confusion — should be hidden.
- Cloud API model is locked to a short preset list per provider — no way to enter a custom model ID.
- Test Connection result is ephemeral (disappears on reopen) — users must re-test every session even when nothing changed.

---

## Changes

### 1. Backend Selector — Radio Cards

Replace the segmented control with **3 radio cards** laid out in a horizontal row.

| Card | Icon | Name | Description |
|------|------|------|-------------|
| 1 | 🚫 | Disabled | No AI polishing |
| 2 | 🦙 | On-Device (Ollama) | Local model, private |
| 3 | ☁️ | Cloud API | OpenAI, Groq, or custom |

**Each card contains:**
- Icon (emoji)
- Name (bold, ~12px)
- 1-line description (~10px, muted)
- Live status badge (e.g. "Running", "Setup needed", "Connected", "Needs key")

**Selection state:**
- Selected card: purple border (`rgba(139,92,246,0.5)`) + purple tinted background + filled radio dot
- Unselected: subtle border, empty radio dot

**Built-in backend:**
- `built_in` value remains in `settings.rs` and all Rust/TS types
- Hidden from the selector UI — not rendered as a card
- If a user somehow has `ai_backend = "built_in"` in their settings, treat it as `"disabled"` in the UI (do not crash)

---

### 2. Config Section — Status Banner

A config block appears **below the selector** only when Ollama or Cloud API is selected. Disabled shows nothing.

#### 2a. Ollama Config

**When connected** (Ollama server reachable):
- Green hero banner: pulsing green dot + "Connected · `{model}` · `{url}` · `{N}` models available" + "Refresh" button
- Below banner:
  - **Model** row: dropdown populated from available Ollama models
  - **Server URL** row: text input, labelled "Advanced" in description

**When not running** (Ollama server unreachable):
- Amber hero banner: amber dot + "Ollama not detected" + "Refresh" button
- Below banner: inline 3-step setup guide:
  1. Download from ollama.com
  2. Run: `ollama pull llama3.2`
  3. Click Refresh above

The connection check happens:
- On mount when Ollama is the selected backend
- When the user clicks Refresh
- Existing `check_ollama_status` and `get_ollama_models` commands are reused as-is

**Loading state:** While the initial on-mount check (or any Refresh) is in-flight, render a neutral "Checking…" banner state. The Refresh button is disabled during any active check.

#### 2b. Cloud API Config

**Banner state** (driven by `ai_cloud_verified` setting):
- `ai_cloud_verified = true`: Green banner → "Connected · `{provider}` · `{model}`"
- `ai_cloud_verified = false` (default): Amber/neutral banner → "Not verified — enter your API key and test the connection"
- After a failed Test Connection: Red banner → "Connection failed: `{error message}`"
- While Test Connection is in-flight: banner remains in its current state (amber, green, or red); button label changes to "Testing…" and is disabled; banner updates only on response

**Config fields** (always shown below banner when Cloud API selected):
- **Provider** dropdown: OpenAI, Anthropic, Google, Groq, Mistral, OpenRouter, Custom
  - Selecting a provider preset auto-fills the API URL (existing behavior, unchanged)
- **API Key** field: masked text input (existing behavior, unchanged)
- **Model** field:
  - Dropdown with provider-specific presets (existing `MODEL_PRESETS`, unchanged)
  - **New:** Last option in every provider's dropdown is `"Other…"` (sentinel value `"__other__"`)
  - When "Other…" is selected: a text input appears below the dropdown for entering a custom model ID
  - The text input uses a local `customModelInput` state (does not write to settings while typing); saves to `ai_cloud_model` on blur or Enter key
  - When the user switches from "Other…" back to a preset in the same dropdown, `customModelInput` is cleared and `ai_cloud_model` is set to the selected preset
  - When the provider changes (`ai_cloud_api_url` changes), `customModelInput` is cleared (existing behavior for the `custom` provider case)
- **Test Connection** button:
  - On success: sets `ai_cloud_verified = true`, updates banner to green, saves provider+model to display in banner
  - On failure: sets `ai_cloud_verified = false`, updates banner to red with error message
  - `ai_cloud_verified` resets to `false` whenever `ai_cloud_model` or `ai_cloud_api_url` changes (detected via `useEffect` on those settings fields). For API key changes: since the key is stored in the macOS Keychain (not in `AppSettings`), the reset is triggered inside the `save_cloud_api_key` and `delete_cloud_api_key_cmd` invocation handlers in the component, immediately before or after the invoke call.

**Green banner cold restart:** On app reopen with `ai_cloud_verified = true`, the banner derives `{provider}` from the existing `ai_cloud_api_url` field (using the same URL-matching logic already in the component) and `{model}` from the existing `ai_cloud_model` field. No additional persistence is needed.

**Ollama on-mount check:** Use a separate `useEffect` with `[settings?.ai_backend]` as the dependency. When `ai_backend` becomes `"ollama"`, call `refreshOllamaStatus()`. This fires both on initial load (if Ollama is already selected) and whenever the user switches to the Ollama card.

**Privacy notice** (existing, unchanged):
> "When using Cloud API, your transcription text is sent to the provider. Audio never leaves your device."

---

### 3. Settings Changes

Add one new field to `Settings` in `src-tauri/src/settings.rs`:

```rust
pub ai_cloud_verified: bool,  // default: false
```

Default: `false`.

Resets to `false` in the frontend whenever `ai_cloud_model` or `ai_cloud_api_url` changes (via `useEffect`), or whenever the API key is saved/deleted (inside those invocation handlers).

No other settings fields change.

---

## What Does NOT Change

- All existing Tauri commands (`check_ollama_status`, `get_ollama_models`, `test_ai_connection`, `save_cloud_api_key`, etc.) — no changes to Rust command signatures or behavior
- `MODEL_PRESETS` constant — add "Other…" only in the rendering logic, not the data
- Cloud API URL auto-fill on provider selection — unchanged
- Custom provider (free-text URL) behavior — unchanged
- Smart Dictation section below the backend config (Default Style, custom styles, translate language) — unchanged
- Whisper tab — unchanged

---

## File Scope

- **`src/components/AiModelsView.tsx`** — all UI changes
- **`src-tauri/src/settings.rs`** — add `ai_cloud_verified: bool` field and its `Default` impl (`false`)
- **`src/types/index.ts`** — add `ai_cloud_verified: boolean` to the `AppSettings` interface

---

## Acceptance Criteria

- [ ] Segmented control is gone; 3 radio cards are rendered in its place
- [ ] `built_in` option is not visible in the UI; settings with `ai_backend = "built_in"` display as disabled without errors
- [ ] Selecting a card immediately updates `ai_backend` in settings
- [ ] Disabled: no config section rendered below
- [ ] Ollama connected: green banner with model/url/count visible
- [ ] Ollama not running: amber banner with 3-step guide visible
- [ ] Ollama Refresh button re-runs status check
- [ ] Cloud API: banner starts amber ("Not verified") on fresh install
- [ ] Cloud API: green banner after successful Test Connection, persists across app restarts
- [ ] Cloud API: red banner with error message after failed Test Connection
- [ ] Cloud API: `ai_cloud_verified` resets to false when API key, model, or provider URL is changed
- [ ] Cloud API: "Other…" option appears at bottom of every provider's model dropdown
- [ ] Cloud API: selecting "Other…" reveals a text input; value saves on blur/Enter
- [ ] All existing Cloud API fields (provider, API URL, key, test button) still function correctly
