import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Sliders, Mic, FileText, Info, ShieldCheck, ShieldAlert, Keyboard, Brain, Activity, Zap, Sparkles, Cpu, ExternalLink
} from "lucide-react";
import { logger } from "../utils/logger";
import { STORAGE_KEYS } from "../utils/storageKeys";
import type { AppSettings, StorageInfo } from "../types";

type Settings = AppSettings;

export type SettingsTab = "general" | "audio" | "transcription" | "shortcuts" | "about";

const TABS: { id: SettingsTab; icon: React.ElementType; label: string }[] = [
  { id: "general",       icon: Sliders,    label: "General"       },
  { id: "audio",         icon: Mic,        label: "Audio"         },
  { id: "transcription", icon: FileText,   label: "Transcription" },
  { id: "shortcuts",     icon: Keyboard,   label: "Shortcuts"     },
  { id: "about",         icon: Info,       label: "About"         },
];

/** Convert our internal shortcut string → human-readable symbols */
function formatHotkey(hotkey: string): string {
  if (!hotkey) return "";
  return hotkey.split("+").map(part => {
    switch (part) {
      case "CmdOrCtrl": case "Cmd": case "Super": return "⌘";
      case "Shift":   return "⇧";
      case "Alt": case "Option": return "⌥";
      case "Ctrl": case "Control": return "⌃";
      case "Space":    return "Space";
      case "CapsLock": return "⇪";
      case "Tab":      return "⇥";
      default:         return part.toUpperCase();
    }
  }).join("");
}

