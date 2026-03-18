# Dark Glassmorphism Theme Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dark Glassmorphism visual theme alongside the existing Charcoal Neomorphism theme, remove the unused Emerald and Warm Amber light themes, and reorganize the theme picker into two labeled sections.

**Architecture:** All glass styling lives in a single `[data-theme="dark-glass"]` CSS block in `globals.css` that overrides `.card`, `.card-inset`, `.btn-primary`, and `.btn-ghost` — zero React component changes needed beyond the theme picker UI. The `useTheme.ts` hook adds a `style` discriminator field to `ThemeMeta` which the Settings picker uses to group themes into two sections.

**Tech Stack:** Tailwind CSS v4, CSS custom properties, `backdrop-filter` (supported in macOS WKWebView + Windows WebView2), React 18 + TypeScript, Zustand-free (theme state is local to `useTheme` hook).

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/hooks/useTheme.ts` | Modify | `Theme` type, `ThemeMeta` interface, `THEMES` array |
| `src/styles/globals.css` | Modify | Remove `emerald` + `warm-amber` blocks; add `dark-glass` tokens + background mesh + component overrides |
| `src/components/Settings.tsx` | Modify | Replace flat `THEMES.map` (lines 261–293) with grouped two-section render |

---

## Task 1: Update Theme Type, Interface, and Registry

**Files:**
- Modify: `src/hooks/useTheme.ts`

- [ ] **Step 1: Replace the file contents**

Open `src/hooks/useTheme.ts` and replace the entire file with:

```ts
import { useCallback, useState } from "react";

export type Theme = "charcoal" | "dark-glass";

export interface ThemeMeta {
  id: Theme;
  label: string;
  bg: string;       // swatch background
  accent: string;   // swatch accent dot
  dark: boolean;
  style: "neomorphism" | "glassmorphism";
}

export const THEMES: ThemeMeta[] = [
  { id: "charcoal",   label: "Charcoal",   bg: "#1e2229", accent: "#34d399", dark: true, style: "neomorphism"   },
  { id: "dark-glass", label: "Dark Glass", bg: "#050d12", accent: "#34d399", dark: true, style: "glassmorphism" },
];

const STORAGE_KEY = "omwhisper-theme";

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute("data-theme", t);
  const isLight = !THEMES.find((th) => th.id === t)?.dark;
  document.documentElement.classList.toggle("theme-light", isLight);
  localStorage.setItem(STORAGE_KEY, t);
}

export function initTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
  const valid = THEMES.find((t) => t.id === saved);
  applyTheme(valid ? saved! : "charcoal");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return THEMES.find((t) => t.id === saved) ? saved! : "charcoal";
  });

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
  }, []);

  return { theme, setTheme };
}
```

**What changed vs current:**
- `Theme` type: removed `"emerald" | "warm-amber"`, added `"dark-glass"`
- `ThemeMeta`: added `style: "neomorphism" | "glassmorphism"` field
- `THEMES`: removed `emerald` and `warm-amber` entries; added `dark-glass`
- `applyTheme`, `initTheme`, `useTheme`: logic unchanged — the existing `THEMES.find` guard already handles the migration (users with `emerald`/`warm-amber` in localStorage will silently fall back to `charcoal`)

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: TypeScript may show errors mentioning `"emerald"` or `"warm-amber"` as invalid `Theme` values — those are in `Settings.tsx` and will be fixed in Task 3. No Rust changes are involved here.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTheme.ts
git commit -m "feat(theme): add dark-glass to theme registry, remove light themes"
```

---

## Task 2: Add Dark Glassmorphism CSS — Remove Light Themes, Add Glass Tokens + Overrides

**Files:**
- Modify: `src/styles/globals.css`

This task has four parts: (A) remove the `emerald` and `warm-amber` theme blocks, (B) remove the now-dead `html.theme-light` override block, (C) add the `dark-glass` token block + background mesh, (D) add component overrides.

- [ ] **Step 1: Remove the `emerald` theme block**

In `globals.css`, delete the entire block from `/* ══ THEME 1 — Emerald` through its closing `}` (lines 62–83 in the current file). The block looks like:

```css
/* ══ THEME 1 — Emerald ═══════════════════════════════════════════════════ */
[data-theme="emerald"] {
  ...
}
```

- [ ] **Step 2: Remove the `warm-amber` theme block**

Delete the entire block from `/* ══ THEME 2 — Warm Amber` through its closing `}` (lines 85–106 in the current file):

```css
/* ══ THEME 2 — Warm Amber ════════════════════════════════════════════════ */
[data-theme="warm-amber"] {
  ...
}
```

- [ ] **Step 3: Remove the dead `html.theme-light` override block**

After the two deletions above, find and delete the entire light-theme override block. It starts with this comment:

```css
/* ── Light-theme overrides for Tailwind text-white/XX utilities ──────── */
```

And ends with the last `border-color` rule:

```css
html.theme-light .border-white\/10        { border-color: color-mix(in srgb, var(--t1) 10%, transparent); }
```

