import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Mic, MicOff, Sparkles } from "lucide-react";
import type { TranscriptionSegment, AppSettings } from "../types";
import { STORAGE_KEYS } from "../utils/storageKeys";
import TipsSection from "./TipsSection";

const isWindows = navigator.platform.startsWith("Win");

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
            className={`w-[3px] rounded-full transition-all duration-75 ${active ? "bg-emerald-400" : ""}`}
            style={active
              ? { height: `${Math.max(30, Math.sin((i / bars) * Math.PI) * 100)}%` }
              : { height: "20%", background: "var(--t4)" }
            }
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

// ── Props ────────────────────────────────────────────────────────────────────

interface HomeViewProps {
  isRecording: boolean;
  isSmartDictation: boolean;
  isPolishing: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  activeModel: string;
  onNavigate: (view: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function HomeView({
  isRecording,
  isSmartDictation,
  isPolishing,
  onStartRecording,
  onStopRecording,
  activeModel,
  onNavigate,
}: HomeViewProps) {
  // ── Recording state ──
  const [, setSegments] = useState<TranscriptionSegment[]>([]);
  const [resultText, setResultText] = useState<string>("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingStartRef = useRef<number>(0);
  const segmentsRef = useRef<TranscriptionSegment[]>([]);

  // ── Permissions ──
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>("check_accessibility_permission").then(setAccessibilityGranted).catch(() => {});
    invoke<boolean>("check_microphone_permission").then(setMicGranted).catch(() => {});
    const unlisten = listen("accessibility-permission-missing", () => setAccessibilityGranted(false));
    return () => { unlisten.then((f) => f()); };
  }, []);

  // ── Home state ──
  const [micName, setMicName] = useState("Default Microphone");
  const [applyPolishToRegular, setApplyPolishToRegular] = useState(false);
  const [modelNudgeDismissed, setModelNudgeDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEYS.MODEL_NUDGE_DISMISSED) === "1"
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
    () => localStorage.getItem(STORAGE_KEYS.SD_NUDGE_DISMISSED) === "1"
  );

