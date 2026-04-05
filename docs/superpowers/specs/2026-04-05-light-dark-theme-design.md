# OmWhisper Light/Dark Theme System

## Overview

Add light mode support alongside the existing dark theme. Dark mode remains default. A theme setting in Settings controls the mode (Dark / Light / System). The home view is redesigned first; other pages follow iteratively.

## Design Decisions

- **CSS custom properties** with `[data-theme="light"]` override on `<html>` — no Tailwind dark: prefix, keeps current approach.
- **Warm off-white light mode** inspired by Wispr Flow (`#FAF8F5` background).
- **Same emerald accent** (`#34d399`) in both modes — high contrast on both dark and light backgrounds.
- **Window size increase** to 1100x750 (min 900x600) matching Flow's spacious layout.
- **Settings-only toggle** — theme selector lives in Settings > General tab.

## Color Tokens

### Dark Mode (current, unchanged)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#1e2229` | Page background |
| `--shadow-dark` | `#111520` | Neumorphic shadow dark |
| `--shadow-light` | `#2b3038` | Neumorphic shadow light |
| `--t1` | `rgba(255,255,255,0.90)` | Primary text |
| `--t2` | `rgba(255,255,255,0.55)` | Secondary text |
| `--t3` | `rgba(255,255,255,0.35)` | Tertiary text |
| `--t4` | `rgba(255,255,255,0.20)` | Disabled text |
| `--accent` | `#34d399` | Primary accent |
| `--accent-glow` | `rgba(52,211,153,0.50)` | Glow effects |
| `--accent-bg` | `rgba(52,211,153,0.12)` | Accent tint background |

### Light Mode (new)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#FAF8F5` | Warm off-white background |
| `--surface` | `#FFFFFF` | Card/panel surfaces |
| `--shadow-dark` | `rgba(0,0,0,0.08)` | Soft shadow |
| `--shadow-light` | `rgba(255,255,255,0.80)` | Highlight edge |
| `--t1` | `rgba(0,0,0,0.87)` | Primary text |
| `--t2` | `rgba(0,0,0,0.60)` | Secondary text |
| `--t3` | `rgba(0,0,0,0.40)` | Tertiary text |
| `--t4` | `rgba(0,0,0,0.20)` | Disabled text |
| `--accent` | `#059669` | Darker emerald for light bg contrast |
| `--accent-glow` | `rgba(5,150,105,0.30)` | Subtle glow |
| `--accent-bg` | `rgba(5,150,105,0.08)` | Light accent tint |
| `--accent-grad-from` | `#34d399` | Gradient start |
| `--accent-grad-to` | `#059669` | Gradient end |
| `--border` | `rgba(0,0,0,0.08)` | Subtle borders |

### Neumorphic Shadows (Light Mode)

Light mode uses softer, flatter shadows instead of the pronounced neumorphic effect:

- `--nm-raised`: `0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)`
- `--nm-raised-sm`: `0 1px 2px rgba(0,0,0,0.06)`
- `--nm-pressed`: `inset 0 2px 4px rgba(0,0,0,0.06)`
- `--nm-pressed-sm`: `inset 0 1px 2px rgba(0,0,0,0.04)`

## Files Changed

### Phase 1: Home View (this spec)

| File | Change |
|------|--------|
| `src/styles/globals.css` | Add `[data-theme="light"]` token overrides |
| `src-tauri/tauri.conf.json` | Window: 1100x750, min 900x600 |
| `src-tauri/src/settings.rs` | Add `theme: String` field (values: `"dark"`, `"light"`, `"system"`) |
| `src/App.tsx` | Read theme from settings, apply `data-theme` on `<html>`, listen for system preference changes |
| `src/components/HomeView.tsx` | Replace hardcoded colors with CSS variables where needed |
| `src/components/Settings.tsx` | Add theme selector dropdown in General tab |
| `src/components/Sidebar.tsx` | Ensure sidebar colors use CSS variables |

### Phase 2+ (future, not in this spec)

- AiModelsView, TranscriptionHistory, Vocabulary, Onboarding
- Overlay window theming

## Theme Application Logic

```
On app start:
  1. Load theme from settings ("dark" | "light" | "system")
  2. If "system", check window.matchMedia("(prefers-color-scheme: dark)")
  3. Set document.documentElement.dataset.theme = resolved theme
  4. Listen for system preference changes (if "system" mode)

On settings change:
  1. Save to settings.json via update_settings
  2. Re-apply data-theme attribute
```

## Window Configuration

```json
{
  "width": 1100,
  "height": 750,
  "minWidth": 900,
  "minHeight": 600
}
```

Background color in `tauri.conf.json` should match default dark mode: `#1e2229`.

## Settings Schema Addition

```rust
#[serde(default = "default_theme")]
pub theme: String,
// default: "dark"
```

Settings UI: segmented control or dropdown in General tab with options Dark / Light / System.

## Scope Boundaries

- This spec covers **theme infrastructure + home view only**.
- Other views adopt the theme automatically through CSS variables but may need hardcoded color fixes later.
- No changes to the overlay window in this phase.
- No changes to sidebar navigation structure.
- No changes to component layout or functionality.
