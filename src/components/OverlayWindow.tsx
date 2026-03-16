import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles } from "lucide-react";
import type { AppSettings } from "../types";

// ─── Micro pill (bars only, compact) ─────────────────────────────────────────
// 5 bars, no text, 28px tall pill
const MICRO_BARS = [
  { anim: "tb5", dur: 0.95, delay: 0.00 },
  { anim: "tb1", dur: 0.90, delay: 0.10 },
  { anim: "tb2", dur: 1.10, delay: 0.15 },
  { anim: "tb4", dur: 1.00, delay: 0.25 },
  { anim: "tb3", dur: 0.85, delay: 0.30 },
];

function MicroPill() {
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

function WaveformPill() {
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

        {/* Label */}
        <span style={{
          color: "rgba(255,255,255,0.7)",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "0.5px",
          whiteSpace: "nowrap",
        }}>
          Listening
        </span>

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

// ─── Main component ───────────────────────────────────────────────────────────

export default function OverlayWindow() {
  const [overlayStyle, setOverlayStyle] = useState<string>("micro");
  const [applyPolishRegular, setApplyPolishRegular] = useState(false);

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

  // Hide overlay when recording stops; re-read style when recording starts
  useEffect(() => {
    const unlistenState = listen<boolean>("recording-state", (e) => {
      if (!e.payload) {
        invoke("hide_overlay").catch(() => {});
      } else {
        invoke<AppSettings>("get_settings")
          .then((s) => {
            setOverlayStyle(s.overlay_style ?? "micro");
            setApplyPolishRegular(s.apply_polish_to_regular ?? false);
          })
          .catch(() => {});
      }
    });
    return () => { unlistenState.then((f) => f()); };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      {overlayStyle === "waveform" ? <WaveformPill /> : <MicroPill />}
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
    </div>
  );
}
