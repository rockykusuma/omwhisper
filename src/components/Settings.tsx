import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Sliders, Mic, FileText, CreditCard, Info
} from "lucide-react";

interface Settings {
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
}

type Tab = "general" | "audio" | "transcription" | "license" | "about";

const TABS: { id: Tab; icon: React.ElementType; label: string }[] = [
  { id: "general",       icon: Sliders,    label: "General"       },
  { id: "audio",         icon: Mic,        label: "Audio"         },
  { id: "transcription", icon: FileText,   label: "Transcription" },
  { id: "license",       icon: CreditCard, label: "License"       },
  { id: "about",         icon: Info,       label: "About"         },
];

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      aria-label={label}
      className={`relative w-10 h-6 rounded-full transition-colors duration-200 cursor-pointer ${
        value ? "bg-emerald-500" : "bg-white/10"
      }`}
    >
      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
        value ? "translate-x-5" : "translate-x-1"
      }`} />
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
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/[0.04] last:border-0">
      <div>
        <p className="text-white/80 text-sm">{label}</p>
        {description && <p className="text-white/30 text-xs mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("general");

  useEffect(() => {
    Promise.all([
      invoke<Settings>("get_settings"),
      invoke<string[]>("get_audio_devices"),
    ]).then(([s, d]) => {
      setSettings(s);
      setDevices(d);
    });
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
      <div className="flex items-center justify-center h-64 text-white/20 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sub-navigation */}
      <div className="w-40 shrink-0 px-2 py-4 border-r border-white/[0.05] space-y-0.5">
        {TABS.map(({ id, icon: Icon, label }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all duration-150 cursor-pointer text-left ${
                isActive
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "text-white/35 hover:text-white/65 hover:bg-white/[0.04]"
              }`}
            >
              <Icon size={13} strokeWidth={isActive ? 2 : 1.75} />
              <span>{label}</span>
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
            <h3 className="text-white/30 text-[10px] uppercase tracking-widest mb-4 font-mono">General</h3>
            <div className="card px-5">
              <SettingRow label="Global Hotkey" description="Toggle recording from anywhere">
                <div className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/60 text-xs font-mono">
                  {settings.hotkey}
                </div>
              </SettingRow>
              <SettingRow label="Launch at Login" description="Start OmWhisper when you log in">
                <Toggle value={settings.auto_launch} onChange={(v) => update({ auto_launch: v })} label="Launch at login" />
              </SettingRow>
              <SettingRow label="Auto-Paste" description="Paste transcription into focused app">
                <Toggle value={settings.auto_paste} onChange={(v) => update({ auto_paste: v })} label="Auto-paste" />
              </SettingRow>
              <SettingRow label="Show Overlay" description="Floating indicator while recording">
                <Toggle value={settings.show_overlay} onChange={(v) => update({ show_overlay: v })} label="Show overlay" />
              </SettingRow>
              <SettingRow label="Log Level" description="Verbosity of log file">
                <select
                  value={settings.log_level ?? "normal"}
                  onChange={(e) => update({ log_level: e.target.value })}
                  className="bg-white/[0.06] text-white/60 text-xs rounded-lg px-3 py-1.5 border border-white/[0.08] cursor-pointer outline-none"
                  aria-label="Log level"
                >
                  <option value="normal">Normal</option>
                  <option value="debug">Debug</option>
                </select>
              </SettingRow>
            </div>
          </div>
        )}

        {activeTab === "audio" && (
          <div>
            <h3 className="text-white/30 text-[10px] uppercase tracking-widest mb-4 font-mono">Audio</h3>
            <div className="card px-5">
              <SettingRow label="Microphone" description="Input device for recording">
                <select
                  value={settings.audio_input_device ?? ""}
                  onChange={(e) => update({ audio_input_device: e.target.value || null })}
                  className="bg-white/[0.06] text-white/60 text-xs rounded-lg px-3 py-1.5 border border-white/[0.08] cursor-pointer outline-none max-w-[160px]"
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
            </div>
          </div>
        )}

        {activeTab === "transcription" && (
          <div>
            <h3 className="text-white/30 text-[10px] uppercase tracking-widest mb-4 font-mono">Transcription</h3>
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
                  className="bg-white/[0.06] text-white/60 text-xs rounded-lg px-3 py-1.5 border border-white/[0.08] cursor-pointer outline-none"
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
        )}

        {activeTab === "license" && <LicenseSection />}
        {activeTab === "about" && <AboutSection />}
      </div>
    </div>
  );
}

