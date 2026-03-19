/** Centralised localStorage key constants — prevents typos and naming drift. */
export const STORAGE_KEYS = {
  THEME: "omwhisper-theme",
  SIDEBAR: "omwhisper-sidebar",
  CRASH_REPORTING: "omwhisper-crash-reporting",
  MODEL_NUDGE_DISMISSED: "omw_model_nudge_dismissed",
  SD_NUDGE_DISMISSED: "omw_sd_nudge_dismissed",
} as const;
