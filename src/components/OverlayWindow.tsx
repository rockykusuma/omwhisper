import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export default function OverlayWindow() {
  const [segments, setSegments] = useState<string[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(true);

  useEffect(() => {
    const unlistenTx = listen<{ segments: { text: string }[] }>("transcription-update", (e) => {
      const texts = e.payload.segments.map(s => s.text.trim()).filter(Boolean);
      if (texts.length) setSegments(prev => [...prev.slice(-3), ...texts]);
    });

    const unlistenLevel = listen<number>("audio-level", (e) => {
      setAudioLevel(e.payload);
    });

    const unlistenState = listen<boolean>("recording-state", (e) => {
      setIsRecording(e.payload);
    });

    return () => {
      unlistenTx.then(f => f());
      unlistenLevel.then(f => f());
      unlistenState.then(f => f());
    };
  }, []);

  async function handleStop() {
    await invoke("stop_transcription");
  }

  const lastText = segments[segments.length - 1] ?? "";
  const displayText = lastText.length > 60 ? "…" + lastText.slice(-57) : lastText;

  // Waveform bars driven by audio level
  const bars = 12;
  const filled = Math.min(bars, Math.round(audioLevel * bars * 10));

  return (
    <div
      className="flex items-center gap-3 px-4 h-full select-none"
      style={{
        background: "rgba(10, 15, 13, 0.92)",
        backdropFilter: "blur(20px)",
        borderRadius: "16px",
        border: "1px solid rgba(52, 211, 153, 0.15)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 0.5px rgba(255,255,255,0.06)",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* Pulsing ॐ indicator */}
      <div className="shrink-0 flex items-center justify-center">
        {isRecording ? (
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" style={{ width: 24, height: 24 }} />
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center relative z-10">
              <span style={{ fontSize: 13, color: "#34d399", fontFamily: "serif" }}>ॐ</span>
            </div>
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", fontFamily: "serif" }}>ॐ</span>
          </div>
        )}
      </div>

      {/* Waveform */}
      <div className="flex items-end gap-[2px] shrink-0" style={{ height: 20 }}>
        {Array.from({ length: bars }).map((_, i) => (
          <div
            key={i}
            className="rounded-full transition-all duration-75"
            style={{
              width: 2,
              height: i < filled ? `${Math.max(4, Math.min(20, (filled - i) * 3))}px` : "4px",
              background: i < filled ? "#34d399" : "rgba(255,255,255,0.1)",
            }}
          />
        ))}
      </div>

      {/* Transcription text */}
      <div className="flex-1 min-w-0">
        {displayText ? (
          <p className="text-white/80 text-xs truncate" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            {displayText}
          </p>
        ) : (
          <p className="text-white/40 text-xs" style={{ fontFamily: "'DM Mono', monospace" }}>
            {isRecording ? "Listening…" : "Done"}
          </p>
        )}
      </div>

      {/* Stop button */}
      <button
        onClick={handleStop}
        className="shrink-0 w-6 h-6 rounded-full bg-white/[0.06] hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-all duration-200 cursor-pointer flex items-center justify-center text-xs"
        title="Stop recording"
      >
        ■
      </button>
    </div>
  );
}
