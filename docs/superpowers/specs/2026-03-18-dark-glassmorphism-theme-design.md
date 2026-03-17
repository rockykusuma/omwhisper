# Dark Glassmorphism Theme — Design Spec

**Date:** 2026-03-18
**Branch:** feature/design-updates
**Status:** Approved

---

## Overview

Add a Dark Glassmorphism visual theme to OmWhisper alongside the existing Charcoal Neomorphism theme. The two themes will be presented in a reorganized theme picker with separate labeled sections. The Emerald and Warm Amber neomorphism variants are removed to keep the picker clean.

---

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Accent color | Emerald `#34d399` | Brand consistency |
| Theme picker layout | Two sections (Neomorphism / Glassmorphism) | Cleaner grouping; room for future glass variants |
| Existing neomorphism themes | Keep Charcoal only, remove Emerald + Warm Amber | Light themes feel out of place next to a dark glass theme |
| Background style | Gradient mesh with soft emerald/teal orbs | Provides the depth backdrop-filter blur needs to look like real glass |
| Implementation approach | CSS theme-level overrides via `[data-theme="dark-glass"]` | Zero React component changes; all styling in one CSS block |

---

## Color Tokens

All tokens live in `src/styles/globals.css` under `[data-theme="dark-glass"]`.

```css
[data-theme="dark-glass"] {
  --bg:           #050d12;
  --glass-bg:     rgba(255, 255, 255, 0.06);
  --glass-border: rgba(255, 255, 255, 0.10);
  --glass-blur:   blur(16px);

  --shadow-dark:  rgba(0, 0, 0, 0.40);
  --shadow-light: rgba(255, 255, 255, 0.04);

  --t1: rgba(255, 255, 255, 0.90);
  --t2: rgba(255, 255, 255, 0.55);
  --t3: rgba(255, 255, 255, 0.35);
  --t4: rgba(255, 255, 255, 0.20);

  --accent:           #34d399;
  --accent-glow:      rgba(52, 211, 153, 0.50);
  --accent-glow-weak: rgba(52, 211, 153, 0.25);
  --accent-bg:        rgba(52, 211, 153, 0.12);
  --accent-grad-from: #3de0a8;
  --accent-grad-to:   #25b87e;
}
```

---

## Background Mesh

Applied to `html, body` when `[data-theme="dark-glass"]` is active. Three radial gradient orbs over a near-black base:

```css
[data-theme="dark-glass"] body {
  background:
    radial-gradient(ellipse 60% 40% at 80% 10%,  rgba(52, 211, 153, 0.12) 0%, transparent 70%),
    radial-gradient(ellipse 55% 45% at 15% 85%,  rgba(13, 148, 136, 0.08) 0%, transparent 70%),
    radial-gradient(ellipse 70% 60% at 50% 50%,  rgba(30,  58,  95, 0.15) 0%, transparent 70%),
    #050d12;
  background-attachment: fixed;
}
```

- **Orb 1** — emerald `#34d399` at 12%, top-right
- **Orb 2** — teal `#0d9488` at 8%, bottom-left
- **Orb 3** — dark navy `#1e3a5f` at 15%, center

---

## Component Overrides

All overrides are scoped to `[data-theme="dark-glass"]` in `globals.css`. They replace the neumorphic `box-shadow` without removing the `--nm-*` variables (which remain for the Charcoal theme). `border-radius` is intentionally not re-declared in any override — it is inherited from the base class definitions and applies unchanged in the glass theme.

### `.card` (raised panel)
```css
[data-theme="dark-glass"] .card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.40);
}
```

### `.card-inset` (inset well)

The blur is intentionally hardcoded to `8px` (half that of `.card`). Inset wells sit visually closer to the content layer; using the full `16px` would create a stacked-glass visual noise effect where content inside the well appears doubly blurred.

```css
[data-theme="dark-glass"] .card-inset {
  background: rgba(0, 0, 0, 0.20);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.30);
}
```

### `.btn-primary` (primary action)
```css
[data-theme="dark-glass"] .btn-primary {
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 0 20px var(--accent-glow-weak), 0 4px 12px rgba(0, 0, 0, 0.30);
}
[data-theme="dark-glass"] .btn-primary:hover:not(:disabled) {
  box-shadow: 0 0 28px var(--accent-glow), 0 4px 16px rgba(0, 0, 0, 0.40);
}
[data-theme="dark-glass"] .btn-primary:active:not(:disabled) {
  box-shadow: 0 0 12px var(--accent-glow-weak), inset 0 2px 4px rgba(0, 0, 0, 0.30);
}
```

