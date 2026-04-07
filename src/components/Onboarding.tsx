import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onComplete: () => void;
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 justify-center" style={{ position: "absolute", bottom: 22 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          height: 5,
          borderRadius: 99,
          transition: "all 0.3s",
          width: i === current ? 20 : 5,
          background: i === current ? "#34d399" : "var(--border)",
          boxShadow: i === current ? "0 0 8px rgba(52,211,153,0.5)" : "none",
        }} />
      ))}
    </div>
  );
}

function PermissionRow({
  icon, label, granted, onOpen,
}: {
  icon: string;
  label: string;
  granted: boolean | null;
  onOpen: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "13px 16px", borderRadius: 14, width: "100%",
      background: "var(--surface)",
      boxShadow: "var(--nm-pressed-sm)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          background: "var(--bg)",
          boxShadow: "var(--nm-raised-sm)",
        }}>{icon}</div>
        <div>
          <p style={{ fontSize: 13, color: "var(--t1)", fontWeight: 500, fontFamily: "'DM Sans', sans-serif" }}>
            {label}
          </p>
          <p style={{
            fontSize: 11, marginTop: 2, fontFamily: "'DM Mono', monospace",
            color: granted === null ? "var(--t4)" : granted ? "#34d399" : "#f87171",
          }}>
            {granted === null ? "Checking…" : granted ? "✓ Granted" : "✗ Not granted"}
          </p>
        </div>
      </div>
      {granted === false && (
        <button onClick={onOpen} style={{
          fontSize: 12, padding: "6px 14px", borderRadius: 8,
          border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
          color: "var(--t2)", background: "var(--bg)",
          boxShadow: "var(--nm-raised-sm)",
        }}>Fix →</button>
      )}
    </div>
  );
}

