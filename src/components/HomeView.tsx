import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Mic, MicOff, Sparkles } from "lucide-react";
import type { TranscriptionSegment, AppSettings } from "../types";
import TipsSection from "./TipsSection";

// ── Helpers ─────────────────────────────────────────────────────────────────

function WaveformMeter({ level }: { level: number }) {
  const bars = 28;
  const filled = Math.round(level * bars * 7);
  return (
    <div className="flex items-center gap-[2px] h-5" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        const active = i < filled;
        return (
          <div
            key={i}
            className={`w-[3px] rounded-full transition-all duration-75 ${active ? "bg-emerald-400" : "bg-white/[0.08]"}`}
            style={{ height: `${active ? Math.max(30, Math.sin((i / bars) * Math.PI) * 100) : 20}%` }}
          />
        );
      })}
    </div>
  );
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  return `${m}:${String(secs % 60).padStart(2, "0")}`;
}

function formatSegTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface HomeViewProps {
  isRecording: boolean;
  isSmartDictation: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  activeModel: string;
  onNavigate: (view: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function HomeView({
  isRecording,
  isSmartDictation,
  onStartRecording,
  onStopRecording,
  activeModel,
  onNavigate,
}: HomeViewProps) {
  // ── Recording state ──
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [transcriptionComplete, setTranscriptionComplete] = useState(false);
  const [showLiveTranscript, setShowLiveTranscript] = useState(false);
  const recordingStartRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Home state ──
  const [micName, setMicName] = useState("Default Microphone");
  const [applyPolishToRegular, setApplyPolishToRegular] = useState(false);
  const [modelNudgeDismissed, setModelNudgeDismissed] = useState(
    () => localStorage.getItem("omw_model_nudge_dismissed") === "1"
  );

  // ── Engine badge ──
  const [engineName, setEngineName] = useState<string>("whisper");

  useEffect(() => {
    invoke<string>("get_transcription_engine").then(setEngineName).catch(() => {});

    const unlisten = listen("transcription-complete", () => {
      invoke<string>("get_transcription_engine").then(setEngineName).catch(() => {});
    });

    return () => { unlisten.then((f) => f()); };
  }, []);

  // ── Smart Dictation nudge ──
  const [smartDictationNudge, setSmartDictationNudge] = useState<"not_configured" | "model_not_downloaded" | null>(null);
  const [sdNudgeDismissed, setSdNudgeDismissed] = useState(
    () => localStorage.getItem("omw_sd_nudge_dismissed") === "1"
  );

  // ── Data loaders ──
  const loadSettings = useCallback(async () => {
    const s = await invoke<{ audio_input_device: string | null; apply_polish_to_regular: boolean; ai_backend: string }>("get_settings").catch(() => null);
    setMicName(s?.audio_input_device || "Default Microphone");
    setApplyPolishToRegular(s?.apply_polish_to_regular ?? false);

    // Check smart dictation readiness
    if (!s || s.ai_backend === "disabled") {
      setSmartDictationNudge("not_configured");
      setSdNudgeDismissed(false);
      localStorage.removeItem("omw_sd_nudge_dismissed");
    } else if (s.ai_backend === "built_in") {
      try {
        const models = await invoke<{ is_downloaded: boolean; is_active: boolean }[]>("get_llm_models");
        const ready = models.some((m) => m.is_active && m.is_downloaded);
        if (ready) {
          setSmartDictationNudge(null);
        } else {
          setSmartDictationNudge("model_not_downloaded");
          setSdNudgeDismissed(false);
          localStorage.removeItem("omw_sd_nudge_dismissed");
        }
      } catch {
        setSmartDictationNudge("model_not_downloaded");
      }
    } else {
      // ollama or cloud — assume configured
      setSmartDictationNudge(null);
    }
  }, []);

  const handleToggleCleanup = useCallback(async () => {
    try {
      const s = await invoke<AppSettings>("get_settings");
      const next = !applyPolishToRegular;
      setApplyPolishToRegular(next); // optimistic update
      await invoke("update_settings", { newSettings: { ...s, apply_polish_to_regular: next } });
    } catch (e) {
      setApplyPolishToRegular(applyPolishToRegular); // revert on failure
    }
  }, [applyPolishToRegular]);

  // Initial load
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Settings changes
  useEffect(() => {
    const unlisten = listen("settings-changed", () => loadSettings());
    return () => { unlisten.then((f) => f()); };
  }, [loadSettings]);


  // ── Recording lifecycle ──

  // On start: clear segments, show transcript panel; hide on stop
  useEffect(() => {
    if (isRecording) {
      recordingStartRef.current = Date.now();
      setSegments([]);
      setTranscriptionComplete(false);
      setShowLiveTranscript(true);
    } else {
      setShowLiveTranscript(false);
    }
  }, [isRecording]);

  // Collect live segments
  useEffect(() => {
    const unlisten = listen<{ segments: TranscriptionSegment[] }>("transcription-update", (event) => {
      setSegments((prev) => [...prev, ...event.payload.segments]);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Audio level for waveform
  useEffect(() => {
    const unlisten = listen<number>("audio-level", (event) => setAudioLevel(event.payload));
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Duration timer
  useEffect(() => {
    if (!isRecording) { setRecordingDuration(0); return; }
    const t = setInterval(() => {
      setRecordingDuration(Math.floor((Date.now() - recordingStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [isRecording]);

  // Auto-scroll transcript
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [segments]);

  // transcription-complete: stop pulsing dot + update status text
  useEffect(() => {
    const unlisten = listen("transcription-complete", () => setTranscriptionComplete(true));
    return () => { unlisten.then((f) => f()); };
  }, []);

  // ── Derived ──
  const accentColor = isSmartDictation ? "violet" : "red";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full px-8 py-6 gap-4 overflow-y-auto">

      {/* ── Mic selector (top-right) ─────────────────────────────────────── */}
      <button
        onClick={() => onNavigate("settings:audio")}
        className="absolute top-2 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all duration-150 cursor-pointer"
        style={{ background: "var(--surface)", boxShadow: "var(--surface-shadow)", border: "1px solid var(--surface-border)", backdropFilter: "var(--surface-blur)", WebkitBackdropFilter: "var(--surface-blur)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--t1) 6%, var(--surface))")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}
        title="Change Microphone"
      >
        <Mic size={11} style={{ color: "var(--accent)", flexShrink: 0 }} strokeWidth={2} />
        <span className="text-[11px] truncate max-w-[140px]" style={{ color: "var(--t3)" }}>{micName}</span>
      </button>

      {/* ── Engine badge ─────────────────────────────────────────────── */}
      <div className="flex justify-center pt-1 pb-0">
        {engineName === "apple" ? (
          <span className="text-[10px] font-medium text-blue-400/70">⚡ Apple Speech</span>
        ) : (
          <span className="text-[10px] font-medium" style={{ color: "var(--t4)" }}>◎ Whisper</span>
        )}
      </div>

      {/* ── Record / Stop button ────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-3 py-5">
        <div className="relative">
          <button
            onClick={isRecording ? onStopRecording : onStartRecording}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            className="relative w-[72px] h-[72px] rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer focus-visible:outline-none"
            style={
              isRecording
                ? isSmartDictation
                  ? { background: "var(--bg)", boxShadow: "var(--nm-pressed), 0 0 20px rgba(139,92,246,0.25)" }
                  : { background: "var(--bg)", boxShadow: "var(--nm-pressed), 0 0 20px rgba(239,68,68,0.20)" }
                : {
                    background: "linear-gradient(145deg, var(--accent-grad-from), var(--accent-grad-to))",
                    boxShadow: "var(--nm-raised), 0 0 28px var(--accent-glow-weak)",
                  }
            }
          >
            {isRecording && (
              <span
                className={`absolute inset-0 rounded-full animate-ping opacity-15 ${
                  isSmartDictation ? "bg-violet-400" : "bg-red-400"
                }`}
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

          {isSmartDictation && isRecording && (
            <div
              className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm), 0 0 8px rgba(139,92,246,0.4)" }}
            >
              <Sparkles size={11} style={{ color: "rgb(167,139,250)" }} />
            </div>
          )}
        </div>

        {/* Status area */}
        <div className="flex flex-col items-center gap-1.5 min-h-[36px] justify-center">
          {isRecording ? (
            <>
              <WaveformMeter level={audioLevel} />
              <div className="flex items-center gap-3">
                <p
                  className={`text-[11px] font-mono ${
                    isSmartDictation ? "text-violet-400/55" : "text-emerald-400/55"
                  }`}
                >
                  {isSmartDictation ? "Smart Dictation…" : "Listening…"}
                </p>
                <p className="text-white/25 text-[11px] font-mono tabular-nums">
                  {formatElapsed(recordingDuration)}
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-start justify-center gap-6">
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-0.5 px-3 py-2 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--t1) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--t1) 12%, transparent)" }}>
                  {["⌘", "⇧", "V"].map((k) => (
                    <kbd key={k} className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-mono leading-none"
                      style={{ background: "color-mix(in srgb, var(--t1) 15%, transparent)", color: "var(--t2)", border: "1px solid color-mix(in srgb, var(--t1) 20%, transparent)" }}>
                      {k}
                    </kbd>
                  ))}
                </div>
                <span className="text-[10px] font-medium" style={{ color: "var(--t3)" }}>Dictate</span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-0.5 px-3 py-2 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--t1) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--t1) 12%, transparent)" }}>
                  {["⌘", "⇧", "B"].map((k) => (
                    <kbd key={k} className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-mono leading-none"
                      style={{ background: "color-mix(in srgb, var(--t1) 15%, transparent)", color: "var(--t2)", border: "1px solid color-mix(in srgb, var(--t1) 20%, transparent)" }}>
                      {k}
                    </kbd>
                  ))}
                </div>
                <span className="text-[10px] font-medium inline-flex items-center gap-1" style={{ color: "var(--t3)" }}>
                  <Sparkles size={10} />
                  AI Polish
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── AI Cleanup toggle row ─────────────────────────────────────────── */}
      <button
        onClick={isRecording ? undefined : handleToggleCleanup}
        className="group w-full flex items-center gap-3 px-4 py-3 rounded-2xl flex-shrink-0 transition-all duration-150"
        style={{
          background: applyPolishToRegular
            ? "color-mix(in srgb, var(--accent) 8%, var(--surface))"
            : "var(--surface)",
          boxShadow: "var(--surface-shadow)",
          border: "1px solid var(--surface-border)",
          backdropFilter: "var(--surface-blur)",
          WebkitBackdropFilter: "var(--surface-blur)",
          cursor: isRecording ? "default" : "pointer",
          pointerEvents: isRecording ? "none" : "auto",
        }}
        onMouseEnter={(e) => {
          if (!isRecording && !applyPolishToRegular)
            e.currentTarget.style.background = "color-mix(in srgb, var(--t1) 4%, var(--surface))";
        }}
        onMouseLeave={(e) => {
          if (!applyPolishToRegular) e.currentTarget.style.background = "var(--surface)";
        }}
        title="Toggle AI Cleanup"
        aria-label="Apply AI Polish to regular recording"
        aria-pressed={applyPolishToRegular}
      >
        <Sparkles size={13} style={{ color: applyPolishToRegular ? "var(--accent)" : "var(--t3)", flexShrink: 0, marginTop: 2 }} strokeWidth={2} />
        <div className="flex-1 text-left min-w-0">
          <p className="text-xs font-semibold" style={{ color: applyPolishToRegular ? "var(--t2)" : "var(--t3)" }}>
            Apply AI Polish to regular recording
          </p>
          <p className="text-[11px] mt-0.5 leading-snug" style={{ color: "var(--t4)" }}>
            ⌘⇧V recordings are polished before pasting. Falls back to raw paste if AI is unavailable.
          </p>
          <p className="text-[10px] mt-1 leading-snug" style={{ color: "var(--t4)", opacity: 0.7 }}>
            ⚠ Adds a brief pause before pasting while AI processes your text.
          </p>
        </div>
        {/* Toggle pill */}
        <div
          className="relative w-7 h-4 rounded-full flex-shrink-0 transition-colors duration-200"
          style={{ background: applyPolishToRegular ? "var(--accent)" : "color-mix(in srgb, var(--t1) 20%, transparent)" }}
        >
          <div
            className="absolute top-0.5 w-3 h-3 rounded-full transition-transform duration-200"
            style={{
              background: applyPolishToRegular ? "var(--bg)" : "var(--t3)",
              transform: applyPolishToRegular ? "translateX(14px)" : "translateX(2px)",
            }}
          />
        </div>
      </button>

      {/* ── Live transcript panel (visible during recording + persists until next start) ── */}
      {showLiveTranscript && (
        <div className="card-inset overflow-hidden flex-shrink-0">
          <div
            className="flex items-center gap-2 px-5 py-3"
            style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                !transcriptionComplete && isRecording
                  ? accentColor === "violet"
                    ? "bg-violet-400 animate-pulse"
                    : "bg-red-400 animate-pulse"
                  : "bg-emerald-400"
              }`}
              style={
                transcriptionComplete || !isRecording
                  ? { boxShadow: "0 0 5px var(--accent-glow)" }
                  : undefined
              }
            />
            <span className="text-xs font-mono" style={{ color: "var(--t4)" }}>
              {segments.length} segment{segments.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div ref={scrollRef} className="p-5 space-y-3 overflow-y-auto max-h-48 select-text">
            {segments.map((seg, idx) => (
              <div key={`${idx}-${seg.start_ms}-${seg.end_ms}`} className="flex gap-4">
                <span className="text-emerald-500/35 text-xs shrink-0 mt-0.5 font-mono">
                  {formatSegTime(seg.start_ms)}
                </span>
                <p className="text-sm leading-relaxed" style={{ color: "var(--t2)" }}>
                  {seg.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}



      {/* ── Smart Dictation setup nudge ──────────────────────────────────── */}
      {smartDictationNudge && !sdNudgeDismissed && !isRecording && !showLiveTranscript && (
        <div
          className="rounded-2xl flex-shrink-0 overflow-hidden"
          style={{ background: "var(--surface)", boxShadow: "var(--surface-shadow)", border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)", backdropFilter: "var(--surface-blur)", WebkitBackdropFilter: "var(--surface-blur)" }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <Sparkles size={13} style={{ color: "var(--accent)" }} />
              <p className="text-xs font-semibold" style={{ color: "var(--t2)" }}>Smart Dictation needs setup</p>
            </div>
            <button
              onClick={() => { setSdNudgeDismissed(true); localStorage.setItem("omw_sd_nudge_dismissed", "1"); }}
              className="text-[11px] cursor-pointer transition-colors"
              style={{ color: "var(--t4)" }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <div className="px-4 pb-3 space-y-1">
            <p className="text-[11px]" style={{ color: "var(--t3)" }}>
              {smartDictationNudge === "not_configured"
                ? "AI backend is not configured. Enable an AI backend to use Smart Dictation (⌘B)."
                : "The local AI model isn't downloaded yet. Download it to start using Smart Dictation (⌘B)."}
            </p>
            <button
              onClick={() => onNavigate("models:smart-dictation")}
              className="mt-2 text-[11px] font-semibold cursor-pointer transition-colors"
              style={{ color: "var(--accent)" }}
            >
              {smartDictationNudge === "not_configured" ? "Configure AI →" : "Download model →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Model nudge ──────────────────────────────────────────────────── */}
      {!modelNudgeDismissed && !isRecording && !showLiveTranscript && (
        <div
          className="rounded-2xl flex-shrink-0 overflow-hidden"
          style={{ background: "var(--surface)", boxShadow: "var(--surface-shadow)", border: "1px solid var(--surface-border)", backdropFilter: "var(--surface-blur)", WebkitBackdropFilter: "var(--surface-blur)" }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <p className="text-xs font-semibold" style={{ color: "var(--t2)" }}>Choosing the right model</p>
            <button
              onClick={() => { setModelNudgeDismissed(true); localStorage.setItem("omw_model_nudge_dismissed", "1"); }}
              className="text-[11px] cursor-pointer transition-colors"
              style={{ color: "var(--t4)" }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <div className="px-4 pb-3 space-y-2">
            {([
              { name: "tiny.en",         speed: "⚡⚡⚡", label: "Fastest",   note: "Best for quick notes, reminders & short dictations. English only." },
              { name: "tiny",            speed: "⚡⚡⚡", label: "Fastest",   note: "Same speed as tiny.en but supports all languages. Slightly less accurate for English." },
              { name: "small.en",        speed: "⚡⚡",   label: "Fast",      note: "Great for everyday use. Better accuracy than tiny with minimal wait. English only." },
              { name: "small",           speed: "⚡⚡",   label: "Fast",      note: "Multilingual version of small.en. Good balance of speed and language coverage." },
              { name: "medium.en",       speed: "⚡",     label: "Balanced",  note: "Handles technical terms, names & complex vocabulary well. English only." },
              { name: "medium",          speed: "⚡",     label: "Balanced",  note: "Same as medium.en with full multilingual support. Ideal for mixed-language content." },
              { name: "large-v3-turbo",  speed: "⚡🐢",  label: "Accurate",  note: "High accuracy with all languages. Good for meetings & long dictations." },
              { name: "large-v3",        speed: "🐢",     label: "Max",       note: "Highest possible accuracy across all languages. Use when every word matters." },
            ] as const).map((m) => (
              <div key={m.name} className="flex items-start gap-3">
                <div className="w-28 shrink-0">
                  <span
                    className="text-[10px] font-mono font-semibold"
                    style={{ color: activeModel === m.name ? "var(--accent)" : "var(--t3)" }}
                  >
                    {m.name}
                  </span>
                  {activeModel === m.name && (
                    <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>active</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px]" style={{ color: "var(--t4)" }}>{m.speed} {m.label} — </span>
                  <span className="text-[10px]" style={{ color: "var(--t4)" }}>{m.note}</span>
                </div>
              </div>
            ))}
            <button
              onClick={() => onNavigate("models")}
              className="mt-3 text-[11px] font-semibold cursor-pointer transition-colors"
              style={{ color: "var(--accent)" }}
            >
              Change model →
            </button>
          </div>
        </div>
      )}

      {/* ── Tips ────────────────────────────────────────────────────── */}
      {!isRecording && !showLiveTranscript && (
        <TipsSection onNavigate={onNavigate} />
      )}
    </div>
  );
}