### `.btn-ghost` (secondary button)
```css
[data-theme="dark-glass"] .btn-ghost {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--glass-border);
  box-shadow: none;
}
[data-theme="dark-glass"] .btn-ghost:hover {
  background: rgba(255, 255, 255, 0.09);
  box-shadow: none;
}
[data-theme="dark-glass"] .btn-ghost:active {
  background: rgba(255, 255, 255, 0.03);
  box-shadow: none;
}
```

---

## Theme System Changes

### `src/hooks/useTheme.ts`

- **Type:** `"charcoal" | "dark-glass"`
- **`ThemeMeta`:** Add `style: "neomorphism" | "glassmorphism"` field
- **`THEMES` array:** Remove `emerald` and `warm-amber`; add `dark-glass`

```ts
export type Theme = "charcoal" | "dark-glass";

export interface ThemeMeta {
  id: Theme;
  label: string;
  bg: string;
  accent: string;
  dark: boolean;
  style: "neomorphism" | "glassmorphism";
}

export const THEMES: ThemeMeta[] = [
  { id: "charcoal",   label: "Charcoal",   bg: "#1e2229", accent: "#34d399", dark: true, style: "neomorphism"   },
  { id: "dark-glass", label: "Dark Glass", bg: "#050d12", accent: "#34d399", dark: true, style: "glassmorphism" },
];
```

- Default theme: `"charcoal"` (unchanged)
- `applyTheme()` and `initTheme()` require no logic changes — they just set `data-theme`
- **Migration:** Users who previously had `emerald` or `warm-amber` saved in localStorage will silently fall back to `"charcoal"` via the existing `THEMES.find` guard in both `initTheme()` and `useTheme()`. No additional migration code is needed — the guard is already the correct mechanism. The TypeScript cast `localStorage.getItem(STORAGE_KEY) as Theme | null` is safe because the guard immediately validates the cast value against the `THEMES` array before use.

### `src/components/Settings.tsx`

The theme picker section is reorganized to group themes by `style`. The existing flat `flex` row is replaced with a `flex-col` container holding two groups, each with a label and its own inner `flex` row of swatches:

```tsx
<div className="flex flex-col gap-4">
  {(["neomorphism", "glassmorphism"] as const).map((style) => (
    <div key={style}>
      <p className="text-[10px] uppercase tracking-widest mb-2 font-mono" style={{ color: "var(--t3)" }}>
        {style === "neomorphism" ? "Neomorphism" : "Glassmorphism"}
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        {THEMES.filter((t) => t.style === style).map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            title={t.label}
            className="flex flex-col items-center gap-1.5 cursor-pointer group"
            aria-pressed={theme === t.id}
          >
            <div
              className="w-11 h-11 rounded-xl transition-all duration-200 relative"
              style={{
                background: t.bg,
                boxShadow: theme === t.id
                  ? `0 0 0 2.5px ${t.accent}, 0 0 14px ${t.accent}55`
                  : "inset 2px 2px 5px rgba(0,0,0,0.25), inset -2px -2px 5px rgba(255,255,255,0.12)",
              }}
            >
              <span
                className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full"
                style={{ background: t.accent }}
              />
            </div>
            <span
              className="text-[10px] font-mono transition-colors"
              style={{ color: theme === t.id ? "var(--accent)" : "var(--t3)" }}
            >
              {t.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  ))}
</div>
```

The swatch `<button>` block (with `aria-pressed`, accent-ring `boxShadow`, accent dot, and label) is identical to the existing implementation at `Settings.tsx:263–291`.

---

## Files Changed

| File | Change |
|---|---|
| `src/styles/globals.css` | Add `[data-theme="dark-glass"]` token block + background mesh + component overrides; remove `emerald` and `warm-amber` blocks |
| `src/hooks/useTheme.ts` | Update `Theme` type, add `style` field to `ThemeMeta`, update `THEMES` array |
| `src/components/Settings.tsx` | Update theme picker to render two grouped sections |

---

## Out of Scope

- Light glassmorphism variant (can be added later as a 3rd theme)
- Glassmorphism-specific overrides for individual named components (Sidebar, TranscriptionView, etc.) — the `.card` / `.btn-*` class overrides cover the full surface
- Windows-specific backdrop-filter fallback (Tauri uses WebView2 which supports backdrop-filter on Windows 11)
- `background-attachment: fixed` behavior on Windows: in WebView2, `fixed` attachment is relative to the WebView container boundary rather than the viewport during window resize. This causes a minor cosmetic artefact (orbs stay static rather than repositioning smoothly) but is acceptable for OmWhisper's fixed-size window.
