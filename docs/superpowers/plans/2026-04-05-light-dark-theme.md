# Light/Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add light mode alongside the existing dark theme, controlled by a setting (Dark/Light/System), with warm off-white colors inspired by Wispr Flow.

**Architecture:** CSS custom properties with `[data-theme="light"]` overrides on `<html>`. Theme preference stored in Rust settings and synced to the frontend via the existing `useTheme` hook. Window size increased to 1100x750.

**Tech Stack:** CSS custom properties, React hooks, Tailwind CSS v4, Rust/Tauri settings

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/styles/globals.css` | Modify | Add light theme token block |
| `src/hooks/useTheme.ts` | Modify | Support "dark"/"light"/"system" modes, read from Tauri settings |
| `src/components/Settings.tsx` | Modify | Add theme selector in General tab |
| `src-tauri/src/settings.rs` | Modify | Add `theme` field |
| `src-tauri/tauri.conf.json` | Modify | Window size 1100x750 |
| `src/components/HomeView.tsx` | Modify | Fix hardcoded colors to use CSS variables |
| `src/components/Sidebar.tsx` | Modify | Fix hardcoded colors to use CSS variables |

---

### Task 1: Add light theme CSS tokens

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add light theme token block after the charcoal theme block (after line 60)**

Add this after the closing `}` of the charcoal theme block (line 60):

```css
/* ══ THEME 1 — Light (warm off-white) ═══════════════════════════════════ */
[data-theme="light"] {
  --bg:           #FAF8F5;
  --shadow-dark:  rgba(0, 0, 0, 0.07);
  --shadow-light: rgba(255, 255, 255, 0.80);

  --t1: rgba(0, 0, 0, 0.87);
  --t2: rgba(0, 0, 0, 0.60);
  --t3: rgba(0, 0, 0, 0.40);
  --t4: rgba(0, 0, 0, 0.20);

  --accent:           #059669;
  --accent-glow:      rgba(5, 150, 105, 0.25);
  --accent-glow-weak: rgba(5, 150, 105, 0.12);
  --accent-bg:        rgba(5, 150, 105, 0.08);
  --accent-grad-from: #34d399;
  --accent-grad-to:   #059669;
}

/* ── Surface tokens (light) ─────────────────────────────────────────── */
[data-theme="light"] {
  --surface:        #FFFFFF;
  --surface-border: rgba(0, 0, 0, 0.06);
  --surface-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
  --surface-blur:   blur(12px);
}

/* ── Neumorphic overrides (light) — softer, flatter shadows ─────────── */
[data-theme="light"] {
  --nm-raised:     0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
  --nm-raised-sm:  0 1px 3px rgba(0, 0, 0, 0.05);
  --nm-pressed:    inset 0 2px 4px rgba(0, 0, 0, 0.05);
  --nm-pressed-sm: inset 0 1px 2px rgba(0, 0, 0, 0.04);
}
```

- [ ] **Step 2: Add a `--border` token to both themes**

In the charcoal block (inside the first `:root, [data-theme="charcoal"]` block, after `--accent-grad-to`):

```css
  --border: rgba(255, 255, 255, 0.08);
```

In the light theme block (inside `[data-theme="light"]`, after `--accent-grad-to`):

```css
  --border: rgba(0, 0, 0, 0.08);
```

- [ ] **Step 3: Verify the file renders without errors**

Open the app — dark mode should look identical to before (no visual changes).

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat: add light theme CSS tokens alongside existing dark theme"
```

---

### Task 2: Add theme field to Rust settings

**Files:**
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Add the `theme` field to the Settings struct**

After the `overlay_style` field (line 96), add:

```rust
    /// UI theme: "dark" | "light" | "system"
    #[serde(default = "default_theme")]
    pub theme: String,
```

- [ ] **Step 2: Add the default function**

After `fn default_vad_engine()` (line 152), add:

```rust
fn default_theme() -> String { "dark".to_string() }
```

- [ ] **Step 3: Add to Default impl**

In the `impl Default for Settings` block, after `overlay_style: "micro".to_string(),` (line 196), add:

```rust
            theme: "dark".to_string(),
```

- [ ] **Step 4: Run tests**

```bash
cd src-tauri && cargo test -p omwhisper --lib settings
```

Expected: all settings tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat: add theme setting (dark/light/system) with dark default"
```

---

### Task 3: Update useTheme hook for dark/light/system

**Files:**
- Modify: `src/hooks/useTheme.ts`

- [ ] **Step 1: Replace the entire file with the new implementation**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "charcoal" | "light";

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "light") return "light";
  if (pref === "dark") return "charcoal";
  // "system"
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "charcoal"
    : "light";
}

function applyResolved(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", resolved);
}

let currentPref: ThemePreference = "dark";

export function applyThemePreference(pref: ThemePreference): void {
  currentPref = pref;
  applyResolved(resolveTheme(pref));
}

export function initTheme(): void {
  // Start with dark, then async-load from settings
  applyResolved("charcoal");

  invoke<{ theme: string }>("get_settings")
    .then((s) => {
      const pref = (["dark", "light", "system"].includes(s.theme) ? s.theme : "dark") as ThemePreference;
      applyThemePreference(pref);
    })
    .catch(() => {});

  // Listen for settings changes (e.g. from tray menu)
  listen("settings-changed", () => {
    invoke<{ theme: string }>("get_settings")
      .then((s) => {
        const pref = (["dark", "light", "system"].includes(s.theme) ? s.theme : "dark") as ThemePreference;
        applyThemePreference(pref);
      })
      .catch(() => {});
  });

  // Listen for system preference changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentPref === "system") {
      applyResolved(resolveTheme("system"));
    }
  });
}
```

