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
  { id: "dark-glass", label: "Dark Glass", bg: "#06100c", accent: "#34d399", dark: true, style: "glassmorphism" },
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
