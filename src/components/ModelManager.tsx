import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ModelInfo {
  name: string;
  description: string;
  size_bytes: number;
  size_label: string;
  sha256: string;
  is_downloaded: boolean;
  is_english_only: boolean;
}

interface DownloadProgress {
  name: string;
  progress: number;
  done: boolean;
  error: string | null;
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
  const [downloading, setDownloading] = useState<Record<string, number>>({}); // name → progress 0-1
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [diskUsage, setDiskUsage] = useState(0);
  const [isLicensed, setIsLicensed] = useState(false);

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

    const unlisten = listen<DownloadProgress>("download-progress", (event) => {
      const { name, progress, done, error } = event.payload;
      if (done) {
        setDownloading((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
        if (error) {
          setErrors((prev) => ({ ...prev, [name]: error }));
        } else {
          loadModels();
        }
      } else {
        setDownloading((prev) => ({ ...prev, [name]: progress }));
        setErrors((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
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

  return (
    <div className="w-full max-w-2xl mx-auto px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white/90">Models</h2>
        <p className="text-white/50 text-xs mt-1 font-mono">{formatBytes(diskUsage)} used on disk</p>
      </div>

      {/* Model list */}
      <div className="space-y-3">
        {models.map((model) => {
          const isActive = activeModel === model.name;
          const isDownloading = model.name in downloading;
          const progress = downloading[model.name] ?? 0;
          const error = errors[model.name];
          const isLocked = !isLicensed && model.name !== "tiny.en";

          return (
            <div
              key={model.name}
              className={`rounded-2xl border p-5 transition-all duration-300 ${
                isLocked
                  ? "border-white/[0.04] bg-white/[0.01] opacity-60"
                  : isActive
                  ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-white font-semibold"
                      style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                      {model.name}
                    </span>
                    {model.is_english_only && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/50" style={{ fontFamily: "'DM Mono', monospace" }}>
                        EN
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400" style={{ fontFamily: "'DM Mono', monospace" }}>
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-white/40 text-sm leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                    {model.description}
                  </p>
                  <p className="text-white/35 text-xs mt-1" style={{ fontFamily: "'DM Mono', monospace" }}>
                    {model.size_label}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {isLocked ? (
                    <span
                      className="text-[10px] px-2 py-1 rounded-lg bg-white/[0.04] text-white/40"
                      style={{ fontFamily: "'DM Mono', monospace" }}
                    >
                      🔒 Upgrade to unlock
                    </span>
                  ) : model.is_downloaded ? (
                    <>
                      {!isActive && (
                        <button
                          onClick={() => onModelChange(model.name)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400 transition-colors cursor-pointer"
                          style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                          Set Active
                        </button>
                      )}
                      {!isActive && (
                        <button
                          onClick={() => handleDelete(model.name)}
                          className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-white/50 text-xs hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer"
                          style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  ) : isDownloading ? (
                    <div className="text-right">
                      <p className="text-emerald-400/60 text-xs mb-1" style={{ fontFamily: "'DM Mono', monospace" }}>
                        {Math.round(progress * 100)}%
                      </p>
                      <div className="w-24 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                          style={{ width: `${progress * 100}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDownload(model.name)}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/60 text-xs hover:bg-emerald-500/20 hover:text-emerald-400 transition-colors cursor-pointer"
                      style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>

              {/* Error */}
              {error && (
                <p className="text-red-400 text-xs mt-3" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                  ✗ {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
