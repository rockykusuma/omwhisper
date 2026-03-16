# AI Models Unified Tab Design

**Date:** 2026-03-16
**Status:** Approved
**Scope:** Frontend refactor — no backend changes required

---

## Problem

OmWhisper currently splits AI-related configuration across two disconnected locations:

- **Models** — a top-level sidebar nav item for managing Whisper transcription models (download, delete, switch active model).
- **Settings → AI** — a sub-tab buried inside Settings for configuring Smart Dictation (AI backend, API keys, polish styles).

These two screens both deal with the AI layer of the app yet are separated by three navigation levels. Users who want to configure Smart Dictation must know to look inside Settings. The Models tab, meanwhile, occupies prime top-level real estate for a screen most users visit only once during initial setup.

---

## Decision

Merge both screens into a single top-level **AI Models** sidebar item. Remove the AI sub-tab from Settings. The unified screen is split into two horizontal pill sub-tabs: **Whisper** (model management) and **Smart Dictation** (AI polish config).

---

## Navigation Architecture

### Sidebar — unchanged count (5 items)

| Before | After |
|--------|-------|
| Home | Home |
| History | History |
| **Models** (Box icon) | **AI Models** (Brain icon) |
| Vocabulary | Vocabulary |
| Settings | Settings |

### Settings sub-tabs — 6 → 5

| Before | After |
|--------|-------|
| General | General |
| Audio | Audio |
| Transcription | Transcription (modified — see below) |
| **AI** | ~~AI~~ (removed) |
| Shortcuts | Shortcuts |
| About | About |

---

## AI Models Screen

### Layout

The screen uses two **horizontal pill tabs** at the top of the content area. Pill tabs (not a left sub-sidebar) are used because there are only 2 tabs — a left sidebar would be overkill.

```
[ Whisper ]  [ Smart Dictation ]
─────────────────────────────────
<content for active tab>
```

### Tab 1 — Whisper

Content is identical to the current `ModelManager.tsx`. No logic or visual changes:

- Header: "Models" title + disk usage subtitle (`X MB used on disk`)
- Recommendation card (system spec + recommended model + switch/download CTA)
- Model catalog grouped by category: English Only / Multilingual / Turbo
- Per-model row: name, badges (Active, Recommended, EN), description, size, Download / Set Active / Delete actions + progress bar during download

### Tab 2 — Smart Dictation

Content is identical to the current Settings → AI sub-tab. No logic or visual changes:

- Section: **AI Processing** — backend selector (Disabled / On-Device / Cloud API)
- Conditional section: **Ollama** (when backend = ollama) — status, model dropdown, test connection, setup guide
- Conditional section: **Cloud API** (when backend = cloud) — provider preset, API key field, model field, test connection, privacy notice
- Section: **Smart Dictation** — shortcut display (⌘⇧B), default style dropdown, translate target language (conditional), timeout
- Section: **Polish Styles** — built-in style list, custom style CRUD (add name + system prompt, delete)

---

## Settings → Transcription Tab Change

The Transcription sub-tab currently shows an "Active Model" row displaying the active Whisper model name as a read-only badge. This is now redundant since model management lives in AI Models.

**Change:** Replace the "Active Model" `SettingRow` with a small navigation link:

```
Active Model        tiny.en    Manage models →
```

Clicking "Manage models →" navigates to the AI Models screen (Whisper sub-tab). The model name remains visible as context but is no longer the primary interaction point.

Implementation: the Settings component receives an `onNavigate` prop (new) and calls `onNavigate("models:whisper")` when the link is clicked. The existing `navigate()` helper in `App.tsx` already handles colon-separated `"view:tab"` syntax — it splits on `:`, calls `setActiveView("models")` and `setSettingsInitialTab("whisper")` — so no changes are needed to `navigate()` itself.

---

## Props and Component Changes

### `Sidebar.tsx`

```tsx
// View type: "models" stays as-is (the route ID does not change)
export type View = "home" | "history" | "models" | "vocabulary" | "license" | "settings";

// NAV_ITEMS: rename label and icon
{ id: "models", icon: Brain, label: "AI Models" }

// Import: remove Box, add Brain from lucide-react
```

