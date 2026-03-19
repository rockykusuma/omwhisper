import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles } from "lucide-react";
import type { AppSettings } from "../types";

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

// ─── Micro pill (bars only, compact) ─────────────────────────────────────────
// 5 bars, no text, 28px tall pill
const MICRO_BARS = [
  { anim: "tb5", dur: 0.95, delay: 0.00 },
  { anim: "tb1", dur: 0.90, delay: 0.10 },
  { anim: "tb2", dur: 1.10, delay: 0.15 },
  { anim: "tb4", dur: 1.00, delay: 0.25 },
  { anim: "tb3", dur: 0.85, delay: 0.30 },
];

function MicroPill({ elapsed }: { elapsed: number }) {
  return (
    <>
      <style>{`
        @keyframes tb1 { 0%,100% { height: 3px } 50% { height: 14px } }
        @keyframes tb2 { 0%,100% { height: 5px } 50% { height: 18px } }
        @keyframes tb3 { 0%,100% { height: 2px } 50% { height: 12px } }
        @keyframes tb4 { 0%,100% { height: 4px } 50% { height: 16px } }
        @keyframes tb5 { 0%,100% { height: 3px } 50% { height: 10px } }
      `}</style>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        background: "rgba(29,158,117,0.12)",
        border: "0.5px solid rgba(29,158,117,0.3)",
        borderRadius: 14,
        padding: "6px 10px",
        height: 28,
      }}>
        {MICRO_BARS.map((b, i) => (
          <div key={i} style={{
            width: 2.5,
            borderRadius: 2,
            background: "#1D9E75",
            animation: `${b.anim} ${b.dur}s ease-in-out ${b.delay}s infinite`,
          }} />
        ))}
        <span style={{
          color: "rgba(29,158,117,0.85)",
          fontSize: 10,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          marginLeft: 5,
          letterSpacing: "0.3px",
        }}>{formatElapsed(elapsed)}</span>
      </div>
    </>
  );
}

// ─── Waveform pill (bars + Listening label + red dot) ─────────────────────────
// 7 bars, "Listening" text, red dot, 80px tall pill
const WAVEFORM_BARS = [
  { anim: "wf1", dur: 1.10, delay: 0.00 },
  { anim: "wf2", dur: 0.90, delay: 0.10 },
  { anim: "wf3", dur: 1.30, delay: 0.15 },
  { anim: "wf4", dur: 1.00, delay: 0.25 },
  { anim: "wf3", dur: 1.20, delay: 0.30 },
  { anim: "wf2", dur: 0.85, delay: 0.20 },
  { anim: "wf1", dur: 1.15, delay: 0.35 },
];

function WaveformPill({ elapsed }: { elapsed: number }) {
  return (
    <>
      <style>{`
        @keyframes wf1 { 0%,100% { height: 8px  } 50% { height: 28px } }
        @keyframes wf2 { 0%,100% { height: 12px } 50% { height: 38px } }
        @keyframes wf3 { 0%,100% { height: 6px  } 50% { height: 48px } }
        @keyframes wf4 { 0%,100% { height: 14px } 50% { height: 34px } }
        @keyframes breathe {
          0%,100% { opacity: 1;    transform: scale(1);    }
          50%      { opacity: 0.6; transform: scale(0.85); }
        }
      `}</style>
      <div style={{
        background: "rgba(29,158,117,0.1)",
        border: "1px solid rgba(29,158,117,0.25)",
        borderRadius: 28,
        padding: "16px 28px",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}>
        {/* Equaliser bars */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, height: 48 }}>
          {WAVEFORM_BARS.map((b, i) => (
            <div key={i} style={{
              width: 4,
              borderRadius: 3,
              background: "#1D9E75",
              animation: `${b.anim} ${b.dur}s ease-in-out ${b.delay}s infinite`,
            }} />
          ))}
        </div>

        {/* Label + timer */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
          <span style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: "0.5px",
            whiteSpace: "nowrap",
          }}>
            Listening
          </span>
          <span style={{
            color: "rgba(29,158,117,0.8)",
            fontSize: 11,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "0.3px",
          }}>{formatElapsed(elapsed)}</span>
        </div>

        {/* Red dot */}
        <div style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#ef4444",
          flexShrink: 0,
          animation: "breathe 1.5s ease-in-out infinite",
        }} />
      </div>
    </>
  );
}

