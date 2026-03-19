import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onComplete: () => void;
}

function OmLogo({ size = 64 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size}>
      <defs>
        <linearGradient id="onbGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6ee7b7" />
          <stop offset="50%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill="none" stroke="url(#onbGrad)" strokeWidth="1.5" opacity="0.3" />
      <text x="60" y="60" textAnchor="middle" dominantBaseline="central"
        fill="url(#onbGrad)" style={{ fontSize: "72px", fontFamily: "serif" }}>ॐ</text>
    </svg>
  );
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5 justify-center mt-8">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`rounded-full transition-all duration-300 ${
          i === current ? "w-4 h-1.5 bg-emerald-400" : "w-1.5 h-1.5 bg-white/20"
        }`} />
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
    <div className="flex items-center justify-between gap-4 w-full px-4 py-3 rounded-xl"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div className="text-left">
          <p className="text-sm text-white/80" style={{ fontFamily: "'DM Sans', sans-serif" }}>{label}</p>
          <p className="text-[11px] mt-0.5" style={{
            fontFamily: "'DM Mono', monospace",
            color: granted === null ? "rgba(255,255,255,0.3)" : granted ? "#34d399" : "#f87171",
          }}>
            {granted === null ? "Checking…" : granted ? "✓ Granted" : "✗ Not granted"}
          </p>
        </div>
      </div>
      {granted === false && (
        <button
          onClick={onOpen}
          className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
          style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.13)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
        >
          Fix →
        </button>
      )}
    </div>
  );
}

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<string>("macos");

  const TOTAL_STEPS = 3;

  useEffect(() => {
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
  }, []);

  // Check both permissions when step 1 is active
  useEffect(() => {
    if (step !== 1) return;
    invoke<boolean>("check_microphone_permission").then(setMicGranted).catch(() => {});
    invoke<boolean>("check_accessibility_permission").then(setAccessibilityGranted).catch(() => {});
  }, [step]);

  // Auto-advance when both are granted
  useEffect(() => {
    if (micGranted === true && accessibilityGranted === true) {
      setTimeout(() => setStep(2), 800);
    }
  }, [micGranted, accessibilityGranted]);

  async function handleFinish() {
    await invoke("complete_onboarding");
    onComplete();
  }

  const cardClass = "flex flex-col items-center text-center max-w-md mx-auto px-8 py-12";

  // Step 0 — Welcome
  const step0 = (
    <div className="flex flex-col items-center text-center max-w-md mx-auto px-8 py-12">
      <style>{`
        @keyframes onb-breathe {
          0%, 100% { transform: scale(1);    opacity: 1;   }
          50%       { transform: scale(1.07); opacity: 0.85; }
        }
        @keyframes onb-ring1 {
          0%   { transform: scale(1);    opacity: 0.15; }
          50%  { transform: scale(1.18); opacity: 0;    }
          100% { transform: scale(1);    opacity: 0.15; }
        }
        @keyframes onb-ring2 {
          0%   { transform: scale(1);    opacity: 0.08; }
          50%  { transform: scale(1.32); opacity: 0;    }
          100% { transform: scale(1);    opacity: 0.08; }
        }
        @keyframes onb-spin {
          from { transform: rotate(0deg);   }
          to   { transform: rotate(360deg); }
        }
        @keyframes onb-fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        @keyframes onb-glow {
          0%, 100% { opacity: 0.4; }
          50%      { opacity: 0.9; }
        }
      `}</style>

      {/* Logo with ambient rings */}
      <div className="relative flex items-center justify-center mb-8" style={{ width: 160, height: 160 }}>
        {/* Outer ripple rings */}
        <div className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 70%)", animation: "onb-ring1 3s ease-in-out infinite" }} />
        <div className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(52,211,153,0.08) 0%, transparent 70%)", animation: "onb-ring2 3s ease-in-out 0.8s infinite" }} />

        {/* Spinning dashed orbit */}
        <svg className="absolute inset-0" width="160" height="160" viewBox="0 0 160 160"
          style={{ animation: "onb-spin 18s linear infinite" }}>
          <circle cx="80" cy="80" r="72" fill="none"
            stroke="url(#orbitGrad)" strokeWidth="0.75"
            strokeDasharray="6 10" opacity="0.35" />
          <defs>
            <linearGradient id="orbitGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6ee7b7" />
              <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* Glowing backdrop circle */}
        <div className="absolute rounded-full"
          style={{ width: 100, height: 100, background: "radial-gradient(circle, rgba(52,211,153,0.12) 0%, transparent 70%)", animation: "onb-glow 2.5s ease-in-out infinite" }} />

        {/* Om symbol */}
        <div style={{ animation: "onb-breathe 3.5s ease-in-out infinite" }}>
          <svg viewBox="0 0 120 120" width={96} height={96}>
            <defs>
              <linearGradient id="onbGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6ee7b7" />
                <stop offset="50%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#2dd4bf" />
              </linearGradient>
              <filter id="omGlow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <text x="60" y="62" textAnchor="middle" dominantBaseline="central"
              fill="url(#onbGrad2)" filter="url(#omGlow)"
              style={{ fontSize: "78px", fontFamily: "serif" }}>ॐ</text>
          </svg>
        </div>
      </div>

      {/* Title */}
      <h1
        className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-teal-400 mb-3"
        style={{ fontFamily: "'DM Sans', sans-serif", animation: "onb-fade-up 0.7s ease-out 0.1s both" }}
      >
        OmWhisper
      </h1>

      {/* Tagline */}
      <p className="text-white/45 text-base leading-relaxed mb-2"
        style={{ fontFamily: "'DM Sans', sans-serif", animation: "onb-fade-up 0.7s ease-out 0.25s both" }}>
        Real-time, on-device speech transcription.
      </p>
      <p className="text-white/25 text-sm mb-10"
        style={{ fontFamily: "'DM Sans', sans-serif", animation: "onb-fade-up 0.7s ease-out 0.35s both" }}>
        Your voice. Your device. Your privacy.
      </p>

      {/* CTA */}
      <div style={{ animation: "onb-fade-up 0.7s ease-out 0.5s both" }}>
        <button onClick={() => setStep(1)}
          className="px-10 py-3.5 rounded-xl bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all duration-300 hover:-translate-y-0.5 cursor-pointer"
          style={{ fontFamily: "'DM Sans', sans-serif", boxShadow: "0 0 24px rgba(52,211,153,0.25)" }}>
          Get Started
        </button>
      </div>
    </div>
  );

  // Step 1 — Permissions
  const bothGranted = micGranted === true && accessibilityGranted === true;
  const step1 = (
    <div className={cardClass}>
      <div className="text-5xl mb-6">🔐</div>
      <h2 className="text-2xl font-bold text-white mb-3" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Permissions
      </h2>
      <p className="text-white/50 text-sm leading-relaxed mb-8" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        OmWhisper needs two permissions to work properly.
      </p>

      <div className="w-full space-y-3 mb-8">
        <PermissionRow
          icon="🎙"
          label="Microphone"
          granted={micGranted}
          onOpen={() => invoke("open_accessibility_settings").catch(() => {})}
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
        <div className="flex items-center gap-2 text-emerald-400 text-sm mb-4" style={{ fontFamily: "'DM Mono', monospace" }}>
          <span>✓</span><span>All permissions granted</span>
        </div>
      )}

      {!bothGranted && (micGranted !== null || accessibilityGranted !== null) && (
        <button onClick={() => setStep(2)}
          className="text-white/30 text-xs hover:text-white/50 transition-colors cursor-pointer"
          style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Continue anyway →
        </button>
      )}
    </div>
  );

  // Step 2 — All Set
  const step2 = (
    <div className={cardClass}>
      <OmLogo size={64} />
      <h2 className="text-2xl font-bold text-white mt-6 mb-3" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        You're All Set!
      </h2>
      <p className="text-white/50 text-sm leading-relaxed mb-6" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {platform === "windows" ? "OmWhisper lives in your system tray." : "OmWhisper lives in your menu bar."} Use the global hotkey to start transcribing from anywhere.
      </p>

      <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-white/60 text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>Global Hotkey</span>
          <kbd className="px-3 py-1 rounded-lg bg-white/[0.08] text-white text-sm" style={{ fontFamily: "'DM Mono', monospace" }}>
            {platform === "windows" ? "Ctrl Shift V" : "⌘ Shift V"}
          </kbd>
        </div>
      </div>

      <p className="text-white/35 text-xs mb-8" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Pick a transcription model in AI Models after launch.
      </p>

      <button onClick={handleFinish}
        className="px-10 py-3.5 rounded-xl bg-emerald-500 text-black font-bold hover:bg-emerald-400 transition-all duration-300 hover:-translate-y-0.5 cursor-pointer"
        style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Start Using OmWhisper
      </button>
    </div>
  );

  const steps = [step0, step1, step2];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(165deg, #0a0f0d 0%, #0d1a14 40%, #0a0f0d 100%)" }}>
      <div className="fixed inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 600px 400px at 50% 20%, rgba(52,211,153,0.06) 0%, transparent 70%)" }} />
      <div className="relative z-10 w-full">
        {steps[step]}
        <StepDots current={step} total={TOTAL_STEPS} />
      </div>
    </div>
  );
}