### `ModelManager.tsx` → rename to `AiModelsView.tsx`

New component wraps two pill sub-tabs. Props:

```tsx
interface AiModelsViewProps {
  activeModel: string;
  onModelChange: (name: string) => void;
  initialTab?: "whisper" | "smart-dictation";  // for deep-linking from "Manage models →"
}
```

- Internal tab state: `"whisper" | "smart-dictation"`, initialised from `initialTab` (defaults to `"whisper"`)
- `"whisper"` sub-tab renders the existing ModelManager content, receiving `activeModel` and `onModelChange` as before
- `"smart-dictation"` sub-tab owns its own state and invoke calls (self-contained, no shared state with Settings):
  - `get_settings` / `update_settings`
  - `check_ollama_status` / `get_ollama_models`
  - `get_polish_styles` / `add_custom_style` / `remove_custom_style`
  - `get_cloud_api_key_status` / `save_cloud_api_key` / `delete_cloud_api_key_cmd`
  - `test_ai_connection`

### `Settings.tsx`

- Remove `"ai"` from `TABS` array and `Tab` type: `type Tab = "general" | "audio" | "transcription" | "shortcuts" | "about"`
- Remove all AI sub-tab state: `ollamaStatus`, `builtInStyles`, `customStyles`, `apiKeySet`, `apiKeyInput`, `showApiKey`, `newStyleName`, `newStylePrompt`, `testResult`, `testLoading`
- Remove AI sub-tab handler functions: `refreshOllamaStatus`, `handleSaveApiKey`, `handleDeleteApiKey`, `handleTestConnection`, `handleAddCustomStyle`, `handleRemoveCustomStyle`
- Remove AI-related `invoke` calls from `useEffect`: `get_cloud_api_key_status`, `get_polish_styles`
- In Transcription tab: replace the "Active Model" `SettingRow` with a custom row showing the active model name and a "Manage models →" link that calls `onNavigate("models:whisper")`
- Add `onNavigate: (target: string) => void` as a new required prop to `SettingsPanel`

### `App.tsx`

- Update import: `ModelManager` → `AiModelsView`
- Pass `initialTab` from the existing `settingsInitialTab` state slot to `AiModelsView`:
  ```tsx
  {activeView === "models" && (
    <AiModelsView
      activeModel={activeModel}
      onModelChange={async (name) => { ... }}
      initialTab={settingsInitialTab as "whisper" | "smart-dictation" | undefined}
    />
  )}
  ```
- Pass `onNavigate={navigate}` to `SettingsPanel`:
  ```tsx
  {activeView === "settings" && (
    <SettingsPanel
      initialTab={settingsInitialTab as any}
      onNavigate={navigate}
    />
  )}
  ```
- Update stale error message (line 117):
  ```tsx
  // Before:
  setMicError("Smart Dictation needs AI setup. Open Settings → AI Processing.");
  // After:
  setMicError("Smart Dictation needs AI setup. Open AI Models → Smart Dictation.");
  ```

---

## What Does NOT Change

- Sidebar route ID `"models"` is kept — no URL/state migration needed
- All Tauri backend commands unchanged
- `ModelManager` download/delete/recommend logic is preserved (moves into Whisper sub-tab)
- All Settings AI logic is preserved (moves into Smart Dictation sub-tab)
- History, Vocabulary, Home, Shortcuts, About are unaffected

---

## Files Affected

| File | Action |
|------|--------|
| `src/components/ModelManager.tsx` | Rename → `AiModelsView.tsx`; add pill tab wrapper + `initialTab` prop; move Settings AI content into Smart Dictation sub-tab |
| `src/components/Settings.tsx` | Remove AI sub-tab + all its state/handlers; add `onNavigate` prop; replace Active Model row in Transcription tab |
| `src/components/Sidebar.tsx` | Rename label `"Models"` → `"AI Models"`; swap `Box` icon for `Brain` |
| `src/App.tsx` | Update import; pass `initialTab` to `AiModelsView`; pass `onNavigate` to `SettingsPanel`; fix stale error message |
