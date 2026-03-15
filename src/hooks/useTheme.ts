import { useCallback, useState } from "react";

export type Theme = "forest-dark" | "sage-light" | "ocean-blue" | "warm-amber" | "slate-night";

export interface ThemeMeta {
  id: Theme;
  label: string;
  bg: string;       // swatch background
  accent: string;   // swatch accent dot
  dark: boolean;
}

export const THEMES: ThemeMeta[] = [
  { id: "forest-dark", label: "Forest",  bg: "#1c2821", accent: "#34d399", dark: true  },
  { id: "sage-light",  label: "Sage",    bg: "#d4e2d8", accent: "#059669", dark: false },
  { id: "ocean-blue",  label: "Ocean",   bg: "#ccd8e8", accent: "#0284c7", dark: false },
  { id: "warm-amber",  label: "Amber",   bg: "#e2d8c8", accent: "#b45309", dark: false },
  { id: "slate-night", label: "Slate",   bg: "#1a2038", accent: "#60a5fa", dark: true  },
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
  applyTheme(saved ?? "forest-dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Theme) ?? "forest-dark";
  });

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
  }, []);

  return { theme, setTheme };
}
