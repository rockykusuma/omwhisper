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