const neuBtn: React.CSSProperties = {
  background: "linear-gradient(135deg, #2ecc8f 0%, #34d399 60%, #2dd4bf 100%)",
  color: "#020706",
  fontWeight: 700,
  fontSize: 14,
  border: "none",
  borderRadius: 14,
  padding: "14px 40px",
  cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif",
  letterSpacing: "0.01em",
  boxShadow: "var(--nm-raised), 0 0 24px rgba(52,211,153,0.25)",
  transition: "all 0.2s ease",
};

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<string>("macos");

  const TOTAL_STEPS = 3;

  useEffect(() => {
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
  }, []);

  useEffect(() => {
    if (step !== 1) return;
    invoke<boolean>("check_microphone_permission").then(setMicGranted).catch(() => {});
    invoke<boolean>("check_accessibility_permission").then(setAccessibilityGranted).catch(() => {});
  }, [step]);

  useEffect(() => {
    if (micGranted === true && accessibilityGranted === true) {
      setTimeout(() => setStep(2), 800);
    }
  }, [micGranted, accessibilityGranted]);

  async function handleFinish() {
    await invoke("complete_onboarding");
    onComplete();
  }

  const screenStyle: React.CSSProperties = {
    width: "100%", maxWidth: 440,
    display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
    padding: "48px 48px 60px",
    position: "relative",
  };

  // ── Step 0 — Welcome ──────────────────────────────────────────────────────
  const step0 = (
    <div style={screenStyle}>
      <style>{`
        @keyframes onb-breathe-glow {
          0%,100% { box-shadow: -8px -8px 20px rgba(255,255,255,0.04), 8px 8px 20px rgba(0,0,0,0.65), 0 0 30px rgba(52,211,153,0.06); }
          50%      { box-shadow: -8px -8px 20px rgba(255,255,255,0.04), 8px 8px 20px rgba(0,0,0,0.65), 0 0 52px rgba(52,211,153,0.18); }
        }
        @keyframes onb-fade-up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* App icon in neumorphic orb */}
      <div style={{
        width: 148, height: 148, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 32,
        background: "var(--surface)",
        animation: "onb-breathe-glow 3.5s ease-in-out infinite",
      }}>
        <img
          src="/app-icon.png"
          alt="OmWhisper"
          style={{ width: 92, height: 92, borderRadius: 22, filter: "drop-shadow(0 0 14px rgba(52,211,153,0.28))" }}
        />
      </div>

      <h1 style={{
        fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em",
        background: "linear-gradient(135deg, #6ee7b7 0%, #34d399 50%, #2dd4bf 100%)",
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        backgroundClip: "text",
        marginBottom: 10,
        fontFamily: "'DM Sans', sans-serif",
        animation: "onb-fade-up 0.6s ease-out 0.1s both",
      }}>OmWhisper</h1>

      <p style={{
        fontSize: 14, color: "var(--t3)", lineHeight: 1.6,
        marginBottom: 5, fontFamily: "'DM Sans', sans-serif",
        animation: "onb-fade-up 0.6s ease-out 0.22s both",
      }}>Real-time, on-device speech transcription.</p>

      <p style={{
        fontSize: 12, color: "var(--t4)", marginBottom: 36,
        fontFamily: "'DM Sans', sans-serif",
        animation: "onb-fade-up 0.6s ease-out 0.34s both",
      }}>Your voice. Your device. Your privacy.</p>

      <div style={{ animation: "onb-fade-up 0.6s ease-out 0.46s both" }}>
        <button
          style={neuBtn}
          onMouseEnter={e => (e.currentTarget.style.boxShadow = "var(--nm-raised), 0 0 40px rgba(52,211,153,0.42)")}
          onMouseLeave={e => (e.currentTarget.style.boxShadow = "var(--nm-raised), 0 0 24px rgba(52,211,153,0.25)")}
          onClick={() => setStep(1)}
        >Get Started</button>
      </div>
    </div>
  );

  // ── Step 1 — Permissions ──────────────────────────────────────────────────
  const bothGranted = micGranted === true && accessibilityGranted === true;
  const step1 = (
    <div style={screenStyle}>
      {/* Header icon */}
      <div style={{
        width: 68, height: 68, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 26, marginBottom: 18,
        background: "var(--surface)",
        boxShadow: "var(--nm-raised-sm)",
      }}>🔐</div>

      <h2 style={{ fontSize: 21, fontWeight: 700, color: "var(--t1)", marginBottom: 7, fontFamily: "'DM Sans', sans-serif" }}>
        Permissions
      </h2>
      <p style={{ fontSize: 13, color: "var(--t3)", lineHeight: 1.5, marginBottom: 26, fontFamily: "'DM Sans', sans-serif" }}>
        OmWhisper needs two permissions to work properly.
      </p>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <PermissionRow
          icon="🎙"
          label="Microphone"
          granted={micGranted}
          onOpen={() => invoke<boolean>("request_microphone_permission").then(setMicGranted).catch(() => {})}
        />
        <PermissionRow
          icon="♿"
          label="Accessibility"
          granted={accessibilityGranted}
          onOpen={() => {
            invoke("open_accessibility_settings").catch(() => {});
            setTimeout(() => invoke<boolean>("check_accessibility_permission").then(setAccessibilityGranted).catch(() => {}), 3000);
          }}
        />
      </div>

      {bothGranted && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#34d399", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
          <span>✓</span><span>All permissions granted</span>
        </div>
      )}

      {!bothGranted && (micGranted !== null || accessibilityGranted !== null) && (
        <button onClick={() => setStep(2)} style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 12, color: "var(--t4)", fontFamily: "'DM Sans', sans-serif",
          marginTop: bothGranted ? 8 : 0,
        }}>Continue anyway →</button>
      )}
    </div>
  );

  // ── Step 2 — All Set ──────────────────────────────────────────────────────
  const step2 = (
    <div style={screenStyle}>
      <div style={{
        width: 104, height: 104, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 22,
        background: "var(--surface)",
        boxShadow: "var(--nm-raised-sm), 0 0 28px rgba(52,211,153,0.09)",
      }}>
        <img
          src="/app-icon.png"
          alt="OmWhisper"
          style={{ width: 64, height: 64, borderRadius: 16, filter: "drop-shadow(0 0 8px rgba(52,211,153,0.2))" }}
        />
      </div>

      <h2 style={{ fontSize: 21, fontWeight: 700, color: "var(--t1)", marginBottom: 7, fontFamily: "'DM Sans', sans-serif" }}>
        You're All Set!
      </h2>
      <p style={{ fontSize: 13, color: "var(--t3)", lineHeight: 1.5, marginBottom: 22, fontFamily: "'DM Sans', sans-serif" }}>
        {platform === "windows" ? "OmWhisper lives in your system tray." : "OmWhisper lives in your menu bar."}{" "}
        {platform !== "windows" ? "Hold Fn to record, release to transcribe." : "Press Alt+Shift+V to start recording."}
      </p>

      {/* PTT shortcuts — macOS only, two rows */}
      {platform !== "windows" && (
        <div style={{
          width: "100%", borderRadius: 14, marginBottom: 12,
          background: "var(--surface)", boxShadow: "var(--nm-pressed-sm)",
          overflow: "hidden",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px" }}>
            <div>
              <span style={{ fontSize: 13, color: "var(--t3)", fontFamily: "'DM Sans', sans-serif" }}>Push-to-Talk</span>
              <span style={{ fontSize: 11, color: "var(--t4)", fontFamily: "'DM Sans', sans-serif", display: "block" }}>Hold to record, release to transcribe</span>
            </div>
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: 12, color: "var(--t1)",
              padding: "4px 10px", borderRadius: 7,
              background: "var(--bg)", boxShadow: "var(--nm-raised-sm)",
            }}>Fn</span>
          </div>
          <div style={{ height: 1, background: "color-mix(in srgb, var(--t1) 6%, transparent)", margin: "0 18px" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px" }}>
            <div>
              <span style={{ fontSize: 13, color: "var(--t3)", fontFamily: "'DM Sans', sans-serif" }}>Smart Dictation PTT</span>
              <span style={{ fontSize: 11, color: "var(--t4)", fontFamily: "'DM Sans', sans-serif", display: "block" }}>AI polishes your speech before pasting</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {["Fn", "⌃ Ctrl"].map(k => (
                <span key={k} style={{
                  fontFamily: "'DM Mono', monospace", fontSize: 12, color: "var(--t1)",
                  padding: "4px 10px", borderRadius: 7,
                  background: "var(--bg)", boxShadow: "var(--nm-raised-sm)",
                }}>{k}</span>
              ))}
            </div>
          </div>
        </div>
      )}


      <p style={{ fontSize: 12, color: "var(--t4)", marginBottom: 26, fontFamily: "'DM Sans', sans-serif" }}>
        Explore AI Models to download larger, more accurate models.
      </p>

      <button
        style={neuBtn}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = "var(--nm-raised), 0 0 40px rgba(52,211,153,0.42)")}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = "var(--nm-raised), 0 0 24px rgba(52,211,153,0.25)")}
        onClick={handleFinish}
      >Start Using OmWhisper</button>
    </div>
  );

  const steps = [step0, step1, step2];

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "var(--bg)",
      position: "relative",
    }}>
      {/* Top ambient glow */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 500px 300px at 50% 15%, rgba(52,211,153,0.055) 0%, transparent 70%)",
      }} />

      <div style={{ position: "relative", zIndex: 10, width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {steps[step]}
        <StepDots current={step} total={TOTAL_STEPS} />
      </div>
    </div>
  );
}
