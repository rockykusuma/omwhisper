// ─── Transcription ─────────────────────────────────────────────────────────────

export interface TranscriptionSegment {
  text: string;
  start_ms: number;
  end_ms: number;
  is_final: boolean;
}

export interface TranscriptionEntry {
  id: number;
  text: string;
  duration_seconds: number;
  model_used: string;
  created_at: string;
  word_count: number;
  source: string;
  raw_text?: string;
  polish_style?: string;
}

// ─── App events ────────────────────────────────────────────────────────────────

export interface UpdateInfo {
  latest: string;
  download_url: string;
  release_notes: string;
}

export interface UsageUpdate {
  seconds_used: number;
  seconds_remaining: number;
  is_free_tier: boolean;
}

// ─── Settings ──────────────────────────────────────────────────────────────────

export interface AppSettings {
  hotkey: string;
  active_model: string;
  language: string;
  auto_launch: boolean;
  auto_paste: boolean;
  show_overlay: boolean;
  audio_input_device: string | null;
  vad_sensitivity: number;
  onboarding_complete: boolean;
  log_level: string;
  sound_enabled: boolean;
  sound_volume: number;
  restore_clipboard: boolean;
  clipboard_restore_delay_ms: number;
  recording_mode: string;
  auto_delete_after_days: number | null;
  ai_backend: string;
  ai_ollama_model: string;
  ai_ollama_url: string;
  ai_cloud_model: string;
  ai_cloud_api_url: string;
  ai_timeout_seconds: number;
  active_polish_style: string;
  translate_target_language: string;
  smart_dictation_hotkey: string;
  polish_text_hotkey: string;
  push_to_talk_hotkey: string;
  ptt_key: string;
  overlay_placement: string;
  overlay_style: string;
  translate_to_english: boolean;
  llm_model_name: string;
  llm_nudge_shown: boolean;
  apply_polish_to_regular: boolean;
  vad_engine: string;
  transcription_engine: string;
  analytics_enabled: boolean;
  crash_reporting_enabled: boolean;
}

// ─── AI ────────────────────────────────────────────────────────────────────────

export interface OllamaStatus {
  running: boolean;
  models: string[];
}

export interface LlmModelInfo {
  name: string;
  size_bytes: number;
  size_label: string;
  is_downloaded: boolean;
  is_active: boolean;
}

export interface LlmDownloadProgress {
  name: string;
  progress: number;
  done: boolean;
  error: string | null;
}

export interface BuiltInStyle {
  id: string;
  name: string;
  description: string;
}

export interface CustomStyle {
  name: string;
  system_prompt: string;
}

// ─── Stats & Storage ───────────────────────────────────────────────────────────

export interface UsageStats {
  total_recordings: number;
  total_duration_seconds: number;
  total_words: number;
  recordings_today: number;
  streak_days: number;
}

export interface StorageInfo {
  db_size_bytes: number;
  record_count: number;
}
