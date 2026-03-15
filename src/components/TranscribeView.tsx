import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Mic, MicOff, Sparkles } from "lucide-react";
import type { TranscriptionSegment } from "../types";

interface Props {
  isRecording: boolean;
  isSmartDictation: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

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

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  return `${m}:${String(secs % 60).padStart(2, "0")}`;
}

export default function TranscribeView({ isRecording, isSmartDictation, onStartRecording, onStopRecording }: Props) {
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recordingStartRef = useRef<number>(0);

  // Reset on new recording
  useEffect(() => {
    if (isRecording) {
      recordingStartRef.current = Date.now();
      setSegments([]);
    }
  }, [isRecording]);

  // Display segments
  useEffect(() => {
    const unlisten = listen<{ segments: TranscriptionSegment[] }>("transcription-update", (event) => {
      setSegments((prev) => [...prev, ...event.payload.segments]);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Audio level
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

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [segments]);

  return (
    <div className="flex flex-col h-full px-8 py-6">
      {/* Record button */}
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="relative">
          <button
            onClick={isRecording ? onStopRecording : onStartRecording}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            className="relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer focus-visible:outline-none"
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
              <span className={`absolute inset-0 rounded-full animate-ping opacity-15 ${isSmartDictation ? "bg-violet-400" : "bg-red-400"}`} />
            )}
            {isRecording ? (
              isSmartDictation
                ? <Sparkles size={26} style={{ color: "rgba(167,139,250,0.85)" }} strokeWidth={1.75} />
                : <MicOff size={26} style={{ color: "rgba(248,113,113,0.85)" }} strokeWidth={1.75} />
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

        {/* Status */}
        <div className="flex flex-col items-center gap-1.5 min-h-[36px] justify-center">
          {isRecording ? (
            <>
              <WaveformMeter level={audioLevel} />
              <div className="flex items-center gap-3">
                <p className={`text-[11px] font-mono ${isSmartDictation ? "text-violet-400/55" : "text-emerald-400/55"}`}>
                  {isSmartDictation ? "Smart Dictation…" : "Listening…"}
                </p>
                <p className="text-white/25 text-[11px] font-mono tabular-nums">
                  {formatDuration(recordingDuration)}
                </p>
              </div>
            </>
          ) : (
            <p className="text-[11px] font-mono" style={{ color: "var(--t4)" }}>
              {segments.length > 0 ? "Recording complete — pasted to your app" : "Press the button or use ⌘⇧V"}
            </p>
          )}
        </div>
      </div>

      {/* Transcript output */}
      {segments.length > 0 && (
        <div className="card-inset overflow-hidden flex-1 min-h-0">
          <div
            className="flex items-center gap-2 px-5 py-3"
            style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 6%, transparent)" }}
          >
            <div
              className={`w-2 h-2 rounded-full ${isRecording ? (isSmartDictation ? "bg-violet-400 animate-pulse" : "bg-red-400 animate-pulse") : "bg-emerald-400"}`}
              style={isRecording ? undefined : { boxShadow: "0 0 5px var(--accent-glow)" }}
            />
            <span className="text-xs font-mono" style={{ color: "var(--t4)" }}>
              {segments.length} segment{segments.length !== 1 ? "s" : ""}
            </span>
            {!isRecording && (
              <button
                onClick={() => setSegments([])}
                className="ml-auto text-[10px] cursor-pointer transition-colors duration-150"
                style={{ color: "var(--t4)" }}
              >
                Clear
              </button>
            )}
          </div>
          <div ref={scrollRef} className="p-5 space-y-3 overflow-y-auto max-h-64 select-text">
            {segments.map((seg) => (
              <div key={`${seg.start_ms}-${seg.end_ms}`} className="flex gap-4">
                <span className="text-emerald-500/35 text-xs shrink-0 mt-0.5 font-mono">
                  {formatTime(seg.start_ms)}
                </span>
                <p className="text-sm leading-relaxed" style={{ color: "var(--t2)" }}>{seg.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