  // ── Data loaders ──
  const loadSettings = useCallback(async () => {
    const [s, availableDevices] = await Promise.all([
      invoke<{ audio_input_device: string | null; apply_polish_to_regular: boolean; ai_backend: string }>("get_settings").catch(() => null),
      invoke<string[]>("get_audio_devices").catch(() => [] as string[]),
    ]);
    const savedDevice = s?.audio_input_device;
    const deviceConnected = savedDevice ? availableDevices.includes(savedDevice) : false;
    setMicName(deviceConnected ? savedDevice! : "Default Microphone");
    setApplyPolishToRegular(s?.apply_polish_to_regular ?? false);

    // Check smart dictation readiness
    if (!s || s.ai_backend === "disabled") {
      setSmartDictationNudge("not_configured");
      setSdNudgeDismissed(false);
      localStorage.removeItem(STORAGE_KEYS.SD_NUDGE_DISMISSED);
    } else if (s.ai_backend === "built_in") {
      try {
        const models = await invoke<{ is_downloaded: boolean; is_active: boolean }[]>("get_llm_models");
        const ready = models.some((m) => m.is_active && m.is_downloaded);
        if (ready) {
          setSmartDictationNudge(null);
        } else {
          setSmartDictationNudge("model_not_downloaded");
          setSdNudgeDismissed(false);
          localStorage.removeItem(STORAGE_KEYS.SD_NUDGE_DISMISSED);
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

  // On start: clear result
  useEffect(() => {
    if (isRecording) {
      recordingStartRef.current = Date.now();
      setSegments([]);
      segmentsRef.current = [];
      setResultText("");
    }
  }, [isRecording]);

  // Accumulate segments into ref (not displayed yet)
  useEffect(() => {
    const unlisten = listen<{ segments: TranscriptionSegment[] }>("transcription-update", (event) => {
      segmentsRef.current = [...segmentsRef.current, ...event.payload.segments];
      setSegments([...segmentsRef.current]);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Freeze final text when done, then fade it out after 6 seconds
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unlisten = listen("transcription-complete", () => {
      const text = segmentsRef.current.map((s) => s.text.trim()).filter(Boolean).join(" ");
      setResultText(text);
      timer = setTimeout(() => setResultText(""), 6000);
    });
    return () => { unlisten.then((f) => f()); clearTimeout(timer); };
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



  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full px-8 py-6 gap-4 overflow-y-auto">

      {/* ── Accessibility badge (top-left) ──────────────────────────────── */}
      {accessibilityGranted !== null && (
        <button
          onClick={() => onNavigate("settings:general")}
          className="absolute top-2 left-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all duration-150 cursor-pointer"
          style={{ background: "var(--surface)", boxShadow: "var(--surface-shadow)", border: "1px solid var(--surface-border)", backdropFilter: "var(--surface-blur)", WebkitBackdropFilter: "var(--surface-blur)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--t1) 6%, var(--surface))"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; }}
          title="Go to Settings → Accessibility"
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accessibilityGranted ? "rgb(52,211,153)" : "rgb(248,113,113)" }} />
          <div className="flex flex-col items-start leading-none">
            <span className="text-[11px]" style={{ color: "var(--t3)" }}>Accessibility</span>
            <span className="text-[10px] mt-0.5" style={{ color: accessibilityGranted ? "var(--accent)" : "rgba(248,113,113,0.85)" }}>
              {accessibilityGranted ? "Granted" : "Not Granted"}
            </span>
          </div>
        </button>
      )}

      {/* ── Mic badge (top-right) ────────────────────────────────────────── */}
      <button
        onClick={() => onNavigate("settings:audio")}
        className="absolute top-2 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all duration-150 cursor-pointer"
        style={{ background: "var(--surface)", boxShadow: "var(--surface-shadow)", border: "1px solid var(--surface-border)", backdropFilter: "var(--surface-blur)", WebkitBackdropFilter: "var(--surface-blur)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--t1) 6%, var(--surface))")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}
        title="Change Microphone"
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: micGranted === false ? "rgb(248,113,113)" : "rgb(52,211,153)" }} />
        <div className="flex flex-col items-start leading-none">
          <span className="text-[11px] truncate max-w-[120px]" style={{ color: "var(--t3)" }}>{micName}</span>
          <span className="text-[10px] mt-0.5" style={{ color: micGranted === false ? "rgba(248,113,113,0.85)" : "var(--accent)" }}>
            {micGranted === null ? "…" : micGranted ? "Granted" : "Not Granted"}
          </span>
        </div>
      </button>

      {/* ── Engine badge ─────────────────────────────────────────────── */}
      <div className="flex justify-center pt-1 pb-0">
        <span className="text-[10px] font-medium" style={{ color: "var(--t4)" }}>
          {engineName === "moonshine" ? "◎ Moonshine" : "◎ Whisper"}
        </span>
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
                <p className={`text-[11px] font-mono ${isSmartDictation ? "text-violet-400/55" : "text-emerald-400/55"}`}>
                  {isSmartDictation ? "Smart Dictation…" : "Listening…"}
                </p>
                <p className="text-[11px] font-mono tabular-nums" style={{ color: "var(--t4)" }}>
                  {formatElapsed(recordingDuration)}
                </p>
              </div>
            </>
          ) : isPolishing ? (
            <div className="flex items-center gap-2">
              <Sparkles size={13} style={{ color: "rgb(167,139,250)" }} className="animate-pulse" />
              <p className="text-[11px] font-mono text-violet-400/70">AI Polishing…</p>
            </div>
          ) : resultText ? (
            <p className="text-sm leading-relaxed text-center select-text max-w-[420px] animate-fade-out" style={{ color: "var(--t2)" }}>
              {resultText}
            </p>
          ) : (
            <div className="flex items-start justify-center gap-6">
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-0.5 px-3 py-2 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--t1) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--t1) 12%, transparent)" }}>
                  {(isWindows ? ["Alt", "Shift", "V"] : ["⌘", "⇧", "V"]).map((k) => (
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
                  {(isWindows ? ["Alt", "Shift", "B"] : ["⌘", "⇧", "B"]).map((k) => (
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
            {isWindows ? "Alt+Shift+V" : "⌘⇧V"} recordings are polished before pasting. Falls back to raw paste if AI is unavailable.
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

      {/* ── Smart Dictation setup nudge ──────────────────────────────────── */}
      {smartDictationNudge && !sdNudgeDismissed && !isRecording && (
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
              onClick={() => { setSdNudgeDismissed(true); localStorage.setItem(STORAGE_KEYS.SD_NUDGE_DISMISSED, "1"); }}
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
                ? `AI backend is not configured. Enable an AI backend to use Smart Dictation (${isWindows ? "Alt+Shift+B" : "⌘B"}).`
                : `The local AI model isn't downloaded yet. Download it to start using Smart Dictation (${isWindows ? "Alt+Shift+B" : "⌘B"}).`}
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
      {!modelNudgeDismissed && !isRecording && (
        <div
          className="rounded-2xl flex-shrink-0 overflow-hidden"
          style={{ background: "var(--surface)", boxShadow: "var(--surface-shadow)", border: "1px solid var(--surface-border)", backdropFilter: "var(--surface-blur)", WebkitBackdropFilter: "var(--surface-blur)" }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <p className="text-xs font-semibold" style={{ color: "var(--t2)" }}>Choosing the right model</p>
            <button
              onClick={() => { setModelNudgeDismissed(true); localStorage.setItem(STORAGE_KEYS.MODEL_NUDGE_DISMISSED, "1"); }}
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
      {!isRecording && (
        <TipsSection onNavigate={onNavigate} />
      )}

    </div>
  );
}