Delete everything from that opening comment through that final line. Both remaining themes (`charcoal` and `dark-glass`) have `dark: true`, so `applyTheme()` will never set the `theme-light` class — this block is permanently dead code after the light themes are removed.

- [ ] **Step 4: Add the `dark-glass` token block + background mesh**

After the closing `}` of the `[data-theme="charcoal"]` block (identified by the line `--accent-grad-to:   #25b87e;` followed by `}`) and before the `/* ── Base styles ─` comment, insert:

```css
/* ══ THEME 1 — Dark Glass ════════════════════════════════════════════════ */
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

/* Background mesh: three radial orbs over near-black base.               */
/* Both html and body are targeted so overscroll bounce areas on macOS    */
/* also show the mesh rather than the solid --bg fallback.                */
[data-theme="dark-glass"] html,
[data-theme="dark-glass"] body {
  background:
    radial-gradient(ellipse 60% 40% at 80% 10%,  rgba(52, 211, 153, 0.12) 0%, transparent 70%),
    radial-gradient(ellipse 55% 45% at 15% 85%,  rgba(13, 148, 136, 0.08) 0%, transparent 70%),
    radial-gradient(ellipse 70% 60% at 50% 50%,  rgba(30,  58,  95, 0.15) 0%, transparent 70%),
    #050d12;
  background-attachment: fixed;
}
```

- [ ] **Step 5: Add component overrides**

At the **end of the file** (after all existing content), append:

```css
/* ── Dark Glass component overrides ─────────────────────────────────── */
/* These replace neumorphic box-shadows when [data-theme="dark-glass"]   */
/* is active. The --nm-* variables are left intact for the Charcoal      */
/* theme. border-radius is inherited from base class definitions.         */

[data-theme="dark-glass"] .card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.40);
}

/* .card-inset uses blur(8px) intentionally (half of --glass-blur).      */
/* Full 16px blur on nested inset wells creates stacked-glass noise.     */
[data-theme="dark-glass"] .card-inset {
  background: rgba(0, 0, 0, 0.20);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.30);
}

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

- [ ] **Step 6: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(theme): add dark-glass CSS tokens, background mesh, and component overrides"
```

---

## Task 3: Update Theme Picker in Settings to Two Grouped Sections

**Files:**
- Modify: `src/components/Settings.tsx` (lines 260–294)

- [ ] **Step 1: Replace the flat theme picker with a grouped render**

In `Settings.tsx`, find the theme picker block (currently lines 260–294):

```tsx
              <p className="text-t3 text-xs mb-4">Theme</p>
              <div className="flex items-center gap-3 flex-wrap">
                {THEMES.map((t) => (
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
                      {/* Accent dot */}
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
```

Replace it with (note: the `{/* Accent dot */}` comment from line 279 of the original is intentionally omitted in the replacement — it was a dead inline comment):

```tsx
              <p className="text-t3 text-xs mb-4">Theme</p>
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

- [ ] **Step 2: Verify TypeScript compiles clean**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors. The `Theme` type now only allows `"charcoal" | "dark-glass"`, and `THEMES` only contains those two entries, so `t.id` and `t.style` will type-check correctly.

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat(theme): reorganize theme picker into Neomorphism/Glassmorphism sections"
```

---

## Task 4: Visual Verification

- [ ] **Step 1: Start the dev server**

Run: `cargo tauri dev`

Wait for the Vite dev server and Tauri window to open (~15–30 seconds on first run).

- [ ] **Step 2: Verify Charcoal theme**

Open Settings → General tab. Confirm:
- Theme picker shows two sections: "Neomorphism" (with Charcoal swatch) and "Glassmorphism" (with Dark Glass swatch)
- Charcoal is selected by default
- App looks identical to before — neumorphic shadows, solid `#1e2229` background

- [ ] **Step 3: Switch to Dark Glass theme**

Click the "Dark Glass" swatch. Confirm:
- Background changes to near-black `#050d12` with soft emerald/teal gradient orbs visible
- Cards have a frosted glass look: semi-transparent dark fill, visible `backdrop-filter` blur, thin glass border
- Buttons have emerald glow on hover
- Ghost buttons have glass fill with thin border
- Text is still readable (white at correct opacities)
- Accent color is emerald `#34d399` (unchanged from Charcoal)

- [ ] **Step 4: Verify theme persistence**

Close and reopen the Tauri window (or reload with Cmd+R). Confirm:
- Dark Glass theme is still active after reload
- Switching back to Charcoal and reloading also persists correctly

- [ ] **Step 5: Final commit**

```bash
git add -A
git status  # verify nothing unexpected is staged
git commit -m "feat(theme): Dark Glassmorphism theme complete" 2>/dev/null || echo "nothing to commit"
```

---

## Reference

- **Spec:** `docs/superpowers/specs/2026-03-18-dark-glassmorphism-theme-design.md`
- **CSS file:** `src/styles/globals.css`
- **Theme hook:** `src/hooks/useTheme.ts`
- **Settings component:** `src/components/Settings.tsx` (theme picker at lines 258–294)
- **Dev command:** `cargo tauri dev` (from project root)
- **TypeScript check:** `npx tsc --noEmit`