// ─── Polishing pill ───────────────────────────────────────────────────────────

function PolishingPill({ large }: { large?: boolean }) {
  if (large) {
    return (
      <>
        <style>{`
          @keyframes sparkle-spin { 0% { opacity: 0.5; transform: scale(0.85) rotate(0deg); } 50% { opacity: 1; transform: scale(1.1) rotate(180deg); } 100% { opacity: 0.5; transform: scale(0.85) rotate(360deg); } }
        `}</style>
        <div style={{
          background: "rgba(139,92,246,0.1)",
          border: "1px solid rgba(139,92,246,0.25)",
          borderRadius: 28,
          padding: "16px 28px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.85)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: "sparkle-spin 1.8s ease-in-out infinite", flexShrink: 0 }}>
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
          </svg>
          <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 500, letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
            AI Polishing
          </span>
          <div style={{ display: "flex", gap: 3 }}>
            {[0, 0.2, 0.4].map((delay, i) => (
              <div key={i} style={{
                width: 4, height: 4, borderRadius: "50%",
                background: "rgba(167,139,250,0.7)",
                animation: `breathe 1.2s ease-in-out ${delay}s infinite`,
              }} />
            ))}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <style>{`
        @keyframes sparkle-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
      `}</style>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "rgba(139,92,246,0.12)",
        border: "0.5px solid rgba(139,92,246,0.3)",
        borderRadius: 14, padding: "6px 10px", height: 28,
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ animation: "sparkle-pulse 1.2s ease-in-out infinite", flexShrink: 0 }}>
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
        </svg>
        <span style={{ color: "rgba(167,139,250,0.9)", fontSize: 11, fontWeight: 500, letterSpacing: "0.3px", whiteSpace: "nowrap" }}>AI Polishing…</span>
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OverlayWindow() {
  const [overlayStyle, setOverlayStyle] = useState<string>("micro");
  const [applyPolishRegular, setApplyPolishRegular] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  // Load current setting on mount, re-sync when settings change
  useEffect(() => {
    const load = () =>
      invoke<AppSettings>("get_settings")
        .then((s) => {
          setOverlayStyle(s.overlay_style ?? "micro");
          setApplyPolishRegular(s.apply_polish_to_regular ?? false);
        })
        .catch(() => {});
    load();

    const unlistenSettings = listen("settings-changed", load);
    return () => { unlistenSettings.then((f) => f()); };
  }, []);

  // Timer lifecycle is driven entirely by recording-state events.
  useEffect(() => {
    const unlistenState = listen<boolean>("recording-state", (e) => {
      if (e.payload) {
        setIsPolishing(false);
        startTimer();
        invoke<AppSettings>("get_settings")
          .then((s) => {
            setOverlayStyle(s.overlay_style ?? "micro");
            setApplyPolishRegular(s.apply_polish_to_regular ?? false);
          })
          .catch(() => {});
      } else {
        stopTimer();
      }
    });
    return () => { unlistenState.then((f) => f()); };
  }, []);

  // Show polishing state when AI is processing
  useEffect(() => {
    const unlisten = listen<boolean>("polish-state", (e) => {
      setIsPolishing(e.payload);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      {isPolishing ? (
        <PolishingPill large={overlayStyle === "waveform"} />
      ) : (
        <>
          {overlayStyle === "waveform" ? <WaveformPill elapsed={elapsed} /> : <MicroPill elapsed={elapsed} />}
          {applyPolishRegular && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "rgba(29,158,117,0.10)",
              border: "0.5px solid rgba(29,158,117,0.25)",
              borderRadius: 10,
              padding: "3px 8px",
            }}>
              <Sparkles size={9} style={{ color: "#34d399" }} />
              <span style={{ color: "#34d399", fontSize: 9, fontWeight: 500, letterSpacing: "0.4px" }}>AI Polish</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
