import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sparkles } from "lucide-react";
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
        <p className="text-sm font-medium" style={{ color: "var(--t1)" }}>{label}</p>
        {description && <p className="text-xs mt-0.5" style={{ color: "var(--t3)" }}>{description}</p>}
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

// ── Reusable model card ───────────────────────────────────────────────────────
interface ModelCardProps {
  name: string;
  displayName?: string;
  description: string;
  sizeLabel: string;
  isActive: boolean;
  isRecommended?: boolean;
  isEnOnly?: boolean;
  showLangBadge?: boolean;
  isDownloaded: boolean;
  downloadedCount: number;
  progress: number | undefined; // undefined = not downloading
  error?: string;
  onSetActive: () => void;
  onDownload: () => void;
  onCancelDownload: () => void;
  onDelete: () => void;
}

function ModelCard({
  name, displayName, description, sizeLabel,
  isActive, isRecommended, isEnOnly, showLangBadge,
  isDownloaded, downloadedCount,
  progress, error,
  onSetActive, onDownload, onCancelDownload, onDelete,
}: ModelCardProps) {
  const isDownloading = progress !== undefined;
  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-200"
      style={{
        background: isActive
          ? "color-mix(in srgb, var(--accent) 8%, var(--bg))"
          : "var(--bg)",
        boxShadow: isActive
          ? "var(--nm-pressed-sm), 0 0 0 1.5px color-mix(in srgb, var(--accent) 40%, transparent)"
          : "var(--nm-raised-sm)",
      }}
    >
      {/* Left accent bar for active state */}
      <div className="flex">
        <div
          className="w-1 shrink-0 transition-all duration-200"
          style={{
            background: isActive ? "var(--accent)" : "transparent",
            boxShadow: isActive ? "2px 0 8px color-mix(in srgb, var(--accent) 50%, transparent)" : "none",
          }}
        />
        <div className="flex-1 px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm" style={{ color: isActive ? "var(--accent)" : "var(--t1)" }}>{displayName ?? name}</span>
            {showLangBadge && isEnOnly && (
              <span className="text-[10px] px-1.5 py-px rounded font-mono" style={{ color: "var(--t4)", background: "color-mix(in srgb, var(--t1) 6%, transparent)" }}>EN</span>
            )}
            {showLangBadge && !isEnOnly && (
              <span className="text-[10px] px-1.5 py-px rounded font-mono" style={{ color: "var(--t4)", background: "color-mix(in srgb, var(--t1) 6%, transparent)" }}>Multi</span>
            )}
            {isActive && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"
                style={{
                  color: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 15%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
                }}
              >
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" style={{ display: "inline" }}>
                  <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Active
              </span>
            )}
            {isRecommended && !isActive && (
              <span className="text-[10px] px-1.5 py-px rounded font-mono flex items-center gap-0.5" style={{ color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)", background: "color-mix(in srgb, var(--accent) 7%, transparent)" }}>
                <Sparkles size={8} />Recommended
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--t2)" }}>{description}</p>
          <p className="text-[11px] mt-1 font-mono" style={{ color: "var(--t4)" }}>{sizeLabel}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {isDownloaded ? (
            <>
              {!isActive && <button onClick={onSetActive} className="btn-primary text-xs px-3 py-1.5">Set Active</button>}
              {!isActive && (
                <button
                  onClick={onDelete}
                  disabled={downloadedCount <= 1}
                  className="btn-ghost text-xs px-3 py-1.5"
                  style={{ fontSize: 11, opacity: downloadedCount <= 1 ? 0.35 : 1, cursor: downloadedCount <= 1 ? "not-allowed" : "pointer" }}
                  title={downloadedCount <= 1 ? "At least one model must remain downloaded" : "Delete model"}
                >Delete</button>
              )}
            </>
          ) : isDownloading ? (
            <div className="flex items-center gap-2">
              <div className="text-right min-w-[52px]">
                <p className="text-[11px] font-mono mb-1" style={{ color: "var(--accent)" }}>{Math.round((progress ?? 0) * 100)}%</p>
                <div className="h-1 rounded-full overflow-hidden" style={{ width: 52, background: "color-mix(in srgb, var(--t1) 8%, transparent)" }}>
                  <div className="h-full rounded-full transition-all duration-200" style={{ width: `${(progress ?? 0) * 100}%`, background: "var(--accent)" }} />
                </div>
              </div>
              <button
                onClick={onCancelDownload}
                className="text-[11px] px-2 py-1 rounded-lg cursor-pointer transition-all duration-150 font-medium"
                style={{ color: "var(--t3)", background: "var(--bg)", boxShadow: "var(--nm-raised-sm)", border: "1px solid transparent" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#f87171"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(248,113,113,0.3)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t3)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; }}
                title="Cancel download"
              >Cancel</button>
            </div>
          ) : (
            <button
              onClick={onDownload}
              className="text-xs px-3 py-1.5 rounded-lg transition-all duration-150 cursor-pointer font-medium"
              style={{ color: "var(--t2)", background: "var(--bg)", boxShadow: "var(--nm-raised-sm)", border: isRecommended ? "1px solid color-mix(in srgb, var(--accent) 25%, transparent)" : "1px solid transparent" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "color-mix(in srgb, var(--accent) 40%, transparent)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t2)"; (e.currentTarget as HTMLButtonElement).style.borderColor = isRecommended ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "transparent"; }}
            >Download</button>
          )}
        </div>
      </div>
      {error && <p className="text-red-400 text-xs mt-2">✗ {error}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Moonshine types ───────────────────────────────────────────────────────────
interface MoonshineVariantInfo {
  name: string;
  display_name: string;
  description: string;
  size_label: string;
  total_size_bytes: number;
  model_arch: number;
  is_downloaded: boolean;
}

// ── Whisper section ───────────────────────────────────────────────────────────
function WhisperSection({ activeModel, isActiveEngine, onModelChange, downloading, errors, onDownload, onCancelDownload, onDelete, defaultExpanded }: {
  activeModel: string;
  isActiveEngine: boolean;
  onModelChange: (name: string) => void;
  downloading: Record<string, number>;
  errors: Record<string, string>;
  onDownload: (name: string) => void;
  onCancelDownload: (name: string) => void;
  onDelete: (name: string) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [diskUsage, setDiskUsage] = useState(0);

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
  }, []);

  // Reload when a download finishes (detected by downloading map shrinking)
  const prevDownloadingRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const prev = prevDownloadingRef.current;
    const justFinished = Object.keys(prev).some(k => !(k in downloading));
    if (justFinished) loadModels();
    prevDownloadingRef.current = downloading;
  }, [downloading]);

  const downloadedCount = models.filter(m => m.is_downloaded).length;

  // Build paired model list: tiny.en/tiny, base.en/base, …, then large variants
  const englishOnly = models.filter(m => m.category === "English Only");
  const multilingual = models.filter(m => m.category === "Multilingual");
  const turbo = models.filter(m => m.category === "Turbo");
  const pairedModels: ModelInfo[] = [];
  const usedMultilingual = new Set<string>();
  for (const en of englishOnly) {
    const baseName = en.name.replace(/\.en$/, "");
    const pair = multilingual.find(m => m.name === baseName);
    pairedModels.push(en);
    if (pair) { pairedModels.push(pair); usedMultilingual.add(pair.name); }
  }
  const orderedModels = [
    ...pairedModels,
    ...multilingual.filter(m => !usedMultilingual.has(m.name)),
    ...turbo,
  ];

  const downloadedModels = models.filter(m => m.is_downloaded);

  return (
    <div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between mb-3 group"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <div className="flex items-center gap-2.5">
          <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: isActiveEngine ? "var(--accent)" : "var(--t4)" }}>Whisper</p>
          {isActiveEngine && (
            <span className="text-[9px] px-1.5 py-px rounded-full font-semibold" style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}>Active Engine</span>
          )}
          {!expanded && downloadedModels.length > 0 && (
            <span className="text-[10px] font-mono" style={{ color: "var(--t4)" }}>{downloadedModels.length} downloaded</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {expanded && <p className="text-[11px] font-mono" style={{ color: "var(--t4)" }}>{formatBytes(diskUsage)} on disk</p>}
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ color: "var(--t4)", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s ease" }}
          >
            <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="space-y-2.5">
          {orderedModels.map((model) => (
            <ModelCard
              key={model.name}
              name={model.name}
              description={model.description}
              sizeLabel={model.size_label}
              isActive={isActiveEngine && activeModel === model.name}
              isEnOnly={model.is_english_only}
              showLangBadge={true}
              isDownloaded={model.is_downloaded}
              downloadedCount={downloadedCount}
              progress={model.name in downloading ? downloading[model.name] : undefined}
              error={errors[model.name]}
              onSetActive={() => onModelChange(model.name)}
              onDownload={() => onDownload(model.name)}
              onCancelDownload={() => onCancelDownload(model.name)}
              onDelete={() => onDelete(model.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Moonshine section ─────────────────────────────────────────────────────────
function MoonshineSection({ activeMoonshineModel, isActiveEngine, onMoonshineModelChange, downloading, errors, onDownload, onCancelDownload, onDelete, defaultExpanded }: {
  activeMoonshineModel: string;
  isActiveEngine: boolean;
  onMoonshineModelChange: (name: string) => void;
  downloading: Record<string, number>;
  errors: Record<string, string>;
  onDownload: (name: string) => void;
  onCancelDownload: (name: string) => void;
  onDelete: (name: string) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [variants, setVariants] = useState<MoonshineVariantInfo[]>([]);
  const [diskUsage, setDiskUsage] = useState(0);

  async function loadVariants() {
    const list = await invoke<MoonshineVariantInfo[]>("get_moonshine_models").catch(() => [] as MoonshineVariantInfo[]);
    setVariants(list);
    const used = list.filter(v => v.is_downloaded).reduce((sum, v) => sum + v.total_size_bytes, 0);
    setDiskUsage(used);
  }

  useEffect(() => { loadVariants(); }, []);

  const prevDownloadingRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const prev = prevDownloadingRef.current;
    const justFinished = Object.keys(prev).some(k => !(k in downloading));
    if (justFinished) loadVariants();
    prevDownloadingRef.current = downloading;
  }, [downloading]);

  const downloadedCount = variants.filter(v => v.is_downloaded).length;
  const downloadedVariants = variants.filter(v => v.is_downloaded);

  return (
    <div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between mb-3 group"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <div className="flex items-center gap-2.5">
          <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: isActiveEngine ? "var(--accent)" : "var(--t4)" }}>Moonshine</p>
          {isActiveEngine && (
            <span className="text-[9px] px-1.5 py-px rounded-full font-semibold" style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}>Active Engine</span>
          )}
          {!expanded && downloadedVariants.length > 0 && (
            <span className="text-[10px] font-mono" style={{ color: "var(--t4)" }}>{downloadedVariants.length} downloaded</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {expanded && <p className="text-[11px] font-mono" style={{ color: "var(--t4)" }}>{formatBytes(diskUsage)} on disk</p>}
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ color: "var(--t4)", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s ease" }}
          >
            <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="space-y-2.5">
          {variants.map((v) => {
            const key = `moonshine:${v.name}`;
            return (
              <ModelCard
                key={v.name}
                name={v.name}
                displayName={v.display_name}
                description={v.description}
                sizeLabel={v.size_label}
                isActive={isActiveEngine && activeMoonshineModel === v.name}
                isEnOnly={true}
                isDownloaded={v.is_downloaded}
                downloadedCount={downloadedCount}
                progress={key in downloading ? downloading[key] : undefined}
                error={errors[key]}
                onSetActive={() => onMoonshineModelChange(v.name)}
                onDownload={() => onDownload(key)}
                onCancelDownload={() => onCancelDownload(key)}
                onDelete={() => onDelete(v.name)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Models tab (Whisper + Moonshine combined) ─────────────────────────────────
function ModelsTab({ activeModel, onModelChange, activeMoonshineModel, onMoonshineModelChange, transcriptionEngine, platform }: {
  activeModel: string;
  onModelChange: (name: string) => void;
  activeMoonshineModel: string;
  onMoonshineModelChange: (name: string) => void;
  transcriptionEngine: string;
  platform: string;
}) {
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const unlisten = listen<{ name: string; downloaded: number; total: number; done?: boolean; error?: string }>("download-progress", (event) => {
      const { name, downloaded, total, done, error } = event.payload;
      const progress = total > 0 ? downloaded / total : 0;
      if (done) {
        setDownloading((prev) => { const next = { ...prev }; delete next[name]; return next; });
        if (error) setErrors((prev) => ({ ...prev, [name]: error }));
        else setErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
      } else {
        setDownloading((prev) => ({ ...prev, [name]: progress }));
        setErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  async function handleWhisperDownload(name: string) {
    setErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
    setDownloading((prev) => ({ ...prev, [name]: 0 }));
    await invoke("download_model", { name });
  }

  async function handleWhisperCancelDownload(name: string) {
    await invoke("cancel_model_download", { name });
    setDownloading((prev) => { const next = { ...prev }; delete next[name]; return next; });
  }

  async function handleWhisperDelete(name: string) {
    await invoke("delete_model", { name });
  }

  async function handleMoonshineDownload(key: string) {
    const variant = key.replace("moonshine:", "");
    setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
    setDownloading((prev) => ({ ...prev, [key]: 0 }));
    await invoke("download_moonshine_model", { variant });
  }

  async function handleMoonshineCancelDownload(key: string) {
    const variant = key.replace("moonshine:", "");
    await invoke("cancel_moonshine_model_download", { variant });
    setDownloading((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  async function handleMoonshineDelete(variant: string) {
    await invoke("delete_moonshine_model", { variant });
    if (activeMoonshineModel === variant) {
      onMoonshineModelChange("tiny-streaming-en");
    }
  }

  return (
    <div className="space-y-8">
      <WhisperSection
        activeModel={activeModel}
        isActiveEngine={transcriptionEngine === "whisper"}
        onModelChange={onModelChange}
        downloading={downloading}
        errors={errors}
        onDownload={handleWhisperDownload}
        onCancelDownload={handleWhisperCancelDownload}
        onDelete={handleWhisperDelete}
        defaultExpanded={transcriptionEngine === "whisper"}
      />
      {platform === "macos" && (
        <>
          <div style={{ borderTop: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }} />
          <MoonshineSection
            activeMoonshineModel={activeMoonshineModel}
            isActiveEngine={transcriptionEngine === "moonshine"}
            onMoonshineModelChange={onMoonshineModelChange}
            downloading={downloading}
            errors={errors}
            onDownload={handleMoonshineDownload}
            onCancelDownload={handleMoonshineCancelDownload}
            onDelete={handleMoonshineDelete}
            defaultExpanded={transcriptionEngine === "moonshine"}
          />
        </>
      )}

      {/* Engine comparison guide */}
      <div style={{ borderTop: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)", paddingTop: 24 }}>
        <p className="text-[10px] font-mono uppercase tracking-widest mb-4" style={{ color: "var(--t4)" }}>Which engine should I use?</p>
        <div className="grid grid-cols-2 gap-3">
          {/* Whisper card */}
          <div
            className="rounded-xl p-4"
            style={{
              background: transcriptionEngine === "whisper"
                ? "color-mix(in srgb, var(--accent) 6%, var(--bg))"
                : "var(--bg)",
              boxShadow: transcriptionEngine === "whisper"
                ? "var(--nm-pressed-sm), 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent)"
                : "var(--nm-raised-sm)",
            }}
          >
            <p className="text-xs font-semibold mb-3" style={{ color: transcriptionEngine === "whisper" ? "var(--accent)" : "var(--t1)" }}>Whisper</p>
            <ul className="space-y-2">
              {[
                { icon: "🌐", text: "99 languages" },
                { icon: "🎯", text: "Higher accuracy" },
                { icon: "📝", text: "Complex vocabulary" },
                { icon: "⚡", text: "GPU-accelerated on Mac" },
              ].map(({ icon, text }) => (
                <li key={text} className="flex items-start gap-2">
                  <span className="text-[11px] leading-tight mt-px">{icon}</span>
                  <span className="text-[11px] leading-tight" style={{ color: "var(--t2)" }}>{text}</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] mt-3 pt-3" style={{ color: "var(--t4)", borderTop: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
              Best for: meetings, interviews, non-English content
            </p>
          </div>

          {/* Moonshine card */}
          <div
            className="rounded-xl p-4"
            style={{
              background: transcriptionEngine === "moonshine"
                ? "color-mix(in srgb, var(--accent) 6%, var(--bg))"
                : "var(--bg)",
              boxShadow: transcriptionEngine === "moonshine"
                ? "var(--nm-pressed-sm), 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent)"
                : "var(--nm-raised-sm)",
              opacity: platform !== "macos" ? 0.4 : 1,
            }}
          >
            <div className="flex items-center gap-1.5 mb-3">
              <p className="text-xs font-semibold" style={{ color: transcriptionEngine === "moonshine" ? "var(--accent)" : "var(--t1)" }}>Moonshine</p>
              <span className="text-[9px] px-1 py-px rounded font-mono" style={{ color: "var(--t4)", background: "color-mix(in srgb, var(--t1) 8%, transparent)" }}>macOS</span>
            </div>
            <ul className="space-y-2">
              {[
                { icon: "🚀", text: "5× faster than Whisper" },
                { icon: "⏱️", text: "Ultra-low latency" },
                { icon: "🎙️", text: "Built-in voice detection" },
                { icon: "🇬🇧", text: "English only" },
              ].map(({ icon, text }) => (
                <li key={text} className="flex items-start gap-2">
                  <span className="text-[11px] leading-tight mt-px">{icon}</span>
                  <span className="text-[11px] leading-tight" style={{ color: "var(--t2)" }}>{text}</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] mt-3 pt-3" style={{ color: "var(--t4)", borderTop: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}>
              Best for: live dictation, quick notes, real-time use
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Smart Dictation sub-tab ───────────────────────────────────────────────────
function SmartDictationTab() {
  const isWindows = navigator.platform.startsWith("Win");
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
  const [customModelMode, setCustomModelMode] = useState(false);
  const cloudSettingsLoadedRef = useRef(false);

  useEffect(() => {
    setCustomModelInput("");
    setCustomModelMode(false);
  }, [settings?.ai_cloud_api_url, settings?.ai_cloud_model]);

  useEffect(() => {
    if (!settings) return;
    // Skip on initial settings load — only reset on user-initiated changes
    if (!cloudSettingsLoadedRef.current) {
      cloudSettingsLoadedRef.current = true;
      return;
    }
    setCloudTestError(null);
    if (settings.ai_cloud_verified) {
      update({ ai_cloud_verified: false });
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
    // Reload settings so the cloud_api_key is in React state before update() spreads it
    const fresh = await invoke<AppSettings>("get_settings");
    setSettings(fresh);
    await invoke("update_settings", { newSettings: { ...fresh, ai_cloud_verified: false } });
  }

  async function handleDeleteApiKey() {
    await invoke("delete_cloud_api_key_cmd").catch(() => {});
    setApiKeySet(false);
    setCloudTestError(null);
    const fresh = await invoke<AppSettings>("get_settings");
    setSettings(fresh);
    await invoke("update_settings", { newSettings: { ...fresh, ai_cloud_verified: false } });
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
    return <div className="flex items-center justify-center h-64 text-sm" style={{ color: "var(--t4)" }}>Loading…</div>;
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
                border: isSelected ? "1px solid rgba(139,92,246,0.5)" : "1px solid var(--border)",
                background: isSelected ? "rgba(139,92,246,0.07)" : "var(--surface)",
              }}
            >
              {/* radio dot */}
              <div
                className="absolute top-3 right-3 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                style={{
                  border: isSelected ? "1.5px solid rgb(139,92,246)" : "1.5px solid var(--t3)",
                  background: isSelected ? "rgb(139,92,246)" : "transparent",
                }}
              >
                {isSelected && <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--bg)" }} />}
              </div>
              <span className="text-base leading-none">{icon}</span>
              <span className="text-xs font-semibold pr-5" style={{ color: isSelected ? "rgb(167,139,250)" : "var(--t1)" }}>
                {name}
              </span>
              <span className="text-[10px]" style={{ color: "var(--t4)" }}>{description}</span>
              {badge && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: badge === "Running" || badge === "Connected" ? "var(--accent-bg)" : "var(--warning-border)",
                    color:      badge === "Running" || badge === "Connected" ? "var(--accent)"  : "var(--warning)",
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
            <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
              <div className="w-2.5 h-2.5 rounded-full animate-pulse flex-shrink-0" style={{ background: "var(--t4)" }} />
              <span className="text-xs" style={{ color: "var(--t3)" }}>Checking Ollama…</span>
            </div>
          ) : ollamaStatus?.running ? (
            <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)", background: "rgba(52,211,153,0.05)" }}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.5)" }} />
              <div className="flex-1 min-w-0 text-xs">
                <span className="font-semibold" style={{ color: "#34d399" }}>Connected</span>
                <span className="ml-2 font-mono" style={{ color: "var(--t3)" }}>
                  {settings.ai_ollama_model} · {settings.ai_ollama_url} · {ollamaStatus.models.length} models
                </span>
              </div>
              <button onClick={refreshOllamaStatus} disabled={ollamaChecking} className="btn-ghost text-xs py-1 px-3 flex-shrink-0">Refresh</button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)", background: "var(--warning-border)" }}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "var(--warning)", boxShadow: "0 0 6px var(--warning-muted)" }} />
              <div className="flex-1 text-xs">
                <span className="font-semibold" style={{ color: "var(--warning)" }}>Ollama not detected</span>
                <span className="ml-2" style={{ color: "var(--t3)" }}>Install and start Ollama to continue</span>
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
                  className="text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none max-w-[160px]"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
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
                  className="text-xs rounded-lg px-3 py-1.5 outline-none max-w-[200px]"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
                />
              </SettingRow>
            </div>
          )}

          {/* Setup guide — only when not running */}
          {!ollamaChecking && ollamaStatus !== null && !ollamaStatus.running && (
            <div className="px-5 py-4 space-y-2 text-xs leading-relaxed">
              <p style={{ color: "var(--t3)" }}>1. Download from{" "}
                <span
                  onClick={() => invoke("open_external_url", { url: "https://ollama.com" })}
                  className="text-violet-400 underline cursor-pointer hover:text-violet-300 transition-colors"
                >
                  ollama.com
                </span>
              </p>
              <p className="flex items-center gap-2" style={{ color: "var(--t3)" }}>
                <span>2. Run:</span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono" style={{ background: "var(--border)" }}>
                  <code className="select-text" style={{ color: "var(--t2)" }}>ollama pull llama3.2</code>
                  <button
                    onClick={() => navigator.clipboard.writeText("ollama pull llama3.2")}
                    className="transition-colors cursor-pointer"
                    style={{ color: "var(--t4)" }}
                    title="Copy"
                  >⧉</button>
                </span>
              </p>
              <p style={{ color: "var(--t3)" }}>3. Click <span style={{ color: "var(--t2)" }}>Refresh</span> above</p>
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
              <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)", background: "rgba(52,211,153,0.05)" }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.5)" }} />
                <div className="flex-1 text-xs">
                  <span className="font-semibold" style={{ color: "#34d399" }}>Connected</span>
                  <span className="ml-2 font-mono capitalize" style={{ color: "var(--t3)" }}>{activeProvider} · {settings.ai_cloud_model}</span>
                </div>
              </div>
            ) : cloudTestError ? (
              <div className="flex items-start gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)", background: "rgba(248,113,113,0.05)" }}>
                <div className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ background: "#f87171", boxShadow: "0 0 6px rgba(248,113,113,0.5)" }} />
                <div className="flex-1 text-xs">
                  <span className="font-semibold text-red-400">Connection failed</span>
                  <span className="ml-2" style={{ color: "var(--t3)" }}>{cloudTestError}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)", background: "var(--warning-border)" }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: "var(--warning)", boxShadow: "0 0 6px var(--warning-muted)" }} />
                <span className="text-xs" style={{ color: "var(--warning)" }}>Not verified — enter your API key and test the connection</span>
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
                  className="text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
                  style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
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
                    className="rounded-lg px-3 py-1.5 text-xs outline-none w-56 font-mono"
                    style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
                  />
                </SettingRow>
              )}

              {/* API Key */}
              <SettingRow label="API Key" description={apiKeySet ? "Key saved" : "Paste your API key"}>
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
                      className="rounded-lg px-3 py-1.5 text-xs outline-none w-56 font-mono"
                      style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                    />
                    <button onClick={() => setShowApiKey((v) => !v)} className="text-xs cursor-pointer" style={{ color: "var(--t3)" }}>{showApiKey ? "Hide" : "Show"}</button>
                    <button onClick={handleSaveApiKey} disabled={!apiKeyInput.trim()} className="btn-ghost text-xs py-1 px-2">Save</button>
                  </div>
                )}
              </SettingRow>

              {/* Model */}
              <SettingRow label="Model" description="Model name">
                <div className="flex flex-col items-end gap-1.5">
                  {(() => {
                    const presets = MODEL_PRESETS[activeProvider] ?? [];
                    const isOther = presets.length > 0 && (customModelMode || !presets.includes(settings.ai_cloud_model));
                    return presets.length > 0 ? (
                      <>
                        <select
                          value={isOther ? "__other__" : settings.ai_cloud_model}
                          onChange={(e) => {
                            if (e.target.value === "__other__") {
                              setCustomModelMode(true);
                              setCustomModelInput("");
                            } else {
                              setCustomModelMode(false);
                              setCustomModelInput("");
                              update({ ai_cloud_model: e.target.value, ai_cloud_verified: false });
                              setCloudTestError(null);
                            }
                          }}
                          className="text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none w-40 font-mono"
                          style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
                        >
                          {presets.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          <option value="__other__">Other…</option>
                        </select>
                        {isOther && (
                          <input
                            type="text"
                            autoFocus
                            value={customModelInput}
                            onChange={(e) => setCustomModelInput(e.target.value)}
                            onBlur={() => {
                              if (customModelInput.trim()) {
                                update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                                setCloudTestError(null);
                              } else {
                                setCustomModelMode(false);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && customModelInput.trim()) {
                                update({ ai_cloud_model: customModelInput.trim(), ai_cloud_verified: false });
                                setCloudTestError(null);
                              } else if (e.key === "Escape") {
                                setCustomModelMode(false);
                                setCustomModelInput("");
                              }
                            }}
                            placeholder={settings.ai_cloud_model || "model-id"}
                            className="rounded-lg px-3 py-1.5 text-xs outline-none w-40 font-mono"
                            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
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
                        className="rounded-lg px-3 py-1.5 text-xs outline-none w-40 font-mono"
                        style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
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

              <p className="text-xs pb-3 leading-relaxed" style={{ color: "var(--t4)" }}>
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
          <div className="px-3 py-1.5 rounded-lg text-xs font-mono" style={{ background: "var(--border)", color: "var(--t2)" }}>{isWindows ? "Alt+Shift+B" : "⌘⇧B"}</div>
        </SettingRow>
        <SettingRow label="Default Style" description="Polish style applied on stop">
          <select
            value={settings.active_polish_style}
            onChange={(e) => update({ active_polish_style: e.target.value })}
            className="text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
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
              className="text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
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
            className="text-xs rounded-lg px-3 py-1.5 cursor-pointer outline-none"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
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
          <div key={s.id} className="flex items-center justify-between py-2.5 last:border-0" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--t2)" }}>{s.name}</p>
              <p className="text-xs" style={{ color: "var(--t3)" }}>{s.description}</p>
            </div>
            <span className="text-[10px] font-mono" style={{ color: "var(--t3)" }}>built-in</span>
          </div>
        ))}
      </div>

      {/* Custom styles */}
      <h3 className="text-t3 text-[10px] uppercase tracking-widest mt-2 mb-4 font-mono">Custom Styles</h3>
      <div className="card px-5 mb-4">
        {customStyles.length === 0 && (
          <p className="text-xs py-3" style={{ color: "var(--t4)" }}>No custom styles yet.</p>
        )}
        {customStyles.map((s) => (
          <div key={s.name} className="flex items-start justify-between py-2.5 last:border-0 gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "var(--t2)" }}>{s.name}</p>
              <p className="text-xs truncate" style={{ color: "var(--t3)" }}>{s.system_prompt.slice(0, 60)}…</p>
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
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
          />
          <textarea
            value={newStylePrompt}
            onChange={(e) => setNewStylePrompt(e.target.value)}
            placeholder="System prompt…"
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none font-mono"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t2)" }}
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
  activeMoonshineModel: string;
  onMoonshineModelChange: (name: string) => void;
  transcriptionEngine?: string;
  initialTab?: "models" | "smart-dictation";
  platform?: string;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AiModelsView({ activeModel, onModelChange, activeMoonshineModel, onMoonshineModelChange, transcriptionEngine = "whisper", initialTab, platform = "macos" }: AiModelsViewProps) {
  const [activeTab, setActiveTab] = useState<"models" | "smart-dictation">(initialTab ?? "models");

  return (
    <div className="w-full max-w-2xl mx-auto px-8 py-6">
      {/* Pill tabs */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-xl"
        style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
      >
        {(["models", "smart-dictation"] as const).map((tab) => (
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
            {tab === "models" ? "Models" : "Smart Dictation"}
          </button>
        ))}
      </div>

      {activeTab === "models" && (
        <ModelsTab
          activeModel={activeModel}
          onModelChange={onModelChange}
          activeMoonshineModel={activeMoonshineModel}
          onMoonshineModelChange={onMoonshineModelChange}
          transcriptionEngine={transcriptionEngine}
          platform={platform}
        />
      )}
      {activeTab === "smart-dictation" && <SmartDictationTab />}
    </div>
  );
}
