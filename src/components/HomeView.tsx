import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Mic, MicOff, Sparkles, ChevronRight, Cpu, Clock, Hash, Flame } from "lucide-react";
import type { TranscriptionSegment, TranscriptionEntry, UsageStats } from "../types";

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

function formatRelativeTime(isoString: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

function formatDurationShort(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
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
  const postRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRecordingRef = useRef(false);

  // ── Home state ──
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [micName, setMicName] = useState("Default Microphone");
  const [recentItems, setRecentItems] = useState<TranscriptionEntry[]>([]);

  // ── Data loaders ──
  const loadStats = useCallback(async () => {
    const s = await invoke<UsageStats>("get_usage_stats").catch(() => null);
    setStats(s);
  }, []);

  const loadRecent = useCallback(async () => {
    const items = await invoke<TranscriptionEntry[]>("get_history", { limit: 2, offset: 0 }).catch(() => []);
    setRecentItems(items);
  }, []);

  const loadSettings = useCallback(async () => {
    const s = await invoke<{ audio_input_device: string | null }>("get_settings").catch(() => null);
    setMicName(s?.audio_input_device || "Default Microphone");
  }, []);

  // Initial load
  useEffect(() => {
    loadStats();
    loadSettings();
    loadRecent();
  }, [loadStats, loadSettings, loadRecent]);

  // Settings changes
  useEffect(() => {
    const unlisten = listen("settings-changed", () => loadSettings());
    return () => { unlisten.then((f) => f()); };
  }, [loadSettings]);

  // ── Recording lifecycle ──

  // On start: clear segments, show transcript panel, cancel any post-recording timer
  useEffect(() => {
    if (isRecording) {
      recordingStartRef.current = Date.now();
      setSegments([]);
      setTranscriptionComplete(false);
      setShowLiveTranscript(true);
      if (postRecordingTimerRef.current) {
        clearTimeout(postRecordingTimerRef.current);
        postRecordingTimerRef.current = null;
      }
    }
  }, [isRecording]);

  // On stop: refresh stats, start 5s timer to hide transcript + refresh recent
  useEffect(() => {
    if (wasRecordingRef.current && !isRecording) {
      loadStats();
      postRecordingTimerRef.current = setTimeout(() => {
        setShowLiveTranscript(false);
        loadRecent();
        postRecordingTimerRef.current = null;
      }, 5000);
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording, loadStats, loadRecent]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (postRecordingTimerRef.current) clearTimeout(postRecordingTimerRef.current);
    };
  }, []);

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
    <div className="flex flex-col h-full px-8 py-6 gap-4 overflow-y-auto">

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
            <p className="text-[11px] font-mono text-center leading-relaxed" style={{ color: "var(--t4)" }}>
              {showLiveTranscript && transcriptionComplete
                ? "Recording complete — pasted to your app"
                : "⌘⇧V to dictate anywhere · ⌘⇧B for AI polish"}
            </p>
          )}
        </div>
      </div>

      {/* ── Live transcript panel (visible during recording + 5s after) ── */}
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
            {!isRecording && (
              <button
                onClick={() => {
                  setShowLiveTranscript(false);
                  if (postRecordingTimerRef.current) {
                    clearTimeout(postRecordingTimerRef.current);
                    postRecordingTimerRef.current = null;
                  }
                  loadRecent();
                }}
                className="ml-auto text-[10px] cursor-pointer transition-colors duration-150"
                style={{ color: "var(--t4)" }}
              >
                Clear
              </button>
            )}
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

      {/* ── Stats strip ─────────────────────────────────────────────────── */}
      {stats && stats.total_recordings > 0 && (
        <div className="grid grid-cols-4 gap-2.5 flex-shrink-0">
          {[
            {
              id: "today",
              icon: <Mic size={13} style={{ color: "var(--accent)" }} strokeWidth={2} />,
              value: stats.recordings_today,
              label: "Today",
            },
            {
              id: "words",
              icon: <Hash size={13} style={{ color: "var(--accent)" }} strokeWidth={2} />,
              value: stats.total_words >= 1000
                ? `${(stats.total_words / 1000).toFixed(1)}k`
                : stats.total_words,
              label: "Words",
            },
            {
              id: "streak",
              icon: <Flame size={13} strokeWidth={2} style={{ color: stats.streak_days > 1 ? "#f59e0b" : "var(--accent)" }} />,
              value: stats.streak_days > 1 ? stats.streak_days : stats.recordings_today,
              label: stats.streak_days > 1 ? "Streak" : "Today",
            },
            {
              id: "time",
              icon: <Clock size={13} style={{ color: "var(--accent)" }} strokeWidth={2} />,
              value: (() => {
                const h = Math.floor(stats.total_duration_seconds / 3600);
                const m = Math.floor((stats.total_duration_seconds % 3600) / 60);
                if (h > 0) return `${h}h`;
                if (m > 0) return `${m}m`;
                return `${Math.round(stats.total_duration_seconds)}s`;
              })(),
              label: "Time",
            },
          ].map(({ icon, value, label, id }) => (
            <div
              key={id}
              className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-2"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
            >
              {icon}
              <span
                className="text-xl font-bold font-mono tabular-nums leading-none"
                style={{ color: "var(--t1)" }}
              >
                {value}
              </span>
              <span
                className="text-[9px] font-mono uppercase tracking-wider"
                style={{ color: "var(--t4)" }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Active setup row ─────────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden flex flex-shrink-0"
        style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
      >
        <button
          onClick={() => onNavigate("settings:audio")}
          className="group flex-1 flex items-center gap-2 px-4 py-3 text-left transition-all duration-150 cursor-pointer min-w-0"
          style={{ background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--t1) 4%, transparent)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          title="Open Audio Settings"
        >
          <Mic size={13} style={{ color: "var(--accent)", flexShrink: 0 }} strokeWidth={2} />
          <span className="text-xs truncate flex-1" style={{ color: "var(--t2)" }}>{micName}</span>
          <ChevronRight size={11} className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity -mr-1" style={{ color: "var(--t3)" }} />
        </button>
        <div className="w-px self-stretch shrink-0" style={{ background: "color-mix(in srgb, var(--t1) 6%, transparent)" }} />
        <button
          onClick={() => onNavigate("models")}
          className="group flex-1 flex items-center gap-2 px-4 py-3 text-left transition-all duration-150 cursor-pointer min-w-0"
          style={{ background: "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--t1) 4%, transparent)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          title="Change Model"
        >
          <Cpu size={13} style={{ color: "var(--accent)", flexShrink: 0 }} strokeWidth={2} />
          <span className="text-xs truncate flex-1 font-mono" style={{ color: "var(--t2)" }}>{activeModel}</span>
          <ChevronRight size={11} className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity -mr-1" style={{ color: "var(--t3)" }} />
        </button>
      </div>

      {/* ── Recent recordings (hidden while live transcript is shown) ────── */}
      {!showLiveTranscript && recentItems.length > 0 && (
        <div
          className="rounded-2xl overflow-hidden flex-shrink-0"
          style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 5%, transparent)" }}
          >
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--t4)" }}>
              Recent
            </span>
            <button
              onClick={() => onNavigate("history")}
              className="text-[10px] font-mono cursor-pointer transition-colors duration-150"
              style={{ color: "var(--accent)" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              See all →
            </button>
          </div>
          <ul>
            {recentItems.map((item, idx) => (
              <li
                key={item.id}
                className="px-4 py-3 flex flex-col gap-1"
                style={
                  idx < recentItems.length - 1
                    ? { borderBottom: "1px solid color-mix(in srgb, var(--t1) 5%, transparent)" }
                    : undefined
                }
              >
                <p
                  className="text-xs italic leading-snug"
                  style={{
                    color: "var(--t3)",
                    display: "-webkit-box",
                    WebkitLineClamp: 1,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  "{item.text}"
                </p>
                <p className="text-[10px] font-mono" style={{ color: "var(--t4)" }}>
                  {formatRelativeTime(item.created_at)} · {formatDurationShort(item.duration_seconds)} · {item.model_used}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