// ─── About ─────────────────────────────────────────────────────────────────────
function AboutSection() {
  const [version, setVersion] = useState("0.1.0");
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    invoke<string>("get_app_version").then(setVersion).catch(() => {});
  }, []);

  async function handleCopyDebugInfo() {
    setCopying(true);
    try {
      const info = await invoke<string>("get_debug_info");
      await navigator.clipboard.writeText(info);
    } catch {
      const info = await invoke<string>("get_debug_info").catch(() => "");
      await invoke("paste_transcription", { text: info }).catch(() => {});
    } finally {
      setTimeout(() => setCopying(false), 1500);
    }
  }

  return (
    <div>
      <h3 className="text-white/30 text-[10px] uppercase tracking-widest mb-4 font-mono">About</h3>
      <div className="card px-5">
        <SettingRow label="Version">
          <span className="text-white/30 text-xs font-mono">{version}</span>
        </SettingRow>
        <SettingRow label="Model Storage">
          <span className="text-white/30 text-xs font-mono truncate max-w-[180px]">
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
        <div className="py-4 text-center">
          <p className="text-white/20 text-xs">Made with ॐ by Rakesh Kusuma</p>
        </div>
      </div>
    </div>
  );
}

// ─── License ───────────────────────────────────────────────────────────────────
interface LicenseInfoData {
  status: string;
  email: string | null;
  activated_on: string | null;
  last_validated: string | null;
}

function LicenseSection() {
  const [info, setInfo] = useState<LicenseInfoData | null>(null);
  const [key, setKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function loadInfo() {
    try {
      const data = await invoke<LicenseInfoData>("get_license_info");
      setInfo(data);
    } catch {}
  }

  useEffect(() => { loadInfo(); }, []);

  useEffect(() => {
    const unlisten = listen("license-status", () => loadInfo());
    return () => { unlisten.then((f) => f()); };
  }, []);

  async function handleActivate() {
    if (!key.trim()) return;
    setActivating(true);
    setError(null);
    try {
      await invoke("activate_license", { key: key.trim() });
      setKey("");
      showToast("✓ License activated!");
      await loadInfo();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("max_activations_reached")) {
        setError("Already activated on another device. Deactivate it there first.");
      } else if (msg.includes("network_error")) {
        setError("Network error. Check your connection and try again.");
      } else {
        setError("Invalid license key.");
      }
    } finally {
      setActivating(false);
    }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    try {
      await invoke("deactivate_license");
      showToast("Deactivated. You can now activate on another device.");
      await loadInfo();
    } catch {
      showToast("Deactivation failed.");
    } finally {
      setDeactivating(false);
    }
  }

  const isActive = info?.status === "Licensed" || info?.status === "GracePeriod";

  return (
    <div>
      <h3 className="text-white/30 text-[10px] uppercase tracking-widest mb-4 font-mono">License</h3>
      <div className="card p-5 space-y-3">
        {isActive ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-emerald-400 text-sm font-semibold">
                  {info?.status === "GracePeriod" ? "Licensed (grace period)" : "Licensed"}
                </span>
              </div>
              <button
                onClick={handleDeactivate}
                disabled={deactivating}
                className="text-white/25 hover:text-red-400 text-xs transition-colors cursor-pointer disabled:opacity-50"
                aria-label="Deactivate license"
              >
                {deactivating ? "Deactivating…" : "Deactivate"}
              </button>
            </div>
            {info?.email && (
              <p className="text-white/30 text-xs font-mono">{info.email}</p>
            )}
            {info?.activated_on && (
              <p className="text-white/20 text-xs font-mono">
                Activated {new Date(info.activated_on).toLocaleDateString()}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-white/40 text-sm">
              {info?.status === "Expired"
                ? "License expired — please re-validate or buy a new key."
                : "Free tier: 30 min/day · tiny.en only"}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={key}
                onChange={(e) => { setKey(e.target.value); setError(null); }}
                placeholder="Enter license key…"
                className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-emerald-500/40 transition-colors font-mono"
                aria-label="License key"
              />
              <button
                onClick={handleActivate}
                disabled={activating || !key.trim()}
                className="btn-primary shrink-0"
              >
                {activating ? "…" : "Activate"}
              </button>
            </div>
            {error && <p className="text-red-400/70 text-xs">{error}</p>}
            <p className="text-white/20 text-xs">
              Don't have a key?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  invoke("plugin:opener|open_url", { url: "https://omwhisper.lemonsqueezy.com" }).catch(() => {});
                }}
                className="text-emerald-500/50 hover:text-emerald-400 underline"
              >
                Buy OmWhisper for $12
              </a>
            </p>
          </>
        )}
        {toast && (
          <p className="text-emerald-400 text-xs font-mono">{toast}</p>
        )}
      </div>
    </div>
  );
}