/** Keyboard shortcut recorder widget */
function HotkeyRecorder({
  value,
  onChange,
  requireModifier = true,
}: {
  value: string;
  onChange: (v: string) => void;
  requireModifier?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Pure-modifier presses — wait for the actual key
      if (["Meta", "Shift", "Alt", "Control"].includes(e.key)) return;

      // Escape cancels without saving
      if (e.key === "Escape") { setRecording(false); return; }

      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("CmdOrCtrl");
      if (e.shiftKey)              parts.push("Shift");
      if (e.altKey)                parts.push("Alt");

      const key = e.key === " "        ? "Space"
        : e.key === "CapsLock"         ? "CapsLock"
        : e.key.length === 1           ? e.key.toUpperCase()
        : e.key;                         // F1, Tab, Backspace, etc.

      parts.push(key);

      // requireModifier = true: need combo. requireModifier = false: single key OK
      if (!requireModifier || parts.length >= 2) {
        onChange(parts.join("+"));
        setRecording(false);
      }
    };

    const onBlur = () => setRecording(false);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [recording, onChange]);

  return (
    <div className="flex items-center gap-1.5">
      <button
        ref={btnRef}
        onClick={() => setRecording(r => !r)}
        className="px-2.5 py-1 rounded-lg text-xs font-mono transition-all duration-150 cursor-pointer"
        style={{
          background: recording ? "var(--accent-bg)" : "var(--bg)",
          color:      recording ? "var(--accent)"    : "var(--t2)",
          boxShadow:  recording ? "var(--nm-pressed-sm)" : "var(--nm-raised-sm)",
          border:     recording ? "1px solid var(--accent-glow-weak)" : "1px solid transparent",
          minWidth: 84,
        }}
        title={recording ? "Press your shortcut (Esc to cancel)" : "Click to record shortcut"}
      >
        {recording ? "Press keys…" : (value ? formatHotkey(value) : "— None —")}
      </button>
      {value && !recording && (
        <button
          onClick={() => onChange("")}
          className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150"
          style={{ background: "var(--bg)", color: "var(--t3)", boxShadow: "var(--nm-raised-sm)", fontSize: 11, lineHeight: 1 }}
          title="Clear shortcut"
        >
          ×
        </button>
      )}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      aria-label={label}
      className="relative w-10 h-6 rounded-full transition-all duration-200 cursor-pointer"
      style={{
        background: "var(--bg)",
        boxShadow: "var(--nm-pressed-sm)",
      }}
    >
      <div
        className="absolute top-1 w-4 h-4 rounded-full transition-all duration-200"
        style={{
          transform: value ? "translateX(20px)" : "translateX(4px)",
          background: value ? "var(--accent)" : "var(--t4)",
          boxShadow: value ? "0 0 6px var(--accent-glow), var(--nm-raised-sm)" : "var(--nm-raised-sm)",
        }}
      />
    </button>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 last:border-0" style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
      <div>
        <p className="text-white/80 text-sm">{label}</p>
        {description && <p className="text-white/50 text-xs mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPanel({ initialTab, onNavigate }: { initialTab?: SettingsTab; onNavigate?: (target: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? "general");

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [micAuthStatus, setMicAuthStatus] = useState<"authorized" | "not_determined" | "denied" | null>(null);
  const [platform, setPlatform] = useState<string>("macos");
  const [appleAvailable, setAppleAvailable] = useState<boolean>(true);
  const [appleSpeechAuthStatus, setAppleSpeechAuthStatus] = useState<"authorized" | "not_determined" | "denied">("denied");

  useEffect(() => {
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
    invoke<boolean>("is_apple_speech_available").then(setAppleAvailable).catch(() => {});
    invoke<string>("get_apple_speech_auth_status").then((s) => setAppleSpeechAuthStatus(s as typeof appleSpeechAuthStatus)).catch(() => {});
  }, []);

  useEffect(() => {
    // Load settings first so the panel renders immediately
    invoke<Settings>("get_settings").then(setSettings);

    // Slower calls populate lazily in parallel
    invoke<string[]>("get_audio_devices").then(setDevices).catch(() => {});
    invoke<StorageInfo>("get_storage_info").then(setStorageInfo).catch(() => {});
    invoke<boolean>("check_accessibility_permission").then(setAccessibilityGranted).catch(() => {});
    invoke<string>("get_microphone_auth_status").then((s) => setMicAuthStatus(s as typeof micAuthStatus)).catch(() => {});

    // Re-sync when settings are changed from another view (e.g. model selection in Models tab)
    const unlisten = listen("settings-changed", () => {
      invoke<Settings>("get_settings").then(setSettings);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await invoke("update_settings", { newSettings: updated });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-64 text-white/35 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sub-navigation */}
      <div
        className="w-40 shrink-0 px-2 py-4 space-y-1.5"
        style={{ boxShadow: "4px 0 12px var(--shadow-dark)" }}
      >
        {TABS.map(({ id, icon: Icon, label }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all duration-200 cursor-pointer text-left"
              style={{
                boxShadow: isActive ? "var(--nm-pressed-sm)" : "var(--nm-raised-sm)",
                color: isActive ? "var(--accent)" : "var(--t3)",
                background: "var(--bg)",
              }}
            >
              <Icon size={13} strokeWidth={isActive ? 2.25 : 1.75} />
              <span className={isActive ? "font-medium" : ""}>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Saved indicator */}
        {saved && (
          <p className="text-emerald-400 text-xs font-mono mb-3">✓ Saved</p>
        )}

        {activeTab === "general" && (
          <div>
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">General</h3>
            <div className="card px-5">
              <SettingRow label="Launch at Login" description="Start OmWhisper when you log in">
                <Toggle value={settings.auto_launch} onChange={(v) => update({ auto_launch: v })} label="Launch at login" />
              </SettingRow>
              <SettingRow label="Auto-Paste" description="Paste transcription into focused app">
                <Toggle value={settings.auto_paste} onChange={(v) => update({ auto_paste: v })} label="Auto-paste" />
              </SettingRow>
              <SettingRow label="Restore Clipboard" description="Restore previous clipboard after pasting">
                <Toggle value={settings.restore_clipboard} onChange={(v) => update({ restore_clipboard: v })} label="Restore clipboard" />
              </SettingRow>
              {settings.restore_clipboard && (
                <SettingRow label="Restore Delay" description="How long to wait before restoring clipboard">
                  <select
                    value={settings.clipboard_restore_delay_ms}
                    onChange={(e) => update({ clipboard_restore_delay_ms: parseInt(e.target.value) })}
                    className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                    aria-label="Clipboard restore delay"
                  >
                    <option value={1000}>1 second</option>
                    <option value={2000}>2 seconds</option>
                    <option value={5000}>5 seconds</option>
                  </select>
                </SettingRow>
              )}
              <SettingRow label="Show Overlay" description="Floating indicator while recording">
                <Toggle value={settings.show_overlay} onChange={(v) => update({ show_overlay: v })} label="Show overlay" />
              </SettingRow>
              {settings.show_overlay && (
                <>
                  <SettingRow label="Overlay Position" description="Where to show the recording indicator">
                    <select
                      value={settings.overlay_placement ?? "top-center"}
                      onChange={(e) => update({ overlay_placement: e.target.value })}
                      className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
                      style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                      aria-label="Overlay position"
                    >
                      <option value="top-center">Top Center</option>
                      <option value="top-left">Top Left</option>
                      <option value="top-right">Top Right</option>
                      <option value="bottom-center">Bottom Center</option>
                      <option value="bottom-left">Bottom Left</option>
                      <option value="bottom-right">Bottom Right</option>
                    </select>
                  </SettingRow>
                  <SettingRow label="Overlay Style" description="Visual appearance of the recording indicator">
                    <select
                      value={settings.overlay_style ?? "micro"}
                      onChange={(e) => update({ overlay_style: e.target.value })}
                      className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
                      style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                      aria-label="Overlay style"
                    >
                      <option value="micro">Micro — compact bars</option>
                      <option value="waveform">Waveform — bars + label</option>
                    </select>
                  </SettingRow>
                  <SettingRow
                    label="Live Text Streaming"
                    description={
                      <span>
                        Show partial transcription below the overlay during recording.{" "}
                        <span className="text-amber-400/80">May reduce accuracy for long uninterrupted speech.</span>
                      </span>
                    }
                  >
                    <Toggle
                      value={settings.live_text_streaming ?? false}
                      onChange={(v) => update({ live_text_streaming: v })}
                      label="Live text streaming"
                    />
                  </SettingRow>
                </>
              )}
            </div>

            <h3 className="text-t3 text-[10px] uppercase tracking-widest mt-6 mb-4 font-mono">Storage</h3>
            <div className="card px-5">
              <SettingRow label="Auto-Delete History" description="Remove transcriptions older than">
                <select
                  value={settings.auto_delete_after_days ?? ""}
                  onChange={(e) => update({ auto_delete_after_days: e.target.value ? parseInt(e.target.value) : null })}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                  aria-label="Auto-delete after days"
                >
                  <option value="">Never</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                </select>
              </SettingRow>
              {storageInfo && (
                <div className="py-3 flex items-center justify-between">
                  <p className="text-white/50 text-xs">{storageInfo.record_count} transcription{storageInfo.record_count !== 1 ? "s" : ""} stored</p>
                  <p className="text-white/35 text-xs font-mono">{(storageInfo.db_size_bytes / 1024).toFixed(1)} KB</p>
                </div>
              )}
            </div>

            {/* Permissions */}
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mt-6 mb-4 font-mono">Permissions</h3>
            <div className="card px-5">
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div className="flex items-center gap-2.5">
                  {accessibilityGranted
                    ? <ShieldCheck size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
                    : <ShieldAlert size={15} className="text-red-400 shrink-0" />
                  }
                  <div>
                    <p className="text-sm" style={{ color: "var(--t1)" }}>Accessibility</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--t3)" }}>
                      Required for auto-paste to focused apps
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                    style={{
                      color: accessibilityGranted ? "var(--accent)" : "#f87171",
                      background: accessibilityGranted ? "var(--accent-bg)" : "rgba(248,113,113,0.12)",
                      boxShadow: "var(--nm-pressed-sm)",
                    }}
                  >
                    {accessibilityGranted === null ? "checking…" : accessibilityGranted ? "Granted" : "Not granted"}
                  </span>
                  <button
                    onClick={() => {
                      invoke("open_accessibility_settings").catch(() => {});
                      setTimeout(() => {
                        invoke<boolean>("check_accessibility_permission")
                          .then(setAccessibilityGranted)
                          .catch(() => {});
                      }, 3000);
                    }}
                    className="btn-ghost p-1.5"
                    title="Open System Settings → Accessibility"
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "audio" && (
          <div>
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Audio</h3>

            {/* Microphone permission row */}
            {platform === "macos" && micAuthStatus !== "authorized" && (
              <div className="card px-5 mb-4">
                <div className="flex items-center justify-between gap-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    {micAuthStatus === "denied"
                      ? <ShieldAlert size={15} className="text-red-400 shrink-0" />
                      : <ShieldAlert size={15} style={{ color: "#fb923c", flexShrink: 0 }} />
                    }
                    <div>
                      <p className="text-sm" style={{ color: "var(--t1)" }}>Microphone</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--t3)" }}>
                        {micAuthStatus === "denied"
                          ? "Permission denied — open System Settings to allow"
                          : "Permission required to record your voice"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                      style={{
                        color: micAuthStatus === "denied" ? "#f87171" : "#fb923c",
                        background: micAuthStatus === "denied" ? "rgba(248,113,113,0.12)" : "rgba(251,146,60,0.12)",
                        boxShadow: "var(--nm-pressed-sm)",
                      }}
                    >
                      {micAuthStatus === null ? "checking…" : micAuthStatus === "denied" ? "Denied" : "Not granted"}
                    </span>
                    {micAuthStatus === "not_determined" ? (
                      <button
                        onClick={() => {
                          invoke<boolean>("request_microphone_permission").then((granted) => {
                            setMicAuthStatus(granted ? "authorized" : "denied");
                          }).catch(() => {});
                        }}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        Allow
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          invoke("open_microphone_settings").catch(() => {});
                          setTimeout(() => {
                            invoke<string>("get_microphone_auth_status")
                              .then((s) => setMicAuthStatus(s as typeof micAuthStatus))
                              .catch(() => {});
                          }, 3000);
                        }}
                        className="btn-ghost p-1.5"
                        title="Open System Settings → Microphone"
                      >
                        <ExternalLink size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="card px-5">
              <SettingRow label="Microphone" description="Input device for recording">
                <select
                  value={settings.audio_input_device ?? ""}
                  onChange={(e) => update({ audio_input_device: e.target.value || null })}
                  disabled={micAuthStatus === "denied"}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none max-w-[160px]" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", opacity: micAuthStatus === "denied" ? 0.4 : 1 }}
                  aria-label="Microphone device"
                >
                  <option value="">Default</option>
                  {devices.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </SettingRow>
              <div className="py-3" style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
                <p className="text-white/80 text-sm mb-1">VAD Engine</p>
                <p className="text-white/50 text-xs mb-3">Algorithm used to detect when you're speaking</p>
                <div className="flex gap-2">
                  {([
                    { id: "silero", Icon: Brain,    label: "Silero",  sub: "Neural AI · more accurate" },
                    { id: "rms",    Icon: Activity, label: "RMS",     sub: "Energy-based · lighter" },
                  ] as const).map(({ id, Icon, label, sub }) => {
                    const active = settings.vad_engine === id;
                    return (
                      <button
                        key={id}
                        onClick={() => update({ vad_engine: id })}
                        aria-pressed={active}
                        className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all duration-150 cursor-pointer"
                        style={{
                          background: "var(--bg)",
                          boxShadow: active ? "var(--nm-pressed-sm)" : "var(--nm-raised-sm)",
                          border: active
                            ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)"
                            : "1px solid transparent",
                        }}
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                          style={{
                            background: active ? "var(--accent-bg)" : "color-mix(in srgb, var(--t1) 6%, transparent)",
                          }}
                        >
                          <Icon size={14} style={{ color: active ? "var(--accent)" : "var(--t3)" }} />
                        </div>
                        <div>
                          <p className="text-xs font-medium leading-tight" style={{ color: active ? "var(--accent)" : "var(--t1)" }}>
                            {label}
                          </p>
                          <p className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--t4)" }}>{sub}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <SettingRow
                label="VAD Sensitivity"
                description={`Voice detection threshold · ${Math.round(settings.vad_sensitivity * 100)}%`}
              >
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.vad_sensitivity}
                  onChange={(e) => update({ vad_sensitivity: parseFloat(e.target.value) })}
                  className="w-28 accent-emerald-400 cursor-pointer"
                  aria-label="VAD sensitivity"
                />
              </SettingRow>
              <SettingRow label="Sound Effects" description="Play chimes on start and stop">
                <Toggle value={settings.sound_enabled} onChange={(v) => update({ sound_enabled: v })} label="Sound effects" />
              </SettingRow>
              <SettingRow
                label="Sound Volume"
                description={`Chime volume · ${Math.round(settings.sound_volume * 100)}%`}
              >
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.sound_volume}
                  onChange={(e) => update({ sound_volume: parseFloat(e.target.value) })}
                  disabled={!settings.sound_enabled}
                  className="w-28 accent-emerald-400 cursor-pointer disabled:opacity-40"
                  aria-label="Sound volume"
                />
              </SettingRow>
            </div>
          </div>
        )}

        {activeTab === "transcription" && (
          <div className="space-y-5">
            <div>
              <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Transcription</h3>
              <div className="card px-5">
                <div className="flex items-center justify-between gap-4 py-3" style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
                  <div>
                    <p className="text-white/80 text-sm">Active Model</p>
                    <p className="text-white/50 text-xs mt-0.5">Whisper model used for transcription</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-mono">
                      {settings.active_model}
                    </span>
                    <button
                      onClick={() => onNavigate?.("models:whisper")}
                      className="text-xs cursor-pointer transition-colors"
                      style={{ color: "var(--t4)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t4)")}
                    >
                      Manage models →
                    </button>
                  </div>
                </div>
                {platform === "macos" && (
                  <div className="py-3" style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
                    <p className="text-white/80 text-sm mb-1">Engine</p>
                    <p className="text-white/50 text-xs mb-3">Choose how your voice is transcribed</p>
                    <div className="flex gap-2">
                      {([
                        { id: "auto",    Icon: Zap,       label: "Auto",          sub: "Apple Speech if available" },
                        { id: "apple",   Icon: Sparkles,  label: "Apple Speech",  sub: "On-device · fast" },
                        { id: "whisper", Icon: Cpu,       label: "Whisper",       sub: "Local model · all languages" },
                      ] as const).map(({ id, Icon, label, sub }) => {
                        const isApple = id === "apple";
                        const disabled = isApple && !appleAvailable && appleSpeechAuthStatus !== "not_determined";
                        const active = settings.transcription_engine === id && !disabled;
                        const canEnable = isApple && appleSpeechAuthStatus === "not_determined";
                        const subText = isApple
                          ? appleSpeechAuthStatus === "authorized" ? sub
                          : appleSpeechAuthStatus === "not_determined" ? "Tap to grant permission"
                          : "Permission denied — open System Settings"
                          : sub;
                        return (
                          <button
                            key={id}
                            onClick={async () => {
                              if (canEnable) {
                                const granted = await invoke<boolean>("request_speech_recognition_permission");
                                if (granted) {
                                  setAppleAvailable(true);
                                  setAppleSpeechAuthStatus("authorized");
                                  update({ transcription_engine: "apple" });
                                } else {
                                  setAppleSpeechAuthStatus("denied");
                                }
                              } else if (!disabled) {
                                update({ transcription_engine: id });
                              }
                            }}
                            aria-pressed={active}
                            aria-disabled={disabled}
                            className={`flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all duration-150 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                            style={{
                              background: "var(--bg)",
                              boxShadow: active ? "var(--nm-pressed-sm)" : "var(--nm-raised-sm)",
                              border: active
                                ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)"
                                : canEnable
                                ? "1px solid color-mix(in srgb, var(--accent) 20%, transparent)"
                                : "1px solid transparent",
                              opacity: disabled ? 0.4 : 1,
                            }}
                          >
                            <div
                              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                              style={{ background: active ? "var(--accent-bg)" : "color-mix(in srgb, var(--t1) 6%, transparent)" }}
                            >
                              <Icon size={14} style={{ color: active ? "var(--accent)" : canEnable ? "var(--accent)" : "var(--t3)" }} />
                            </div>
                            <div>
                              <p className="text-xs font-medium leading-tight" style={{ color: active ? "var(--accent)" : canEnable ? "var(--accent)" : "var(--t1)" }}>
                                {label}
                              </p>
                              <p className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--t4)" }}>
                                {subText}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <SettingRow label="Language" description="Transcription language">
                  <select
                    value={settings.language}
                    onChange={(e) => update({ language: e.target.value })}
                    className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                    aria-label="Transcription language"
                  >
                    <option value="en">English</option>
                    <option value="auto">Auto-detect</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="ja">Japanese</option>
                    <option value="zh">Chinese</option>
                    <option value="hi">Hindi</option>
                  </select>
                </SettingRow>
                <SettingRow label="Translate to English" description="Convert any language to English on paste">
                  <Toggle value={settings.translate_to_english} onChange={(v) => update({ translate_to_english: v })} label="Translate to English" />
                </SettingRow>
              </div>
            </div>
            <FileTranscriptionSection activeModel={settings.active_model} />
          </div>
        )}

        {activeTab === "shortcuts" && (
          <div>
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Recording</h3>
            <div className="card px-5 mb-6">
              <SettingRow label="Toggle Hotkey" description="Press once to start, press again to stop">
                <HotkeyRecorder
                  value={settings.hotkey}
                  onChange={(v) => update({ hotkey: v || "CmdOrCtrl+Shift+V" })}
                />
              </SettingRow>
              <SettingRow label="Smart Dictation" description="Record with AI polish (Cmd+Shift+B by default)">
                <HotkeyRecorder
                  value={settings.smart_dictation_hotkey ?? "CmdOrCtrl+Shift+B"}
                  onChange={(v) => update({ smart_dictation_hotkey: v || "CmdOrCtrl+Shift+B" })}
                />
              </SettingRow>
              <SettingRow label="Polish Selected Text" description="Copy selection, polish via AI, paste back. Restart app to apply hotkey changes.">
                <HotkeyRecorder
                  value={settings.polish_text_hotkey ?? "CmdOrCtrl+Shift+P"}
                  onChange={(v) => update({ polish_text_hotkey: v || "CmdOrCtrl+Shift+P" })}
                />
              </SettingRow>
            </div>

            {platform !== "windows" && (
              <>
                <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Push to Talk</h3>
                <div className="card px-5 mb-6">
                  <div className="flex items-start gap-2 py-3 border-b" style={{ borderColor: "rgba(251,191,36,0.15)" }}>
                    <span className="text-[11px]" style={{ color: "rgba(251,191,36,0.7)" }}>⚠</span>
                    <p className="text-[10px] leading-relaxed" style={{ color: "rgba(251,191,36,0.6)" }}>
                      Push to Talk is experimental — you may experience crashes or unresponsive keys. Requires Accessibility permission and an app restart to take effect.
                    </p>
                  </div>
                  <SettingRow label="Push to Talk Mode" description="Hold a key to record, release when done">
                    <Toggle
                      value={settings.recording_mode === "push_to_talk"}
                      onChange={(v) => update({ recording_mode: v ? "push_to_talk" : "toggle" })}
                      label="Push to talk"
                    />
                  </SettingRow>
                  {settings.recording_mode === "push_to_talk" && (
                    <>
                      <SettingRow label="Push to Talk Key" description="Hold this key to record, release to stop">
                        <select
                          value={["Fn","CapsLock","Right Option","Right Control"].includes(settings.push_to_talk_hotkey ?? "") ? settings.push_to_talk_hotkey : "Fn"}
                          onChange={(e) => update({ push_to_talk_hotkey: e.target.value })}
                          className="text-xs rounded-xl px-3 py-1.5 cursor-pointer"
                          style={{
                            background: "var(--bg)",
                            color: "var(--t1)",
                            border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
                            boxShadow: "var(--nm-pressed-sm)",
                            outline: "none",
                          }}
                        >
                          <option value="Fn">Fn</option>
                          <option value="CapsLock">CapsLock ⇪</option>
                          <option value="Right Option">Right Option ⌥</option>
                          <option value="Right Control">Right Control ⌃</option>
                        </select>
                      </SettingRow>
                    </>
                  )}
                </div>
              </>
            )}

            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Reference</h3>
            <div className="card px-5">
              {[
                { action: "Dictate in any app",    keys: ["⌘", "⇧", "V"], note: "Toggle recording" },
                { action: "Smart Dictation",        keys: ["⌘", "⇧", "B"], note: "Record + AI polish" },
                { action: "Open / close app",       keys: ["⌘", "⇧", "O"], note: "Show app window" },
              ].map(({ action, keys, note }) => (
                <div key={action} className="flex items-center justify-between py-3" style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
                  <div>
                    <p className="text-sm" style={{ color: "var(--t2)" }}>{action}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--t4)" }}>{note}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {keys.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex items-center justify-center text-[11px] font-mono rounded-md px-1.5 py-0.5 min-w-[22px]"
                        style={{ background: "var(--bg)", color: "var(--accent)", boxShadow: "var(--nm-raised-sm)", lineHeight: 1.4 }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "about" && <AboutSection settings={settings} update={update} />}
      </div>
    </div>
  );
}

// ─── File Transcription ────────────────────────────────────────────────────────
function FileTranscriptionSection({ activeModel }: { activeModel: string }) {
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectFile() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ filters: [{ name: "Audio", extensions: ["wav"] }], multiple: false });
    if (!selected) return;
    const filePath = typeof selected === "string" ? selected : (selected as { path: string }).path;
    setFileName(filePath.split("/").pop() ?? filePath);
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      const segments = await invoke<{ text: string }[]>("transcribe_file", {
        path: filePath,
        modelPath: `models/ggml-${activeModel}.bin`,
      });
      setResult(segments.map((s) => s.text).join(" ").trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">File Transcription</h3>
      <div className="card p-5 space-y-3">
        <p className="text-xs" style={{ color: "var(--t3)" }}>
          Transcribe a .wav audio file using the active model.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSelectFile}
            disabled={loading}
            className="btn-primary text-xs py-1.5 disabled:opacity-50"
          >
            {loading ? "Transcribing…" : "Select .wav file"}
          </button>
          {fileName && (
            <span className="text-xs font-mono truncate" style={{ color: "var(--t3)" }}>{fileName}</span>
          )}
        </div>
        {error && <p className="text-red-400/70 text-xs">{error}</p>}
        {result && (
          <div
            className="rounded-xl p-3 text-xs leading-relaxed"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
          >
            {result}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── About ─────────────────────────────────────────────────────────────────────
function FeedbackModal({ version, onClose }: { version: string; onClose: () => void }) {
  const [category, setCategory] = useState("Bug Report");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit() {
    if (!message.trim()) return;
    setStatus("sending");
    try {
      const debugInfo = await invoke<string>("get_debug_info").catch(() => "");
      await invoke("send_feedback", {
        category,
        message: message.trim(),
        userEmail: email.trim() || null,
        appVersion: version,
        debugInfo,
      });
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setErrorMsg(String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl p-5 space-y-4"
        style={{ background: "var(--bg)", boxShadow: "var(--nm-raised), 0 -8px 40px rgba(0,0,0,0.4)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ color: "var(--t1)" }}>Send Feedback</p>
          <button onClick={onClose} className="text-xs cursor-pointer" style={{ color: "var(--t4)" }}>✕</button>
        </div>

        {status === "success" ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-2xl">🎉</p>
            <p className="text-sm font-semibold" style={{ color: "var(--t1)" }}>Thank you!</p>
            <p className="text-xs" style={{ color: "var(--t3)" }}>Your feedback has been sent. We'll review it shortly.</p>
            <button onClick={onClose} className="mt-3 btn-primary text-xs py-1.5 px-4">Done</button>
          </div>
        ) : (
          <>
            {/* Category */}
            <div className="flex gap-2">
              {["Bug Report", "Feature Request", "General"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className="flex-1 py-1.5 rounded-xl text-xs transition-all duration-150 cursor-pointer"
                  style={{
                    background: "var(--bg)",
                    boxShadow: category === cat ? "var(--nm-pressed-sm)" : "var(--nm-raised-sm)",
                    border: category === cat ? "1px solid color-mix(in srgb, var(--accent) 45%, transparent)" : "1px solid transparent",
                    color: category === cat ? "var(--accent)" : "var(--t3)",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Message */}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the bug, idea, or anything on your mind…"
              rows={4}
              className="w-full resize-none rounded-xl px-3 py-2.5 text-xs outline-none leading-relaxed"
              style={{
                background: "var(--bg)",
                boxShadow: "var(--nm-pressed-sm)",
                color: "var(--t1)",
                border: "1px solid color-mix(in srgb, var(--t1) 8%, transparent)",
              }}
            />

            {/* Optional email */}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email (optional — for follow-up)"
              className="w-full rounded-xl px-3 py-2 text-xs outline-none"
              style={{
                background: "var(--bg)",
                boxShadow: "var(--nm-pressed-sm)",
                color: "var(--t1)",
                border: "1px solid color-mix(in srgb, var(--t1) 8%, transparent)",
              }}
            />

            {status === "error" && (
              <p className="text-red-400/70 text-xs">{errorMsg}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!message.trim() || status === "sending"}
              className="w-full btn-primary text-xs py-2 disabled:opacity-40"
            >
              {status === "sending" ? "Sending…" : "Send Feedback"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AboutSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const [version, setVersion] = useState("0.1.0");
  const [copying, setCopying] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    invoke<string>("get_app_version").then(setVersion).catch((e) => logger.debug("get_app_version:", e));
  }, []);

  async function handleCopyDebugInfo() {
    setCopying(true);
    try {
      const info = await invoke<string>("get_debug_info");
      await navigator.clipboard.writeText(info);
    } catch {
      const info = await invoke<string>("get_debug_info").catch(() => "");
      await invoke("paste_transcription", { text: info }).catch((e) => logger.debug("paste_transcription:", e));
    } finally {
      setTimeout(() => setCopying(false), 1500);
    }
  }

  return (
    <>
      {showFeedback && <FeedbackModal version={version} onClose={() => setShowFeedback(false)} />}
      <div>
        <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">About</h3>
        <div className="card px-5">
          {/* Privacy subsection */}
          <div className="py-3" style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
            <h4 className="text-t3 text-[10px] uppercase tracking-widest mb-3 font-mono">Privacy</h4>
            <SettingRow
              label="Usage Analytics"
              description="Anonymous feature usage. No audio or text is sent."
            >
              <Toggle
                value={settings.analytics_enabled}
                onChange={(v) => update({ analytics_enabled: v })}
                label="Usage analytics"
              />
            </SettingRow>
            <SettingRow
              label="Crash Reporting"
              description="Sends crash reports to help fix bugs. Takes effect after restart."
            >
              <Toggle
                value={settings.crash_reporting_enabled}
                onChange={(v) => {
                  update({ crash_reporting_enabled: v });
                  localStorage.setItem(STORAGE_KEYS.CRASH_REPORTING, String(v));
                }}
                label="Crash reporting"
              />
            </SettingRow>
          </div>
          <SettingRow label="Version">
            <span className="text-white/50 text-xs font-mono">{version}</span>
          </SettingRow>
          <div className="py-3" style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
            <p className="text-white/80 text-sm mb-1">Model Storage</p>
            <p className="text-white/50 text-xs font-mono break-all">~/Library/Application Support/com.omwhisper.app</p>
          </div>
          <SettingRow label="Log Level" description="Increase for troubleshooting">
            <select
              value={settings.log_level ?? "normal"}
              onChange={(e) => update({ log_level: e.target.value })}
              className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
              aria-label="Log level"
            >
              <option value="normal">Normal</option>
              <option value="debug">Debug</option>
            </select>
          </SettingRow>
          <SettingRow label="Debug Info" description="Copy diagnostics for bug reports">
            <button
              onClick={handleCopyDebugInfo}
              aria-label="Copy debug info to clipboard"
              className="btn-ghost text-xs py-1.5"
            >
              {copying ? "✓ Copied" : "Copy"}
            </button>
          </SettingRow>
          <SettingRow label="Documentation" description="Guides, shortcuts, and troubleshooting">
            <button
              onClick={() => invoke("open_external_url", { url: "https://rockykusuma.github.io/omwhisper/" })}
              aria-label="Open documentation"
              className="btn-ghost text-xs py-1.5"
            >
              Open →
            </button>
          </SettingRow>
          <SettingRow label="Send Feedback" description="Bug report, feature request, or general thoughts">
            <button
              onClick={() => setShowFeedback(true)}
              aria-label="Send feedback"
              className="btn-ghost text-xs py-1.5"
            >
              Feedback →
            </button>
          </SettingRow>
          <div className="py-4 text-center">
            <p className="text-white/35 text-xs">Made with ॐ by Rakesh Kusuma</p>
          </div>
        </div>
      </div>
    </>
  );
}

