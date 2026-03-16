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

// ── Whisper sub-tab ───────────────────────────────────────────────────────────
function WhisperTab({ activeModel, onModelChange }: { activeModel: string; onModelChange: (name: string) => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [diskUsage, setDiskUsage] = useState(0);
  const [_isLicensed, setIsLicensed] = useState(false);
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
    invoke<string>("get_license_status").then((s) => setIsLicensed(s === "Licensed" || s === "GracePeriod")).catch(() => {});
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
    await invoke("delete_model", { name });
    if (activeModel === name) onModelChange("tiny.en");
    loadModels();
  }

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
          <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--t2)" }}>{recommendation.reason}</p>
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
                              <button onClick={() => handleDelete(model.name)} className="btn-ghost text-xs px-3 py-1.5" style={{ fontSize: 11 }}>Delete</button>
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
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    invoke<AppSettings>("get_settings").then(setSettings).catch(() => {});
    invoke<boolean>("get_cloud_api_key_status").then(setApiKeySet).catch(() => {});
    invoke<{ built_in: BuiltInStyle[]; custom: CustomStyle[] }>("get_polish_styles")
      .then((styles) => { setBuiltInStyles(styles.built_in); setCustomStyles(styles.custom); })
      .catch(() => {});
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
    await invoke("delete_cloud_api_key_cmd").catch(() => {});
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

  async function update(patch: Partial<AppSettings>) {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await invoke("update_settings", { newSettings: updated });
  }

  if (!settings) {
    return <div className="flex items-center justify-center h-64 text-white/35 text-sm">Loading…</div>;
  }

  return (
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
              className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none max-w-[160px]"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
            >
              {(ollamaStatus?.models.length ? ollamaStatus.models : [settings.ai_ollama_model]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </SettingRow>
          <div className="py-3 flex items-center gap-3">
            <button onClick={() => handleTestConnection("ollama")} disabled={testLoading} className="btn-ghost text-xs py-1 px-3">
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
              className="text-white/60 text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
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
                  className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-32 font-mono"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
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
              className="rounded-lg px-3 py-1.5 text-white/60 text-xs outline-none w-32 font-mono"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
            />
          </SettingRow>
          <div className="py-3 flex items-center gap-3">
            <button onClick={() => handleTestConnection("cloud")} disabled={testLoading || !apiKeySet} className="btn-ghost text-xs py-1 px-3">
              {testLoading ? "Testing…" : "Test Connection"}
            </button>
            {testResult && <span className={`text-xs font-mono ${testResult.startsWith("✓") ? "text-emerald-400" : "text-red-400/70"}`}>{testResult}</span>}
          </div>
          <p className="text-white/35 text-xs pb-3 leading-relaxed">
            When using Cloud API, your transcription text is sent to the provider. Audio never leaves your device.
          </p>
        </div>
      )}

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