- [ ] **Step 2: Verify no import errors in App.tsx**

`App.tsx` imports `initTheme` from this file — the export name is unchanged so it should work.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTheme.ts
git commit -m "feat: useTheme hook supports dark/light/system with Tauri settings sync"
```

---

### Task 4: Update window size

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Update the main window dimensions**

Change lines 19-22 from:

```json
        "width": 780,
        "height": 560,
        "minWidth": 680,
        "minHeight": 480,
```

To:

```json
        "width": 1100,
        "height": 750,
        "minWidth": 900,
        "minHeight": 600,
```

- [ ] **Step 2: Update backgroundColor to match dark default**

Change line 27 from:

```json
        "backgroundColor": "#0a0f0d"
```

To:

```json
        "backgroundColor": "#1e2229"
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: increase window to 1100x750 matching Wispr Flow layout"
```

---

### Task 5: Add theme selector in Settings General tab

**Files:**
- Modify: `src/components/Settings.tsx`

- [ ] **Step 1: Import applyThemePreference**

Add to the import section at the top of Settings.tsx:

```typescript
import { applyThemePreference, type ThemePreference } from "../hooks/useTheme";
```

- [ ] **Step 2: Find the General tab section**

Locate `{activeTab === "general" && (` (line 260). Inside the first `<div className="card px-5">` block, add the theme selector as the first `<SettingRow>`:

```tsx
              <SettingRow label="Theme" description="App appearance">
                <select
                  value={settings.theme ?? "dark"}
                  onChange={(e) => {
                    const pref = e.target.value as ThemePreference;
                    applyThemePreference(pref);
                    update({ theme: pref });
                  }}
                  className="text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
                  style={{ background: "var(--bg)", color: "var(--t1)", boxShadow: "var(--nm-pressed-sm)" }}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </SettingRow>
```

- [ ] **Step 3: Verify theme switching works**

1. Open Settings > General
2. Select "Light" — background should change to warm off-white
3. Select "Dark" — should return to charcoal
4. Select "System" — should match OS preference

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: add theme selector (Dark/Light/System) in Settings General tab"
```

---

### Task 6: Fix hardcoded colors in HomeView

**Files:**
- Modify: `src/components/HomeView.tsx`

- [ ] **Step 1: Audit and fix hardcoded color values**

Search for hardcoded colors in HomeView.tsx and replace with CSS variable references. Key patterns to fix:

1. `bg-white/[0.08]` waveform bars → `style={{ background: "var(--t4)" }}`
2. `text-white/25` duration text → `style={{ color: "var(--t4)" }}`
3. `text-white/60` or `text-white/40` → use `text-t2` or `text-t3` Tailwind classes
4. Any `bg-white/10` or similar backgrounds → `style={{ background: "var(--border)" }}`
5. Inline `color: "white"` or `color: "#fff"` → `color: "var(--t1)"`
6. `border-white/10` → `style={{ borderColor: "var(--border)" }}`

Note: Keep state-specific colors like red (`rgb(239,68,68)`) for recording and violet (`rgb(139,92,246)`) for smart dictation — these are semantic, not theme-dependent.

- [ ] **Step 2: Test in both themes**

Switch between Dark and Light in Settings. Verify:
- Record button looks correct in both modes
- Waveform bars are visible in both modes
- Text is readable in both modes
- Status badges (accessibility, mic) are visible in both modes

- [ ] **Step 3: Commit**

```bash
git add src/components/HomeView.tsx
git commit -m "fix: replace hardcoded colors in HomeView with theme-aware CSS variables"
```

---

### Task 7: Fix hardcoded colors in Sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Audit and fix hardcoded colors**

Search for hardcoded color values in Sidebar.tsx. Common patterns:

1. `bg-white/10` hover states → `style={{ background: "var(--accent-bg)" }}`
2. `text-white/60` inactive labels → use `text-t2` class
3. `border-white/5` dividers → `style={{ borderColor: "var(--border)" }}`
4. Any hardcoded `#hex` values for backgrounds → use `var(--bg)` or `var(--surface)`

- [ ] **Step 2: Test sidebar in both themes**

Verify:
- Sidebar background matches the page background
- Active nav item is clearly highlighted
- ॐ logo is visible in both modes
- Usage bar and version text are readable in both modes

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "fix: replace hardcoded colors in Sidebar with theme-aware CSS variables"
```

---

### Task 8: Final integration test and commit

- [ ] **Step 1: Full app test in dark mode**

1. Launch app — should start in dark mode (default)
2. Navigate all sidebar items
3. Record audio — verify waveform, status indicators
4. Check Settings — theme selector shows "Dark"

- [ ] **Step 2: Full app test in light mode**

1. Switch to Light in Settings
2. Verify warm off-white background
3. Navigate all sidebar items — text readable, icons visible
4. Record audio — verify visual feedback works
5. Check all cards, buttons, dropdowns render correctly

- [ ] **Step 3: System mode test**

1. Switch to System
2. Toggle macOS appearance (System Settings > Appearance)
3. App should follow system preference

- [ ] **Step 4: Restart persistence test**

1. Set theme to Light
2. Quit and relaunch app
3. App should start in light mode (read from settings.json)

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: theme integration fixes from testing"
```
