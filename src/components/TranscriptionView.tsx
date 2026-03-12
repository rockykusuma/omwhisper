import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Mic, MicOff, FileAudio, Sparkles } from "lucide-react";
import StatsCard from "./StatsCard";

interface Segment {
  text: string;
  start_ms: number;
  end_ms: number;
  is_final: boolean;
}

interface Props {
  externalIsRecording?: boolean;
  onRecordingChange?: (recording: boolean) => void;
  activeModel?: string;
  isSmartDictation?: boolean;
}

function WaveformMeter({ level }: { level: number }) {
  const bars = 28;
  const filled = Math.round(level * bars * 7);
  return (
    <div className="flex items-center gap-[2px] h-5" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        const active = i < filled;
        const height = active
          ? Math.max(30, Math.sin((i / bars) * Math.PI) * 100)
          : 20;
        return (
          <div
            key={i}
            className={`w-[3px] rounded-full transition-all duration-75 ${
              active ? "bg-emerald-400" : "bg-white/[0.08]"
            }`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function TranscriptionView({
  externalIsRecording,
  onRecordingChange,
  activeModel = "tiny.en",
  isSmartDictation = false,
}: Props) {
  const modelPath = `models/ggml-${activeModel}.bin`;
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishedLabel, setPolishedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [toast, setToast] = useState<string | null>(null);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [showFileMode, setShowFileMode] = useState(false);
  const [statsRefresh, setStatsRefresh] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recordingStartRef = useRef<number>(0);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    if (externalIsRecording !== undefined) setIsRecording(externalIsRecording);
  }, [externalIsRecording]);

  useEffect(() => {
    const unlisten = listen<{ segments: Segment[] }>("transcription-update", (event) => {
      setSegments((prev) => [...prev, ...event.payload.segments]);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    const unlisten = listen<number>("audio-level", (event) => {
      setAudioLevel(event.payload);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    const unlisten = listen("usage-limit-reached", async () => {
      try { await invoke("stop_transcription"); } catch {}
      setIsRecording(false);
      onRecordingChange?.(false);
      setTimeout(() => invoke("hide_overlay").catch(() => {}), 500);
      setShowUpgradePrompt(true);
    });
    return () => { unlisten.then((f) => f()); };
  }, [onRecordingChange]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments]);

  async function handleSelectFile() {
    const selected = await open({
      filters: [{ name: "Audio", extensions: ["wav"] }],
      multiple: false,
    });
    if (!selected) return;

    const filePath =
      typeof selected === "string" ? selected : (selected as { path: string }).path;
    setFileName(filePath.split("/").pop() ?? filePath);
    setSegments([]);
    setError(null);
    setLoading(true);

    try {
      const result = await invoke<Segment[]>("transcribe_file", {
        path: filePath,
        modelPath,
      });
      setSegments(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleStartRecording() {
    setSegments([]);
    setError(null);
    try {
      await invoke("capture_focused_app");
      await invoke("start_transcription", { model: modelPath });
      recordingStartRef.current = Date.now();
      setIsRecording(true);
      onRecordingChange?.(true);
      try {
        const settings = await invoke<{ show_overlay: boolean }>("get_settings");
        if (settings.show_overlay) await invoke("show_overlay");
      } catch {}
    } catch (e) {
      const msg = String(e);
      if (msg.includes("free_tier_limit_reached")) {
        setShowUpgradePrompt(true);
      } else {
        setError(msg);
      }
    }
  }

  async function handleStopRecording() {
    try {
      await invoke("stop_transcription");
    } catch (e) {
      setError(String(e));
    } finally {
      setIsRecording(false);
      onRecordingChange?.(false);
      setTimeout(() => invoke("hide_overlay").catch(() => {}), 1500);
    }

    setSegments((currentSegments) => {
      const rawText = currentSegments.map((s) => s.text).join(" ").trim();
      if (!rawText) return currentSegments;

      const durationSeconds = (Date.now() - recordingStartRef.current) / 1000;

      if (isSmartDictation) {
        // Smart Dictation flow: polish then paste
        (async () => {
          setIsPolishing(true);
          try {
            const settings = await invoke<{ active_polish_style: string; translate_target_language: string }>("get_settings");
            const style = settings.active_polish_style ?? "professional";
            const polished = await invoke<string>("polish_text_cmd", { text: rawText, style });
            setPolishedLabel(style);
            await invoke("paste_transcription", { text: polished });
            showToast("✓ AI-polished & copied");
            invoke("save_transcription", {
              text: polished,
              durationSeconds,
              modelUsed: activeModel,
              source: "smart_dictation",
              rawText,
              polishStyle: style,
            })
              .then(() => setStatsRefresh((n) => n + 1))
              .catch((e) => console.error("save_transcription failed:", e));
          } catch (e) {
            // Fallback: paste raw text if AI fails
            showToast("⚠ AI polish failed — pasting raw text");
            invoke("paste_transcription", { text: rawText }).catch(() => {});
            invoke("save_transcription", { text: rawText, durationSeconds, modelUsed: activeModel }).catch(() => {});
            console.error("Smart dictation polish failed:", e);
          } finally {
            setIsPolishing(false);
          }
        })();
      } else {
        // Regular recording flow
        setPolishedLabel(null);
        invoke<void>("paste_transcription", { text: rawText })
          .then(() => showToast("✓ Copied to clipboard"))
          .catch((e) => console.error("paste_transcription failed:", e));
        invoke("save_transcription", {
          text: rawText,
          durationSeconds,
          modelUsed: activeModel,
        })
          .then(() => setStatsRefresh((n) => n + 1))
          .catch((e) => console.error("save_transcription failed:", e));
      }

      return currentSegments;
    });
  }

  const hasContent = segments.length > 0 || loading;

  return (
    <div className="flex flex-col h-full px-8 py-6">
      {/* Active model badge */}
      <div className="flex items-center justify-between mb-6">
        <span className="text-white/20 text-xs font-mono">{activeModel} model</span>
        <button
          onClick={() => setShowFileMode((v) => !v)}
          className="flex items-center gap-1.5 text-white/25 hover:text-white/50 text-xs transition-colors cursor-pointer"
          aria-label="Toggle file transcription mode"
        >
          <FileAudio size={13} />
          <span>Transcribe file</span>
        </button>
      </div>

      {/* File mode */}
      {showFileMode && (
        <div className="mb-5 p-4 card">
          <div className="flex items-center gap-3">
            <button
              onClick={handleSelectFile}
              disabled={loading}
              className="btn-primary text-xs py-1.5"
              aria-label="Select audio file to transcribe"
            >
              {loading ? "Transcribing…" : "Select .wav file"}
            </button>
            {fileName && (
              <span className="text-white/30 text-xs font-mono truncate">{fileName}</span>
            )}
          </div>
        </div>
      )}

      {/* Central record area */}
      <div className="flex flex-col items-center gap-5 py-6">
        {/* Circular record button */}
        <div className="relative">
          <button
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f0d] ${
              isRecording
                ? isSmartDictation
                  ? "bg-violet-500 shadow-[0_0_32px_rgba(139,92,246,0.45)]"
                  : "bg-red-500 shadow-[0_0_32px_rgba(239,68,68,0.45)]"
                : "bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_0_28px_rgba(52,211,153,0.3)] hover:shadow-[0_0_40px_rgba(52,211,153,0.5)] hover:scale-105"
            }`}
          >
            {isRecording && (
              <span className={`absolute inset-0 rounded-full animate-ping opacity-20 ${isSmartDictation ? "bg-violet-400" : "bg-red-400"}`} />
            )}
            {isRecording
              ? <MicOff size={28} color="white" strokeWidth={2} />
              : <Mic size={28} color="black" strokeWidth={2} />
            }
          </button>
          {/* Smart Dictation badge */}
          {isSmartDictation && isRecording && (
            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center shadow-lg" title="Smart Dictation active">
              <Sparkles size={12} color="white" />
            </div>
          )}
        </div>

        {/* Status / level meter */}
        <div className="flex flex-col items-center gap-2 h-10 justify-center">
          {isPolishing ? (
            <p className="text-violet-400/80 text-[11px] font-mono animate-pulse">✦ Polishing with AI…</p>
          ) : isRecording ? (
            <>
              <WaveformMeter level={audioLevel} />
              <p className={`text-[11px] font-mono ${isSmartDictation ? "text-violet-400/60" : "text-emerald-400/60"}`}>
                {isSmartDictation ? "Smart Dictation…" : "Listening…"}
              </p>
            </>
          ) : (
            !hasContent && (
              <p className="text-white/20 text-[11px] font-mono">
                Press <kbd className="font-sans text-white/30">⌘⇧V</kbd> or tap the button
              </p>
            )
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-red-400 text-sm mb-4" role="alert">
          {error.includes("no input device") || error.includes("permission")
            ? "Microphone access denied. Grant permission in System Settings → Privacy → Microphone."
            : error}
        </div>
      )}

      {/* Transcription output */}
      {hasContent && (
        <div className="card overflow-hidden flex-1 min-h-0">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.04]">
            <div className={`w-2 h-2 rounded-full ${isRecording ? (isSmartDictation ? "bg-violet-400 animate-pulse" : "bg-red-400 animate-pulse") : "bg-emerald-400"}`} />
            <span className="text-white/30 text-xs font-mono">
              {loading
                ? "Running Whisper inference…"
                : `${segments.length} segment${segments.length !== 1 ? "s" : ""}`}
            </span>
            {polishedLabel && (
              <span className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 text-[10px] font-mono">
                <Sparkles size={9} />
                {polishedLabel}
              </span>
            )}
            {segments.length > 0 && !isRecording && (
              <button
                onClick={() => setSegments([])}
                className="ml-auto text-white/20 hover:text-white/50 text-[10px] font-sans cursor-pointer"
                aria-label="Clear transcription"
              >
                Clear
              </button>
            )}
          </div>
          <div ref={scrollRef} className="p-5 space-y-3 overflow-y-auto max-h-80">
            {segments.map((seg, i) => (
              <div key={i} className="flex gap-4">
                <span className="text-emerald-500/40 text-xs shrink-0 mt-0.5 font-mono">
                  {formatTime(seg.start_ms)}
                </span>
                <p className="text-white/80 text-sm leading-relaxed">{seg.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasContent && !error && !isRecording && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 pb-8">
          <div className="flex flex-col items-center gap-3 opacity-40 select-none">
            <span className="text-6xl text-white/10">ॐ</span>
            <p className="text-white/25 text-sm">Your transcription will appear here</p>
          </div>
          <StatsCard refreshTrigger={statsRefresh} />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono pointer-events-none z-50">
          {toast}
        </div>
      )}

      {/* Upgrade modal */}
      {showUpgradePrompt && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/60" role="dialog" aria-modal="true" aria-label="Upgrade to Pro">
          <div className="bg-[#0a1210] border border-white/10 rounded-2xl p-7 max-w-sm w-full mx-4 shadow-2xl text-center">
            <div className="text-3xl mb-3 select-none">ॐ</div>
            <h3 className="text-white/90 font-bold text-lg mb-2">
              You've used your 30 free minutes today
            </h3>
            <p className="text-white/40 text-sm mb-5 leading-relaxed">
              Upgrade for unlimited transcription — just $12, one time.
              Your usage resets at midnight.
            </p>
            <LicenseActivation onActivated={() => {
              setShowUpgradePrompt(false);
            }} />
            <button
              onClick={() => setShowUpgradePrompt(false)}
              className="mt-3 w-full py-2 text-white/30 hover:text-white/60 text-sm transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── License activation widget ─────────────────────────────────────────────────
function LicenseActivation({ onActivated }: { onActivated: () => void }) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleActivate() {
    if (!key.trim()) return;
    setStatus("checking");
    setErrorMsg("");
    try {
      await invoke("activate_license", { key: key.trim() });
      setStatus("success");
      setTimeout(onActivated, 1200);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("max_activations_reached")) {
        setErrorMsg("This key is already activated on another device. Deactivate it there first.");
      } else if (msg.includes("network_error")) {
        setErrorMsg("Network error. Check your connection and try again.");
      } else {
        setErrorMsg("Invalid license key. Please check and try again.");
      }
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="py-2 text-emerald-400 font-semibold text-sm">
        ✓ License activated! OmWhisper is fully unlocked.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={key}
        onChange={(e) => { setKey(e.target.value); setStatus("idle"); setErrorMsg(""); }}
        placeholder="Enter license key…"
        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-emerald-500/40 font-mono"
        aria-label="License key"
      />
      {errorMsg && <p className="text-red-400/70 text-xs">{errorMsg}</p>}
      <button
        onClick={handleActivate}
        disabled={status === "checking" || !key.trim()}
        className="btn-primary w-full py-2.5"
      >
        {status === "checking" ? "Activating…" : "Activate License"}
      </button>
      <p className="text-white/25 text-xs text-center">
        Don't have a key?{" "}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); invoke("plugin:opener|open_url", { url: "https://omwhisper.lemonsqueezy.com" }).catch(() => {}); }}
          className="text-emerald-500/60 hover:text-emerald-400 underline"
        >
          Buy for $12
        </a>
      </p>
    </div>
  );
}
