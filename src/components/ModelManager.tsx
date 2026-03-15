import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Cpu, MemoryStick, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

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

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

interface Props {
  activeModel: string;
  onModelChange: (name: string) => void;
}

export default function ModelManager({ activeModel, onModelChange }: Props) {
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
    <div className="w-full max-w-2xl mx-auto px-8 py-6">
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-xl font-bold" style={{ color: "var(--t1)" }}>Models</h2>
        <p className="text-xs mt-1 font-mono" style={{ color: "var(--t3)" }}>{formatBytes(diskUsage)} used on disk</p>
      </div>

      {/* Recommendation Card — subtle tinted glass, no harsh left border */}
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
              <span className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
                Recommended for your Mac
              </span>
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
            {recommendation.reason}
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
              {models.find(m => m.name === recModel)?.is_downloaded
                ? `Switch to ${recModel}`
                : `Download & use ${recModel}`}
            </button>
          )}

          {/* Expanded spec */}
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
                <span className="text-xs" style={{ color: "var(--t3)" }}>
                  {recommendation.spec.total_ram_gb.toFixed(1)} GB RAM
                </span>
              </div>
              <div className="col-span-2 mt-0.5">
                <span className="text-[11px] font-mono" style={{ color: "var(--t4)" }}>
                  {recommendation.spec.cpu_brand}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Model list — grouped by category */}
      {["English Only", "Multilingual", "Turbo"].map((cat) => {
        const group = models.filter((m) => m.category === cat);
        if (group.length === 0) return null;
        return (
          <div key={cat} className="mb-5">
            <p className="text-[10px] font-mono uppercase tracking-widest mb-2 px-1" style={{ color: "var(--t4)" }}>
              {cat}
            </p>
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
                background: isActive
                  ? "color-mix(in srgb, var(--accent) 5%, var(--bg))"
                  : "var(--bg)",
                boxShadow: isActive
                  ? "var(--nm-pressed-sm), 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent)"
                  : "var(--nm-raised-sm)",
              }}
            >
              <div className="flex items-center justify-between gap-4">
                {/* Left: name + badges + description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {/* Active dot indicator */}
                    {isActive && (
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: "var(--accent)", boxShadow: "0 0 5px var(--accent-glow)" }}
                      />
                    )}
                    <span className="font-semibold text-sm" style={{ color: "var(--t1)" }}>
                      {model.name}
                    </span>

                    {/* EN pill */}
                    {model.is_english_only && (
                      <span
                        className="text-[10px] px-1.5 py-px rounded font-mono"
                        style={{ color: "var(--t4)", background: "color-mix(in srgb, var(--t1) 6%, transparent)" }}
                      >
                        EN
                      </span>
                    )}

                    {/* ACTIVE badge — outlined */}
                    {isActive && (
                      <span
                        className="text-[10px] px-1.5 py-px rounded font-mono"
                        style={{
                          color: "var(--accent)",
                          border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
                          background: "transparent",
                        }}
                      >
                        Active
                      </span>
                    )}

                    {/* RECOMMENDED badge — outlined with sparkle */}
                    {isRecommended && (
                      <span
                        className="text-[10px] px-1.5 py-px rounded font-mono flex items-center gap-0.5"
                        style={{
                          color: "var(--accent)",
                          border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
                          background: "color-mix(in srgb, var(--accent) 7%, transparent)",
                        }}
                      >
                        <Sparkles size={8} />
                        Recommended
                      </span>
                    )}
                  </div>

                  <p className="text-xs leading-relaxed" style={{ color: "var(--t2)" }}>
                    {model.description}
                  </p>
                  <p className="text-[11px] mt-1 font-mono" style={{ color: "var(--t4)" }}>
                    {model.size_label}
                  </p>
                </div>

                {/* Right: actions */}
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {model.is_downloaded ? (
                    <>
                      {!isActive && (
                        <button onClick={() => onModelChange(model.name)} className="btn-primary text-xs px-3 py-1.5">
                          Set Active
                        </button>
                      )}
                      {!isActive && (
                        <button
                          onClick={() => handleDelete(model.name)}
                          className="btn-ghost text-xs px-3 py-1.5"
                          style={{ fontSize: 11 }}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  ) : isDownloading ? (
                    <div className="text-right min-w-[64px]">
                      <p className="text-[11px] font-mono mb-1" style={{ color: "var(--accent)" }}>
                        {Math.round(progress * 100)}%
                      </p>
                      <div
                        className="h-1 rounded-full overflow-hidden"
                        style={{ width: 64, background: "color-mix(in srgb, var(--t1) 8%, transparent)" }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-200"
                          style={{ width: `${progress * 100}%`, background: "var(--accent)" }}
                        />
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
                        border: isRecommended
                          ? "1px solid color-mix(in srgb, var(--accent) 25%, transparent)"
                          : "1px solid transparent",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)";
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "color-mix(in srgb, var(--accent) 40%, transparent)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.color = "var(--t2)";
                        (e.currentTarget as HTMLButtonElement).style.borderColor = isRecommended
                          ? "color-mix(in srgb, var(--accent) 25%, transparent)"
                          : "transparent";
                      }}
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-xs mt-2">✗ {error}</p>
              )}
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
