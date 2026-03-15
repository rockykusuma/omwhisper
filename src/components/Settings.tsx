import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sliders, Mic, FileText, Info, Sparkles, ShieldCheck, ShieldAlert, Keyboard
} from "lucide-react";
import { logger } from "../utils/logger";
import { useTheme, THEMES } from "../hooks/useTheme";
import type { AppSettings, BuiltInStyle, CustomStyle, OllamaStatus, StorageInfo } from "../types";

type Settings = AppSettings;

type Tab = "general" | "audio" | "transcription" | "ai" | "shortcuts" | "about";

const TABS: { id: Tab; icon: React.ElementType; label: string }[] = [
  { id: "general",       icon: Sliders,    label: "General"       },
  { id: "audio",         icon: Mic,        label: "Audio"         },
  { id: "transcription", icon: FileText,   label: "Transcription" },
  { id: "ai",            icon: Sparkles,   label: "AI"            },
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
  description?: string;
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

export default function SettingsPanel({ initialTab }: { initialTab?: Tab }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "general");
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [builtInStyles, setBuiltInStyles] = useState<BuiltInStyle[]>([]);
  const [customStyles, setCustomStyles] = useState<CustomStyle[]>([]);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [newStyleName, setNewStyleName] = useState("");
  const [newStylePrompt, setNewStylePrompt] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    Promise.all([
      invoke<Settings>("get_settings"),
      invoke<string[]>("get_audio_devices"),
      invoke<StorageInfo>("get_storage_info"),
      invoke<boolean>("get_cloud_api_key_status"),
      invoke<boolean>("check_accessibility_permission"),
      invoke<{ built_in: BuiltInStyle[]; custom: CustomStyle[] }>("get_polish_styles"),
    ]).then(([s, d, info, keySet, a11y, styles]) => {
      setSettings(s);
      setDevices(d);
      setStorageInfo(info);
      setApiKeySet(keySet);
      setAccessibilityGranted(a11y);
      setBuiltInStyles(styles.built_in);
      setCustomStyles(styles.custom);
    });
  }, []);

  async function refreshOllamaStatus() {
    const status = await invoke<OllamaStatus>("check_ollama_status");
    setOllamaStatus(status);
  }

  async function handleSaveApiKey() {
    if (!apiKeyInput.trim()) return;
    await invoke("save_cloud_api_key", { key: apiKeyInput.trim() });
    setApiKeySet(true);
    setApiKeyInput("");
  }

  async function handleDeleteApiKey() {
    await invoke("delete_cloud_api_key_cmd").catch((e) => logger.debug("delete_cloud_api_key_cmd:", e));
    setApiKeySet(false);
  }

  async function handleTestConnection(backend: string) {
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await invoke<string>("test_ai_connection", { backend });
      setTestResult("✓ " + result);
    } catch (e) {
      setTestResult("✗ " + String(e));
    } finally {
      setTestLoading(false);
    }
  }

  async function handleAddCustomStyle() {
    if (!newStyleName.trim() || !newStylePrompt.trim()) return;
    await invoke("add_custom_style", { name: newStyleName.trim(), systemPrompt: newStylePrompt.trim() });
    const styles = await invoke<{ built_in: BuiltInStyle[]; custom: CustomStyle[] }>("get_polish_styles");
    setCustomStyles(styles.custom);
    setNewStyleName("");
    setNewStylePrompt("");
  }

  async function handleRemoveCustomStyle(name: string) {
    await invoke("remove_custom_style", { name });
    setCustomStyles((prev) => prev.filter((s) => s.name !== name));
  }

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
            {/* Theme picker */}
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Appearance</h3>
            <div className="card px-5 py-4 mb-6">
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
            </div>

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
                </>
              )}
              <SettingRow label="Log Level" description="Verbosity of log file">
                <select
                  value={settings.log_level ?? "normal"}
                  onChange={(e) => update({ log_level: e.target.value })}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                  aria-label="Log level"
                >
                  <option value="normal">Normal</option>
                  <option value="debug">Debug</option>
                </select>
              </SettingRow>
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
                  {/* Status badge */}
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

                  {/* Open settings button — only shown when not granted */}
                  {accessibilityGranted === false && (
                    <button
                      onClick={() => {
                        invoke("open_accessibility_settings").catch(() => {});
                        // Re-check after a short delay in case user grants it
                        setTimeout(() => {
                          invoke<boolean>("check_accessibility_permission")
                            .then(setAccessibilityGranted)
                            .catch(() => {});
                        }, 3000);
                      }}
                      className="btn-ghost text-xs"
                    >
                      Open Settings →
                    </button>
                  )}

                  {/* Re-check button — always visible when granted to allow refresh */}
                  {accessibilityGranted === true && (
                    <button
                      onClick={() =>
                        invoke<boolean>("check_accessibility_permission")
                          .then(setAccessibilityGranted)
                          .catch(() => {})
                      }
                      className="text-[10px] cursor-pointer transition-colors"
                      style={{ color: "var(--t4)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t4)")}
                    >
                      ↻ Refresh
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "audio" && (
          <div>
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Audio</h3>
            <div className="card px-5">
              <SettingRow label="Microphone" description="Input device for recording">
                <select
                  value={settings.audio_input_device ?? ""}
                  onChange={(e) => update({ audio_input_device: e.target.value || null })}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none max-w-[160px]" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                  aria-label="Microphone device"
                >
                  <option value="">Default</option>
                  {devices.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </SettingRow>
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
              <SettingRow label="Launch Om Sound" description="Play Om chant on app start">
                <Toggle value={settings.launch_sound_enabled} onChange={(v) => update({ launch_sound_enabled: v })} label="Launch Om sound" />
              </SettingRow>
            </div>
          </div>
        )}

        {activeTab === "transcription" && (
          <div className="space-y-5">
            <div>
              <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Transcription</h3>
              <div className="card px-5">
                <SettingRow label="Active Model" description="Whisper model used for transcription">
                  <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-mono">
                    {settings.active_model}
                  </div>
                </SettingRow>
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
              </div>
            </div>
            <FileTranscriptionSection activeModel={settings.active_model} />
          </div>
        )}

        {activeTab === "ai" && (
          <div>
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">AI Processing</h3>

            {/* Backend selector */}
            <div className="card px-5 mb-5">
              <SettingRow label="Backend" description="Where text is sent for polishing">
                <div className="flex rounded-xl overflow-hidden" style={{ boxShadow: "var(--nm-pressed-sm)" }}>
                  {(["disabled", "ollama", "cloud"] as const).map((b) => (
                    <button
                      key={b}
                      onClick={() => { update({ ai_backend: b }); setTestResult(null); }}
                      className="px-3 py-1.5 text-xs transition-all duration-150 cursor-pointer"
                      style={{
                        background: settings.ai_backend === b ? "rgba(139,92,246,0.15)" : "transparent",
                        color: settings.ai_backend === b ? "rgb(167,139,250)" : "var(--t3)",
                      }}
                    >
                      {b === "ollama" ? "On-Device" : b === "cloud" ? "Cloud API" : "Disabled"}
                    </button>
                  ))}
                </div>
              </SettingRow>
              {settings.ai_backend === "disabled" && (
                <p className="text-white/40 text-xs pb-3">Smart Dictation shortcut (⌘⇧B) will paste raw transcription.</p>
              )}
            </div>

            {/* Ollama section */}
            {settings.ai_backend === "ollama" && (
              <div className="card px-5 mb-5">
                <div className="flex items-center justify-between py-3 border-b border-white/[0.04]">
                  <div>
                    <p className="text-white/80 text-sm">Ollama Status</p>
                    {ollamaStatus === null
                      ? <p className="text-white/50 text-xs mt-0.5">Not checked yet</p>
                      : <p className={`text-xs mt-0.5 ${ollamaStatus.running ? "text-emerald-400" : "text-red-400/70"}`}>
                          {ollamaStatus.running ? `Running · ${ollamaStatus.models.length} model(s)` : "Not running"}
                        </p>
                    }
                  </div>
                  <button onClick={refreshOllamaStatus} className="btn-ghost text-xs py-1 px-3">Refresh</button>
                </div>
                <SettingRow label="Model" description="Ollama model for text polishing">
                  <select
                    value={settings.ai_ollama_model}
                    onChange={(e) => update({ ai_ollama_model: e.target.value })}
                    className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none max-w-[160px]" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                  >
                    {(ollamaStatus?.models.length ? ollamaStatus.models : [settings.ai_ollama_model]).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </SettingRow>
                <div className="py-3 flex items-center gap-3">
                  <button
                    onClick={() => handleTestConnection("ollama")}
                    disabled={testLoading}
                    className="btn-ghost text-xs py-1 px-3"
                  >
                    {testLoading ? "Testing…" : "Test Connection"}
                  </button>
                  {testResult && <span className={`text-xs font-mono ${testResult.startsWith("✓") ? "text-emerald-400" : "text-red-400/70"}`}>{testResult}</span>}
                </div>
                {ollamaStatus && !ollamaStatus.running && (
                  <div className="pb-4 space-y-1.5 text-white/40 text-xs leading-relaxed">
                    <p className="text-white/60 font-medium text-sm">Setup Ollama</p>
                    <p>1. Download from <button onClick={() => invoke("plugin:opener|open_url", { url: "https://ollama.com" }).catch(() => {})} className="text-violet-400 underline cursor-pointer">ollama.com</button></p>
                    <p>2. Install and open Ollama (it runs in the menu bar)</p>
                    <p>3. Open Terminal and run: <code className="bg-white/[0.06] px-1.5 py-0.5 rounded font-mono text-white/60">ollama pull llama3.2</code></p>
                    <p>4. Click Refresh above to detect it</p>
                  </div>
                )}
              </div>
            )}

            {/* Cloud API section */}
            {settings.ai_backend === "cloud" && (
              <div className="card px-5 mb-5">
                <SettingRow label="Provider" description="OpenAI-compatible API">
                  <select
                    value={
                      settings.ai_cloud_api_url.includes("openai.com") ? "openai"
                      : settings.ai_cloud_api_url.includes("groq.com") ? "groq"
                      : "custom"
                    }
                    onChange={(e) => {
                      const presets: Record<string, { url: string; model: string }> = {
                        openai: { url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
                        groq: { url: "https://api.groq.com/openai/v1", model: "llama3-8b-8192" },
                        custom: { url: settings.ai_cloud_api_url, model: settings.ai_cloud_model },
                      };
                      const p = presets[e.target.value];
                      update({ ai_cloud_api_url: p.url, ai_cloud_model: p.model });
                    }}
                    className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="groq">Groq</option>
                    <option value="custom">Custom</option>
                  </select>
                </SettingRow>
                <SettingRow label="API Key" description={apiKeySet ? "Key stored in macOS Keychain" : "Paste your API key"}>
                  {apiKeySet ? (
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 text-xs font-mono">●●●●●●●●</span>
                      <button onClick={handleDeleteApiKey} className="text-red-400/60 hover:text-red-400 text-xs cursor-pointer">Remove</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="sk-…"
                        className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-32 font-mono" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                        onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                      />
                      <button onClick={() => setShowApiKey((v) => !v)} className="text-white/50 hover:text-white/60 text-xs cursor-pointer">{showApiKey ? "Hide" : "Show"}</button>
                      <button onClick={handleSaveApiKey} disabled={!apiKeyInput.trim()} className="btn-ghost text-xs py-1 px-2">Save</button>
                    </div>
                  )}
                </SettingRow>
                <SettingRow label="Model" description="Model name">
                  <input
                    type="text"
                    value={settings.ai_cloud_model}
                    onChange={(e) => update({ ai_cloud_model: e.target.value })}
                    className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-32 font-mono" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                  />
                </SettingRow>
                <div className="py-3 flex items-center gap-3">
                  <button
                    onClick={() => handleTestConnection("cloud")}
                    disabled={testLoading || !apiKeySet}
                    className="btn-ghost text-xs py-1 px-3"
                  >
                    {testLoading ? "Testing…" : "Test Connection"}
                  </button>
                  {testResult && <span className={`text-xs font-mono ${testResult.startsWith("✓") ? "text-emerald-400" : "text-red-400/70"}`}>{testResult}</span>}
                </div>
                <p className="text-white/35 text-xs pb-3 leading-relaxed">
                  When using Cloud API, your transcription text is sent to the provider. Audio never leaves your device.
                </p>
              </div>
            )}

            {/* Smart Dictation shortcut + style */}
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mt-2 mb-4 font-mono">Smart Dictation</h3>
            <div className="card px-5 mb-5">
              <SettingRow label="Shortcut" description="Hotkey for Smart Dictation">
                <div className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/60 text-xs font-mono">⌘⇧B</div>
              </SettingRow>
              <SettingRow label="Default Style" description="Polish style applied on stop">
                <select
                  value={settings.active_polish_style}
                  onChange={(e) => update({ active_polish_style: e.target.value })}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                >
                  {builtInStyles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  {customStyles.map((s) => <option key={s.name} value={`custom:${s.system_prompt}`}>{s.name}</option>)}
                </select>
              </SettingRow>
              {settings.active_polish_style === "translate" && (
                <SettingRow label="Target Language" description="Language to translate into">
                  <select
                    value={settings.translate_target_language}
                    onChange={(e) => update({ translate_target_language: e.target.value })}
                    className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                  >
                    {["English","Spanish","French","German","Japanese","Chinese","Hindi","Portuguese","Korean","Arabic","Russian"].map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </SettingRow>
              )}
              <SettingRow label="Timeout" description="Max seconds to wait for AI response">
                <select
                  value={settings.ai_timeout_seconds}
                  onChange={(e) => update({ ai_timeout_seconds: parseInt(e.target.value) })}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                >
                  <option value={15}>15s</option>
                  <option value={30}>30s</option>
                  <option value={60}>60s</option>
                </select>
              </SettingRow>
            </div>

            {/* Polish styles */}
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mt-2 mb-4 font-mono">Polish Styles</h3>
            <div className="card px-5 mb-5">
              {builtInStyles.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
                  <div>
                    <p className="text-white/70 text-xs font-medium">{s.name}</p>
                    <p className="text-white/40 text-xs">{s.description}</p>
                  </div>
                  <span className="text-white/50 text-[10px] font-mono">built-in</span>
                </div>
              ))}
            </div>

            {/* Custom styles */}
            <h3 className="text-t3 text-[10px] uppercase tracking-widest mt-2 mb-4 font-mono">Custom Styles</h3>
            <div className="card px-5 mb-4">
              {customStyles.length === 0 && (
                <p className="text-white/35 text-xs py-3">No custom styles yet.</p>
              )}
              {customStyles.map((s) => (
                <div key={s.name} className="flex items-start justify-between py-2.5 border-b border-white/[0.04] last:border-0 gap-3">
                  <div className="min-w-0">
                    <p className="text-white/70 text-xs font-medium truncate">{s.name}</p>
                    <p className="text-white/40 text-xs truncate">{s.system_prompt.slice(0, 60)}…</p>
                  </div>
                  <button onClick={() => handleRemoveCustomStyle(s.name)} className="text-red-400/40 hover:text-red-400 text-xs shrink-0 cursor-pointer">Remove</button>
                </div>
              ))}
              <div className="pt-3 space-y-2">
                <input
                  type="text"
                  value={newStyleName}
                  onChange={(e) => setNewStyleName(e.target.value)}
                  placeholder="Style name…"
                  className="w-full rounded-lg px-3 py-2 text-white/70 text-xs outline-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                />
                <textarea
                  value={newStylePrompt}
                  onChange={(e) => setNewStylePrompt(e.target.value)}
                  placeholder="System prompt…"
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-white/70 text-xs outline-none resize-none font-mono" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                />
                <button
                  onClick={handleAddCustomStyle}
                  disabled={!newStyleName.trim() || !newStylePrompt.trim()}
                  className="btn-primary text-xs py-1.5 w-full"
                >
                  Add Style
                </button>
              </div>
            </div>
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
            </div>

            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Push to Talk</h3>
            <div className="card px-5 mb-6">
              <SettingRow label="Push to Talk Mode" description="Hold a key to record, release when done">
                <Toggle
                  value={settings.recording_mode === "push_to_talk"}
                  onChange={(v) => update({ recording_mode: v ? "push_to_talk" : "toggle" })}
                  label="Push to talk"
                />
              </SettingRow>
              {settings.recording_mode === "push_to_talk" && (
                <>
                  <SettingRow label="Push to Talk Key" description="Single key or combo — hold to record, release to stop">
                    <div className="flex items-center gap-1.5">
                      {settings.push_to_talk_hotkey === "Fn" ? (
                        /* Fn active — show it as the selected key with a clear button */
                        <>
                          <span
                            className="px-2.5 py-1 rounded-lg text-xs font-mono"
                            style={{
                              background: "var(--accent-bg)",
                              color: "var(--accent)",
                              boxShadow: "var(--nm-pressed-sm)",
                              border: "1px solid var(--accent-glow-weak)",
                            }}
                          >
                            fn
                          </span>
                          <button
                            onClick={() => update({ push_to_talk_hotkey: "CmdOrCtrl+Shift+X" })}
                            className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150"
                            style={{ background: "var(--bg)", color: "var(--t3)", boxShadow: "var(--nm-raised-sm)", fontSize: 11 }}
                            title="Clear"
                          >×</button>
                        </>
                      ) : (
                        /* Normal key recorder with fn as a quick-pick option */
                        <>
                          <button
                            onClick={() => update({ push_to_talk_hotkey: "Fn" })}
                            className="px-2 py-1 rounded-lg text-xs font-mono transition-all duration-150 cursor-pointer"
                            style={{
                              background: "var(--bg)",
                              color: "var(--t4)",
                              boxShadow: "var(--nm-raised-sm)",
                              border: "1px solid transparent",
                            }}
                            title="Use Fn key"
                          >fn</button>
                          <span style={{ color: "var(--t4)", fontSize: 10 }}>or</span>
                          <HotkeyRecorder
                            value={settings.push_to_talk_hotkey ?? ""}
                            onChange={(v) => update({ push_to_talk_hotkey: v || "CmdOrCtrl+Shift+X" })}
                            requireModifier={false}
                          />
                        </>
                      )}
                    </div>
                  </SettingRow>
                  <SettingRow label="Double-press to Lock" description="Press twice quickly to keep recording without holding">
                    <Toggle
                      value={settings.double_press_lock ?? false}
                      onChange={(v) => update({ double_press_lock: v })}
                      label="Double press lock"
                    />
                  </SettingRow>
                </>
              )}
            </div>

            <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">Reference</h3>
            <div className="card px-5">
              {[
                { action: "Dictate in any app",    keys: ["⌘", "⇧", "V"], note: "Toggle recording" },
                { action: "Smart Dictation",        keys: ["⌘", "⇧", "B"], note: "Record + AI polish" },
                { action: "Open / close app",       keys: ["⌘", "⇧", "V"], note: "From menu bar" },
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

        {activeTab === "about" && <AboutSection />}
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
function AboutSection() {
  const [version, setVersion] = useState("0.1.0");
  const [copying, setCopying] = useState(false);

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

  async function handleSendFeedback() {
    const debugInfo = await invoke<string>("get_debug_info").catch(() => "");
    const subject = encodeURIComponent(`OmWhisper Beta Feedback — v${version}`);
    const body = encodeURIComponent(
      `Hi,\n\n[Your feedback here — what's working, what's not, what's missing]\n\n---\n${debugInfo}`
    );
    const mailto = `mailto:feedback@omwhisper.com?subject=${subject}&body=${body}`;
    invoke("plugin:opener|open_url", { url: mailto }).catch(() => {});
  }

  return (
    <div>
      <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">About</h3>
      <div className="card px-5">
        <SettingRow label="Version">
          <span className="text-white/50 text-xs font-mono">{version}</span>
        </SettingRow>
        <SettingRow label="Model Storage">
          <span className="text-white/50 text-xs font-mono truncate max-w-[180px]">
            ~/Library/Application Support/com.omwhisper.app
          </span>
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
        <SettingRow label="Send Feedback" description="Opens your email client">
          <button
            onClick={handleSendFeedback}
            aria-label="Send feedback by email"
            className="btn-ghost text-xs py-1.5"
          >
            Send Feedback
          </button>
        </SettingRow>
        <div className="py-4 text-center">
          <p className="text-white/35 text-xs">Made with ॐ by Rakesh Kusuma</p>
        </div>
      </div>
    </div>
  );
}

