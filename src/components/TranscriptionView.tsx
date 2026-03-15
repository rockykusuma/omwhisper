import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Mic, MicOff, FileAudio, Sparkles } from "lucide-react";
import StatsCard from "./StatsCard";
import LicenseActivation from "./LicenseActivation";
import { useToast } from "../hooks/useToast";
import { logger } from "../utils/logger";
import type { TranscriptionSegment } from "../types";

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
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishedLabel, setPolishedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const { toast, showToast } = useToast();
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [showFileMode, setShowFileMode] = useState(false);
  const [statsRefresh, setStatsRefresh] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recordingStartRef = useRef<number>(0);
  const isPendingPaste = useRef(false);
  const pendingIsSmartDictation = useRef(false);
  const hasPasted = useRef(false);

  useEffect(() => {
    if (externalIsRecording !== undefined) {
      setIsRecording(externalIsRecording);
      if (externalIsRecording) {
        recordingStartRef.current = Date.now();
        setSegments([]); // Clear previous recording when a new one starts
        setPolishedLabel(null);
        setError(null);
        hasPasted.current = false;
      }
    }
  }, [externalIsRecording]);

  useEffect(() => {
    const unlisten = listen<{ segments: TranscriptionSegment[] }>("transcription-update", (event) => {
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
    const unlisten = listen("hotkey-stop-recording", () => {
      handleStopRecording();
    });
    return () => { unlisten.then((f) => f()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unlisten = listen("transcription-complete", () => {
      if (!isPendingPaste.current) return;
      isPendingPaste.current = false;
      const smartDictation = pendingIsSmartDictation.current;

      setSegments((currentSegments) => {
        if (hasPasted.current) return currentSegments;
        hasPasted.current = true;

        const rawText = currentSegments.map((s) => s.text).join(" ").trim();
        if (!rawText) return currentSegments;

        const durationSeconds = (Date.now() - recordingStartRef.current) / 1000;

        if (smartDictation) {
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
                .catch((e) => logger.error("save_transcription failed:", e));
            } catch (e) {
              showToast("⚠ AI polish failed — pasting raw text");
              invoke("paste_transcription", { text: rawText }).catch((e) => logger.debug("paste_transcription:", e));
              invoke("save_transcription", { text: rawText, durationSeconds, modelUsed: activeModel }).catch((e) => logger.debug("save_transcription:", e));
              logger.error("Smart dictation polish failed:", e);
            } finally {
              setIsPolishing(false);
            }
          })();
        } else {
          setPolishedLabel(null);
          invoke<void>("paste_transcription", { text: rawText })
            .then(() => showToast("✓ Copied to clipboard"))
            .catch((e) => logger.error("paste_transcription failed:", e));
          invoke("save_transcription", { text: rawText, durationSeconds, modelUsed: activeModel })
            .then(() => setStatsRefresh((n) => n + 1))
            .catch((e) => logger.error("save_transcription failed:", e));
        }

        return currentSegments;
      });
    });
    return () => { unlisten.then((f) => f()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unlisten = listen("usage-limit-reached", async () => {
      try { await invoke("stop_transcription"); } catch {}
      setIsRecording(false);
      onRecordingChange?.(false);
      setTimeout(() => invoke("hide_overlay").catch((e) => logger.debug("hide_overlay:", e)), 500);
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
      const result = await invoke<TranscriptionSegment[]>("transcribe_file", {
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
      } catch (e) {
        logger.debug("show_overlay:", e);
      }
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
    // Mark that we want to paste when transcription-complete fires
    pendingIsSmartDictation.current = isSmartDictation;
    isPendingPaste.current = true;

    try {
      await invoke("stop_transcription");
    } catch (e) {
      setError(String(e));
      isPendingPaste.current = false; // don't paste if stop failed
    } finally {
      setIsRecording(false);
      onRecordingChange?.(false);
      setTimeout(() => invoke("hide_overlay").catch((e) => logger.debug("hide_overlay:", e)), 1500);
    }
  }

  const hasContent = segments.length > 0 || loading;

  return (
    <div className="flex flex-col h-full px-8 py-6">
      {/* Active model badge */}
      <div className="flex items-center justify-between mb-6">
        <span
          className="text-[11px] font-mono px-2.5 py-1 rounded-lg"
          style={{ color: "rgba(255,255,255,0.40)", boxShadow: "var(--nm-pressed-sm)", background: "var(--bg)" }}
        >
          {activeModel}
        </span>
        <button
          onClick={() => setShowFileMode((v) => !v)}
          className="flex items-center gap-1.5 text-xs transition-all duration-150 cursor-pointer px-2.5 py-1 rounded-lg"
          style={{
            color: showFileMode ? "rgb(52,211,153)" : "rgba(255,255,255,0.40)",
            boxShadow: showFileMode ? "var(--nm-pressed-sm)" : "var(--nm-raised-sm)",
            background: "var(--bg)",
          }}
          aria-label="Toggle file transcription mode"
        >
          <FileAudio size={13} />
          <span>File</span>
        </button>
      </div>

      {/* File mode */}
      {showFileMode && (
        <div className="mb-5 p-4 rounded-2xl" style={{ boxShadow: "var(--nm-pressed-sm)", background: "var(--bg)" }}>
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
              <span className="text-white/50 text-xs font-mono truncate">{fileName}</span>
            )}
          </div>
        </div>
      )}

      {/* Central record area */}
      <div className="flex flex-col items-center gap-5 py-6">
        {/* Circular record button — neumorphic: raised idle, pressed when active */}
        <div className="relative">
          <button
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            className="relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer focus-visible:outline-none"
            style={
              isRecording
                ? isSmartDictation
                  ? {
                      background: "var(--bg)",
                      boxShadow: "var(--nm-pressed), 0 0 20px rgba(139,92,246,0.25)",
                    }
                  : {
                      background: "var(--bg)",
                      boxShadow: "var(--nm-pressed), 0 0 20px rgba(239,68,68,0.20)",
                    }
                : {
                    background: "linear-gradient(145deg, #3de0a8, #1d9e6e)",
                    boxShadow: "var(--nm-raised), 0 0 28px rgba(52,211,153,0.25)",
                  }
            }
          >
            {isRecording && (
              <span
                className={`absolute inset-0 rounded-full animate-ping opacity-15 ${isSmartDictation ? "bg-violet-400" : "bg-red-400"}`}
              />
            )}
            {isRecording ? (
              isSmartDictation ? (
                <Sparkles size={26} style={{ color: "rgba(167,139,250,0.85)" }} strokeWidth={1.75} />
              ) : (
                <MicOff size={26} style={{ color: "rgba(248,113,113,0.85)" }} strokeWidth={1.75} />
              )
            ) : (
              <Mic size={26} color="#0a1a12" strokeWidth={2} />
            )}
          </button>
          {/* Smart Dictation badge */}
          {isSmartDictation && isRecording && (
            <div
              className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm), 0 0 8px rgba(139,92,246,0.4)" }}
              title="Smart Dictation active"
            >
              <Sparkles size={11} style={{ color: "rgb(167,139,250)" }} />
            </div>
          )}
        </div>

        {/* Status / level meter */}
        <div className="flex flex-col items-center gap-2 h-10 justify-center">
          {isPolishing ? (
            <p className="text-violet-400/70 text-[11px] font-mono animate-pulse">✦ Polishing with AI…</p>
          ) : isRecording ? (
            <>
              <WaveformMeter level={audioLevel} />
              <p className={`text-[11px] font-mono ${isSmartDictation ? "text-violet-400/55" : "text-emerald-400/55"}`}>
                {isSmartDictation ? "Smart Dictation…" : "Listening…"}
              </p>
            </>
          ) : (
            !hasContent && (
              <p className="text-white/30 text-[11px] font-mono">
                Press <kbd className="font-sans text-white/45">⌘⇧V</kbd> or tap the button
              </p>
            )
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-xl p-4 text-red-400/80 text-sm mb-4"
          style={{ boxShadow: "var(--nm-pressed-sm)", background: "var(--bg)" }}
          role="alert"
        >
          {error.includes("no input device") || error.includes("permission")
            ? "Microphone access denied. Grant permission in System Settings → Privacy → Microphone."
            : error}
        </div>
      )}

      {/* Transcription output */}
      {hasContent && (
        <div className="card-inset overflow-hidden flex-1 min-h-0">
          <div
            className="flex items-center gap-2 px-5 py-3"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
          >
            <div
              className={`w-2 h-2 rounded-full ${isRecording ? (isSmartDictation ? "bg-violet-400 animate-pulse" : "bg-red-400 animate-pulse") : "bg-emerald-400"}`}
              style={isRecording ? undefined : { boxShadow: "0 0 5px rgba(52,211,153,0.6)" }}
            />
            <span className="text-white/45 text-xs font-mono">
              {loading
                ? "Running Whisper…"
                : `${segments.length} segment${segments.length !== 1 ? "s" : ""}`}
            </span>
            {polishedLabel && (
              <span
                className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full text-violet-400 text-[10px] font-mono"
                style={{ background: "rgba(139,92,246,0.12)", boxShadow: "var(--nm-pressed-sm)" }}
              >
                <Sparkles size={9} />
                {polishedLabel}
              </span>
            )}
            {segments.length > 0 && !isRecording && (
              <button
                onClick={() => setSegments([])}
                className="ml-auto text-[10px] font-sans cursor-pointer transition-colors duration-150"
                style={{ color: "rgba(255,255,255,0.30)" }}
                aria-label="Clear transcription"
              >
                Clear
              </button>
            )}
          </div>
          <div ref={scrollRef} className="p-5 space-y-3 overflow-y-auto max-h-80">
            {segments.map((seg) => (
              <div key={`${seg.start_ms}-${seg.end_ms}`} className="flex gap-4">
                <span className="text-emerald-500/35 text-xs shrink-0 mt-0.5 font-mono">
                  {formatTime(seg.start_ms)}
                </span>
                <p className="text-white/75 text-sm leading-relaxed">{seg.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasContent && !error && !isRecording && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 pb-8">
          <div className="flex flex-col items-center gap-3 select-none">
            <span
              className="text-5xl"
              style={{
                color: "rgba(255,255,255,0.06)",
                filter: "drop-shadow(0 0 12px rgba(52,211,153,0.08))",
              }}
            >
              ॐ
            </span>
            <p className="text-white/25 text-sm">Your transcription will appear here</p>
          </div>
          <StatsCard refreshTrigger={statsRefresh} />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-emerald-400 text-xs font-mono pointer-events-none z-50"
          style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm), 0 0 16px rgba(52,211,153,0.15)" }}
        >
          {toast}
        </div>
      )}

      {/* Upgrade modal */}
      {showUpgradePrompt && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50" role="dialog" aria-modal="true" aria-label="Upgrade to Pro">
          <div
            className="rounded-2xl p-7 max-w-sm w-full mx-4 text-center"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-raised), 0 0 60px rgba(0,0,0,0.5)" }}
          >
            <div
              className="text-3xl mb-3 select-none"
              style={{ filter: "drop-shadow(0 0 10px rgba(52,211,153,0.4))" }}
            >
              ॐ
            </div>
            <h3 className="text-white/90 font-bold text-lg mb-2">
              You've used your 30 free minutes today
            </h3>
            <p className="text-white/40 text-sm mb-5 leading-relaxed">
              Upgrade for unlimited transcription — just $12, one time.
              Your usage resets at midnight.
            </p>
            <LicenseActivation onActivated={() => setShowUpgradePrompt(false)} />
            <button
              onClick={() => setShowUpgradePrompt(false)}
              className="mt-3 w-full py-2 text-white/40 hover:text-white/55 text-sm transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

