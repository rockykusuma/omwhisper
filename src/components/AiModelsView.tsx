import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Cpu, MemoryStick, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import type { AppSettings, BuiltInStyle, CustomStyle, OllamaStatus } from "../types";

// ── Whisper tab types ─────────────────────────────────────────────────────────
interface ModelInfo {
  name: string;
  description: string;
  size_bytes: number;
  size_label: string;
  sha256: string;
  is_downloaded: boolean;
  is_english_only: boolean;
  category: string;
}

interface DownloadProgress {
  name: string;
  progress: number;
  done: boolean;
  error: string | null;
}

interface SystemSpec {
  total_ram_gb: number;
  cpu_brand: string;
  cpu_cores: number;
  is_apple_silicon: boolean;
}

interface ModelRecommendation {
  recommended_model: string;
  reason: string;
  spec: SystemSpec;
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
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

const MODEL_PRESETS: Record<string, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"],
  google: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
  groq: ["llama3-8b-8192", "llama3-70b-8192", "mixtral-8x7b-32768", "gemma-7b-it"],
  mistral: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
  openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3-haiku", "google/gemini-flash-1.5"],
  custom: [],
};

// ── Whisper sub-tab ───────────────────────────────────────────────────────────
function WhisperTab({ activeModel, onModelChange }: { activeModel: string; onModelChange: (name: string) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [diskUsage, setDiskUsage] = useState(0);
  const [recommendation, setRecommendation] = useState<ModelRecommendation | null>(null);
  const [specExpanded, setSpecExpanded] = useState(false);

  async function loadModels() {
    const [list, usage] = await Promise.all([
      invoke<ModelInfo[]>("get_models"),
      invoke<number>("get_models_disk_usage"),
    ]);
    setModels(list);
    setDiskUsage(usage);
  }

  useEffect(() => {
    loadModels();
    invoke<ModelRecommendation>("get_model_recommendation").then(setRecommendation).catch(() => {});

    const unlisten = listen<DownloadProgress>("download-progress", (event) => {
      const { name, progress, done, error } = event.payload;
      if (done) {
        setDownloading((prev) => { const next = { ...prev }; delete next[name]; return next; });
        if (error) setErrors((prev) => ({ ...prev, [name]: error }));
        else loadModels();
      } else {
        setDownloading((prev) => ({ ...prev, [name]: progress }));
        setErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  async function handleDownload(name: string) {
    setErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
    setDownloading((prev) => ({ ...prev, [name]: 0 }));
    await invoke("download_model", { name });
  }

  async function handleDelete(name: string) {
    const downloadedCount = models.filter(m => m.is_downloaded).length;
    if (downloadedCount <= 1) return; // always keep at least one model
    await invoke("delete_model", { name });
    if (activeModel === name) {
      const fallback = models.find(m => m.is_downloaded && m.name !== name);
      if (fallback) onModelChange(fallback.name);
    }
    loadModels();
  }

  const downloadedCount = models.filter(m => m.is_downloaded).length;

  const recModel = recommendation?.recommended_model;

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-bold" style={{ color: "var(--t1)" }}>Models</h2>
        <p className="text-xs mt-1 font-mono" style={{ color: "var(--t3)" }}>{formatBytes(diskUsage)} used on disk</p>
      </div>

      {recommendation && (
        <div
          className="rounded-2xl p-4 mb-5"
          style={{
            background: "color-mix(in srgb, var(--accent) 6%, var(--bg))",
            boxShadow: "var(--nm-raised-sm), 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles size={13} style={{ color: "var(--accent)" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--t1)" }}>Recommended for your Mac</span>
            </div>
            <button
              onClick={() => setSpecExpanded(v => !v)}
              className="cursor-pointer transition-colors mt-0.5"
              style={{ color: "var(--t3)" }}
              title="Show system info"
            >
              {specExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--t2)" }}>
            {recModel && recModel === activeModel
              ? "You're already on the recommended model."
              : recommendation.reason}
          </p>
          {recModel && recModel !== activeModel && (
            <button
              onClick={() => {
                const m = models.find(m => m.name === recModel);
                if (m?.is_downloaded) onModelChange(recModel);
                else if (m && !(recModel in downloading)) handleDownload(recModel);
              }}
              className="mt-3 btn-primary text-xs px-3 py-1.5"
            >
              {models.find(m => m.name === recModel)?.is_downloaded ? `Switch to ${recModel}` : `Download & use ${recModel}`}
            </button>
          )}
          {specExpanded && (
            <div
              className="mt-3 pt-3 grid grid-cols-2 gap-y-1.5"
              style={{ borderTop: "1px solid color-mix(in srgb, var(--accent) 15%, transparent)" }}
            >
              <div className="flex items-center gap-1.5">
                <Cpu size={11} style={{ color: "var(--t3)" }} />
                <span className="text-xs" style={{ color: "var(--t3)" }}>
                  {recommendation.spec.is_apple_silicon ? "Apple Silicon" : "Intel"} · {recommendation.spec.cpu_cores} cores
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <MemoryStick size={11} style={{ color: "var(--t3)" }} />
                <span className="text-xs" style={{ color: "var(--t3)" }}>{recommendation.spec.total_ram_gb.toFixed(1)} GB RAM</span>
              </div>
              <div className="col-span-2 mt-0.5">
                <span className="text-[11px] font-mono" style={{ color: "var(--t4)" }}>{recommendation.spec.cpu_brand}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {["English Only", "Multilingual", "Turbo"].map((cat) => {
        const group = models.filter((m) => m.category === cat);
        if (group.length === 0) return null;
        return (
          <div key={cat} className="mb-5">
            <p className="text-[10px] font-mono uppercase tracking-widest mb-2 px-1" style={{ color: "var(--t4)" }}>{cat}</p>
            <div className="space-y-2.5">
              {group.map((model) => {
                const isActive = activeModel === model.name;
                const isRecommended = model.name === recModel;
                const isDownloading = model.name in downloading;
                const progress = downloading[model.name] ?? 0;
                const error = errors[model.name];
                return (
                  <div
                    key={model.name}
                    className="rounded-2xl px-5 py-4 transition-all duration-200"
                    style={{
                      background: isActive ? "color-mix(in srgb, var(--accent) 5%, var(--bg))" : "var(--bg)",
                      boxShadow: isActive
                        ? "var(--nm-pressed-sm), 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent)"
                        : "var(--nm-raised-sm)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--accent)", boxShadow: "0 0 5px var(--accent-glow)" }} />
                          )}
                          <span className="font-semibold text-sm" style={{ color: "var(--t1)" }}>{model.name}</span>
                          {model.is_english_only && (
                            <span className="text-[10px] px-1.5 py-px rounded font-mono" style={{ color: "var(--t4)", background: "color-mix(in srgb, var(--t1) 6%, transparent)" }}>EN</span>
                          )}
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-px rounded font-mono" style={{ color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)", background: "transparent" }}>Active</span>
                          )}
                          {isRecommended && (
                            <span className="text-[10px] px-1.5 py-px rounded font-mono flex items-center gap-0.5" style={{ color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)", background: "color-mix(in srgb, var(--accent) 7%, transparent)" }}>
                              <Sparkles size={8} />Recommended
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--t2)" }}>{model.description}</p>
                        <p className="text-[11px] mt-1 font-mono" style={{ color: "var(--t4)" }}>{model.size_label}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {model.is_downloaded ? (
                          <>
                            {!isActive && (
                              <button onClick={() => onModelChange(model.name)} className="btn-primary text-xs px-3 py-1.5">Set Active</button>
                            )}
                            {!isActive && (
                              <button
                                onClick={() => handleDelete(model.name)}
                                disabled={downloadedCount <= 1}
                                className="btn-ghost text-xs px-3 py-1.5"
                                style={{ fontSize: 11, opacity: downloadedCount <= 1 ? 0.35 : 1, cursor: downloadedCount <= 1 ? "not-allowed" : "pointer" }}
                                title={downloadedCount <= 1 ? "At least one model must remain downloaded" : "Delete model"}
                              >Delete</button>
                            )}
                          </>
                        ) : isDownloading ? (
                          <div className="text-right min-w-[64px]">
                            <p className="text-[11px] font-mono mb-1" style={{ color: "var(--accent)" }}>{Math.round(progress * 100)}%</p>
                            <div className="h-1 rounded-full overflow-hidden" style={{ width: 64, background: "color-mix(in srgb, var(--t1) 8%, transparent)" }}>
                              <div className="h-full rounded-full transition-all duration-200" style={{ width: `${progress * 100}%`, background: "var(--accent)" }} />
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleDownload(model.name)}
                            className="text-xs px-3 py-1.5 rounded-lg transition-all duration-150 cursor-pointer font-medium"
                            style={{
                              color: "var(--t2)",
                              background: "var(--bg)",
                              boxShadow: "var(--nm-raised-sm)",
                              border: isRecommended ? "1px solid color-mix(in srgb, var(--accent) 25%, transparent)" : "1px solid transparent",
                            }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)";
                              (e.currentTarget as HTMLButtonElement).style.borderColor = "color-mix(in srgb, var(--accent) 40%, transparent)";
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLButtonElement).style.color = "var(--t2)";
                              (e.currentTarget as HTMLButtonElement).style.borderColor = isRecommended ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "transparent";
                            }}
                          >
                            Download
                          </button>
                        )}
                      </div>
                    </div>
                    {error && <p className="text-red-400 text-xs mt-2">✗ {error}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Smart Dictation sub-tab ───────────────────────────────────────────────────
function SmartDictationTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [builtInStyles, setBuiltInStyles] = useState<BuiltInStyle[]>([]);
  const [customStyles, setCustomStyles] = useState<CustomStyle[]>([]);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [newStyleName, setNewStyleName] = useState("");
  const [newStylePrompt, setNewStylePrompt] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [cloudTestError, setCloudTestError] = useState<string | null>(null);
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");

  useEffect(() => {
    setCustomModelInput("");
  }, [settings?.ai_cloud_api_url]);

  useEffect(() => {
    if (settings && settings.ai_cloud_verified) {
      update({ ai_cloud_verified: false });
      setCloudTestError(null);
    }
  }, [settings?.ai_cloud_model, settings?.ai_cloud_api_url]);

  useEffect(() => {
    if (settings?.ai_backend !== "ollama") return;
    let cancelled = false;
    setOllamaChecking(true);
    invoke<OllamaStatus>("check_ollama_status")
      .then((status) => { if (!cancelled) { setOllamaStatus(status); setOllamaChecking(false); } })
      .catch(() => { if (!cancelled) setOllamaChecking(false); });
    return () => { cancelled = true; };
  }, [settings?.ai_backend]);

  useEffect(() => {
    invoke<AppSettings>("get_settings").then((loaded) => { setSettings(loaded); setOllamaChecking(loaded.ai_backend === "ollama"); }).catch(() => {});
    invoke<boolean>("get_cloud_api_key_status").then(setApiKeySet).catch(() => {});
    invoke<{ built_in: BuiltInStyle[]; custom: CustomStyle[] }>("get_polish_styles")
      .then((styles) => { setBuiltInStyles(styles.built_in); setCustomStyles(styles.custom); })
      .catch(() => {});

  }, []);

  async function refreshOllamaStatus() {
    setOllamaChecking(true);
    try {
      const status = await invoke<OllamaStatus>("check_ollama_status");
      setOllamaStatus(status);
    } finally {
      setOllamaChecking(false);
    }
  }

  async function handleSaveApiKey() {
    if (!apiKeyInput.trim()) return;
    await invoke("save_cloud_api_key", { key: apiKeyInput.trim() });
    setApiKeySet(true);
    setApiKeyInput("");
    setCloudTestError(null);
    await update({ ai_cloud_verified: false });
  }

  async function handleDeleteApiKey() {
    await invoke("delete_cloud_api_key_cmd").catch(() => {});
    setApiKeySet(false);
    setCloudTestError(null);
    await update({ ai_cloud_verified: false });
  }

  async function handleTestConnection(backend: string) {
    setTestLoading(true);
    try {
      await invoke<string>("test_ai_connection", { backend });
      if (backend === "cloud") {
        setCloudTestError(null);
        await update({ ai_cloud_verified: true });
      }
    } catch (e) {
      const msg = String(e);
      if (backend === "cloud") {
        setCloudTestError(msg);
        await update({ ai_cloud_verified: false });
      }
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

  async function update(patch: Partial<AppSettings>) {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await invoke("update_settings", { newSettings: updated });
  }

  if (!settings) {
    return <div className="flex items-center justify-center h-64 text-white/35 text-sm">Loading…</div>;
  }

  // Effective backend: treat built_in as disabled (built_in is removed)
  const effectiveBackend = settings.ai_backend === "built_in" ? "disabled" : settings.ai_backend;

  return (
    <div>
      <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-4 font-mono">AI Processing</h3>

      {/* Backend selector — radio cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {(
          [
            { value: "disabled", icon: "🚫", name: "Disabled",           description: "No AI polishing" },
            { value: "ollama",   icon: "🦙", name: "On-Device (Ollama)", description: "Local model, private" },
            { value: "cloud",    icon: "☁️", name: "Cloud API",          description: "OpenAI, Groq, or custom" },
          ] as const
        ).map(({ value, icon, name, description }) => {
          const isSelected = effectiveBackend === value;
          const badge =
            value === "ollama"
              ? ollamaStatus === null
                ? null
                : ollamaStatus.running
                ? "Running"
                : "Setup needed"
              : value === "cloud"
              ? settings.ai_cloud_verified
                ? "Connected"
                : "Needs setup"
              : null;
          return (
            <button
              key={value}
              onClick={() => update({ ai_backend: value, ...(value === "disabled" ? { apply_polish_to_regular: false } : {}) })}
              className="relative flex flex-col items-start gap-1.5 rounded-xl p-3 text-left transition-all duration-150 cursor-pointer"
              style={{
                border: isSelected ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.07)",
                background: isSelected ? "rgba(139,92,246,0.07)" : "rgba(255,255,255,0.02)",
              }}
            >
              {/* radio dot */}
              <div
                className="absolute top-3 right-3 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                style={{
                  border: isSelected ? "1.5px solid rgb(139,92,246)" : "1.5px solid rgba(255,255,255,0.2)",
                  background: isSelected ? "rgb(139,92,246)" : "transparent",
                }}
              >
                {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <span className="text-base leading-none">{icon}</span>
              <span className="text-xs font-semibold pr-5" style={{ color: isSelected ? "rgb(167,139,250)" : "rgba(255,255,255,0.8)" }}>
                {name}
              </span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{description}</span>
              {badge && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: badge === "Running" || badge === "Connected" ? "rgba(52,211,153,0.1)" : "rgba(251,191,36,0.1)",
                    color:      badge === "Running" || badge === "Connected" ? "rgba(52,211,153,0.8)"  : "rgba(251,191,36,0.8)",
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Ollama section */}
      {effectiveBackend === "ollama" && (
        <div className="card mb-5 overflow-hidden">
          {/* Status banner */}
          {ollamaChecking ? (
            <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}>
              <div className="w-2.5 h-2.5 rounded-full bg-white/20 animate-pulse flex-shrink-0" />
              <span className="text-xs text-white/50">Checking Ollama…</span>
            </div>
          ) : ollamaStatus?.running ? (
            <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(52,211,153,0.05)" }}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.5)" }} />
              <div className="flex-1 min-w-0 text-xs">
                <span className="font-semibold" style={{ color: "#34d399" }}>Connected</span>
                <span className="text-white/40 ml-2 font-mono">
                  {settings.ai_ollama_model} · {settings.ai_ollama_url} · {ollamaStatus.models.length} models
                </span>
              </div>
              <button onClick={refreshOllamaStatus} disabled={ollamaChecking} className="btn-ghost text-xs py-1 px-3 flex-shrink-0">Refresh</button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(251,191,36,0.05)" }}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#fbbf24", boxShadow: "0 0 6px rgba(251,191,36,0.5)" }} />
              <div className="flex-1 text-xs">
                <span className="font-semibold" style={{ color: "#fbbf24" }}>Ollama not detected</span>
                <span className="text-white/40 ml-2">Install and start Ollama to continue</span>
              </div>
              <button onClick={refreshOllamaStatus} disabled={ollamaChecking} className="btn-ghost text-xs py-1 px-3 flex-shrink-0">Refresh</button>
            </div>
          )}

          {/* Config fields — only when connected */}
          {ollamaStatus?.running && (
            <div className="px-5">
              <SettingRow label="Model" description="Ollama model for text polishing">
                <select
                  value={settings.ai_ollama_model}
                  onChange={(e) => update({ ai_ollama_model: e.target.value })}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none max-w-[160px]"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                >
                  {ollamaStatus.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </SettingRow>
              <SettingRow label="Server URL" description="Advanced">
                <input
                  type="text"
                  value={settings.ai_ollama_url}
                  onChange={(e) => update({ ai_ollama_url: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 outline-none max-w-[200px]"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                />
              </SettingRow>
            </div>
          )}

          {/* Setup guide — only when not running */}
          {!ollamaChecking && ollamaStatus !== null && !ollamaStatus.running && (
            <div className="px-5 py-4 space-y-2 text-xs leading-relaxed">
              <p className="text-white/50">1. Download from{" "}
                <button
                  onClick={() => invoke("plugin:opener|open_url", { url: "https://ollama.com" }).catch(() => {})}
                  className="text-violet-400 underline cursor-pointer hover:text-violet-300 transition-colors"
                >
                  ollama.com
                </button>
              </p>
              <p className="text-white/50">2. Run:{" "}
                <button
                  onClick={() => navigator.clipboard.writeText("ollama pull llama3.2")}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono cursor-pointer hover:bg-white/[0.06] transition-colors"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                  title="Click to copy"
                >
                  <code className="text-white/70">ollama pull llama3.2</code>
                </button>
              </p>
              <p className="text-white/50">3. Click <span className="text-white/70">Refresh</span> above</p>
            </div>
          )}
        </div>
      )}

      {/* Cloud API section */}
      {effectiveBackend === "cloud" && (() => {
        const activeProvider =
          settings.ai_cloud_api_url.includes("openai.com")      ? "openai"
          : settings.ai_cloud_api_url.includes("anthropic.com") ? "anthropic"
          : settings.ai_cloud_api_url.includes("googleapis.com") || settings.ai_cloud_api_url.includes("generativelanguage") ? "google"
          : settings.ai_cloud_api_url.includes("groq.com")      ? "groq"
          : settings.ai_cloud_api_url.includes("mistral.ai")    ? "mistral"
          : settings.ai_cloud_api_url.includes("openrouter.ai") ? "openrouter"
          : "custom";

        return (
          <div className="card mb-5 overflow-hidden">
            {/* Status banner */}
            {settings.ai_cloud_verified ? (
              <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(52,211,153,0.05)" }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.5)" }} />
                <div className="flex-1 text-xs">
                  <span className="font-semibold" style={{ color: "#34d399" }}>Connected</span>
                  <span className="text-white/40 ml-2 font-mono capitalize">{activeProvider} · {settings.ai_cloud_model}</span>
                </div>
              </div>
            ) : cloudTestError ? (
              <div className="flex items-start gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(248,113,113,0.05)" }}>
                <div className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ background: "#f87171", boxShadow: "0 0 6px rgba(248,113,113,0.5)" }} />
                <div className="flex-1 text-xs">
                  <span className="font-semibold text-red-400">Connection failed</span>
                  <span className="text-white/40 ml-2">{cloudTestError}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(251,191,36,0.05)" }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#fbbf24", boxShadow: "0 0 6px rgba(251,191,36,0.5)" }} />
                <span className="text-xs" style={{ color: "#fbbf24" }}>Not verified — enter your API key and test the connection</span>
              </div>
            )}

            <div className="px-5">
              {/* Provider */}
              <SettingRow label="Provider" description="OpenAI-compatible API">
                <select
                  value={activeProvider}
                  onChange={(e) => {
                    const presets: Record<string, { url: string; model: string }> = {
                      openai:     { url: "https://api.openai.com/v1",                                  model: "gpt-4o-mini" },
                      anthropic:  { url: "https://api.anthropic.com/v1",                               model: "claude-haiku-4-5-20251001" },
                      google:     { url: "https://generativelanguage.googleapis.com/v1beta/openai",     model: "gemini-2.0-flash" },
                      groq:       { url: "https://api.groq.com/openai/v1",                             model: "llama3-8b-8192" },
                      mistral:    { url: "https://api.mistral.ai/v1",                                  model: "mistral-small-latest" },
                      openrouter: { url: "https://openrouter.ai/api/v1",                               model: "openai/gpt-4o-mini" },
                      custom:     { url: "", model: "" },
                    };
                    const p = presets[e.target.value];
                    setCloudTestError(null);
                    update({ ai_cloud_api_url: p.url, ai_cloud_model: p.model, ai_cloud_verified: false });
                  }}
                  className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google Gemini</option>
                  <option value="groq">Groq</option>
                  <option value="mistral">Mistral</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="custom">Custom</option>
                </select>
              </SettingRow>

              {/* Custom API URL — only for custom provider */}
              {activeProvider === "custom" && (
                <SettingRow label="API URL" description="Base URL of your OpenAI-compatible endpoint">
                  <input
                    type="text"
                    value={settings.ai_cloud_api_url}
                    onChange={(e) => { setCloudTestError(null); update({ ai_cloud_api_url: e.target.value, ai_cloud_verified: false }); }}
                    placeholder="https://your-api.example.com/v1"
                    className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-56 font-mono"
                    style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                  />
                </SettingRow>
              )}

              {/* API Key */}
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
                      placeholder="API key…"
                      className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-56 font-mono"
                      style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                    />
                    <button onClick={() => setShowApiKey((v) => !v)} className="text-white/50 hover:text-white/60 text-xs cursor-pointer">{showApiKey ? "Hide" : "Show"}</button>
                    <button onClick={handleSaveApiKey} disabled={!apiKeyInput.trim()} className="btn-ghost text-xs py-1 px-2">Save</button>
                  </div>
                )}
              </SettingRow>

              {/* Model */}
              <SettingRow label="Model" description="Model name">
                <div className="flex flex-col items-end gap-1.5">
                  {(() => {
                    const presets = MODEL_PRESETS[activeProvider] ?? [];
                    const isOther = presets.length > 0 && !presets.includes(settings.ai_cloud_model);
                    return presets.length > 0 ? (
                      <>
                        <select
                          value={isOther ? "__other__" : settings.ai_cloud_model}
                          onChange={(e) => {
                            if (e.target.value === "__other__") {
                              setCustomModelInput(settings.ai_cloud_model);
                            } else {
                              setCustomModelInput("");
                              update({ ai_cloud_model: e.target.value, ai_cloud_verified: false });
                              setCloudTestError(null);
                            }
                          }}
                          className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none w-40 font-mono"
                          style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                        >
                          {presets.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="__other__">Other…</option>
                        </select>
                        {isOther && (
                          <input
                            type="text"
                            value={customModelInput || settings.ai_cloud_model}
                            onChange={(e) => setCustomModelInput(e.target.value)}
                            onBlur={() => {
                              if (customModelInput.trim()) {
                                update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                                setCloudTestError(null);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && customModelInput.trim()) {
                                update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                                setCloudTestError(null);
                              }
                            }}
                            placeholder="model-id"
                            className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-40 font-mono"
                            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                          />
                        )}
                      </>
                    ) : (
                      <input
                        type="text"
                        value={customModelInput || settings.ai_cloud_model}
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        onBlur={() => {
                          if (customModelInput.trim()) {
                            update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                            setCloudTestError(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && customModelInput.trim()) {
                            update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                            setCloudTestError(null);
                          }
                        }}
                        placeholder="model-name"
                        className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-40 font-mono"
                        style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                      />
                    );
                  })()}
                </div>
              </SettingRow>

              {/* Test Connection */}
              <div className="py-3 flex items-center gap-3">
                <button
                  onClick={() => handleTestConnection("cloud")}
                  disabled={testLoading || !apiKeySet}
                  className="btn-ghost text-xs py-1 px-3"
                >
                  {testLoading ? "Testing…" : "Test Connection"}
                </button>
              </div>

              <p className="text-white/35 text-xs pb-3 leading-relaxed">
                When using Cloud API, your transcription text is sent to the provider. Audio never leaves your device.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Smart Dictation config */}
      <h3 className="text-t3 text-[10px] uppercase tracking-widest mt-2 mb-4 font-mono">Smart Dictation</h3>
      <div className="card px-5 mb-5">
        <SettingRow label="Shortcut" description="Hotkey for Smart Dictation">
          <div className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/60 text-xs font-mono">⌘⇧B</div>
        </SettingRow>
        <SettingRow label="Default Style" description="Polish style applied on stop">
          <select
            value={settings.active_polish_style}
            onChange={(e) => update({ active_polish_style: e.target.value })}
            className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
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
              className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
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
            className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
          >
            <option value={15}>15s</option>
            <option value={30}>30s</option>
            <option value={60}>60s</option>
          </select>
        </SettingRow>
      </div>

      {/* Polish styles — built-in */}
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
            className="w-full rounded-lg px-3 py-2 text-white/70 text-xs outline-none"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
          />
          <textarea
            value={newStylePrompt}
            onChange={(e) => setNewStylePrompt(e.target.value)}
            placeholder="System prompt…"
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-white/70 text-xs outline-none resize-none font-mono"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
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
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface AiModelsViewProps {
  activeModel: string;
  onModelChange: (name: string) => void;
  initialTab?: "whisper" | "smart-dictation";
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AiModelsView({ activeModel, onModelChange, initialTab }: AiModelsViewProps) {
  const [activeTab, setActiveTab] = useState<"whisper" | "smart-dictation">(initialTab ?? "whisper");

  return (
    <div className="w-full max-w-2xl mx-auto px-8 py-6">
      {/* Pill tabs */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-xl"
        style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
      >
        {(["whisper", "smart-dictation"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer"
            style={{
              background: activeTab === tab ? "var(--bg)" : "transparent",
              color: activeTab === tab ? "var(--accent)" : "var(--t3)",
              boxShadow: activeTab === tab ? "var(--nm-raised-sm)" : "none",
            }}
          >
            {tab === "whisper" ? "Whisper" : "Smart Dictation"}
          </button>
        ))}
      </div>

      {activeTab === "whisper" && <WhisperTab activeModel={activeModel} onModelChange={onModelChange} />}
      {activeTab === "smart-dictation" && <SmartDictationTab />}
    </div>
  );
}
