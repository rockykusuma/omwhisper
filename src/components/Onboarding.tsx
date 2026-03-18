import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface DownloadProgress {
  name: string;
  progress: number;
  done: boolean;
  error: string | null;
}

interface Props {
  onComplete: () => void;
}

// Om logo SVG inline
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

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadDone, setDownloadDone] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [liveSegments, setLiveSegments] = useState<string[]>([]);
  const [platform, setPlatform] = useState<string>("macos");

  const TOTAL_STEPS = 5;

  // Fetch platform
  useEffect(() => {
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
  }, []);

  // Check if tiny.en is already downloaded
  useEffect(() => {
    invoke<{ name: string; is_downloaded: boolean }[]>("get_models").then(models => {
      const tiny = models.find(m => m.name === "tiny.en");
      if (tiny?.is_downloaded) setDownloadDone(true);
    });
  }, []);

  // Listen for download progress
  useEffect(() => {
    const unlisten = listen<DownloadProgress>("download-progress", (e) => {
      const { name, progress, done, error } = e.payload;
      if (name !== "tiny.en") return;
      if (done) {
        if (error) {
          setDownloadError(error);
          setDownloadProgress(null);
        } else {
          setDownloadDone(true);
          setDownloadProgress(1);
        }
      } else {
        setDownloadProgress(progress);
      }
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // Listen for live transcription in step 3
  useEffect(() => {
    const unlisten = listen<{ segments: { text: string }[] }>("transcription-update", (e) => {
      const texts = e.payload.segments.map(s => s.text).filter(Boolean);
      if (texts.length > 0) setLiveSegments(prev => [...prev, ...texts]);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  async function handleMicPermission() {
    const granted = await invoke<boolean>("request_microphone_permission");
    setMicGranted(granted);
    if (granted) setTimeout(() => setStep(2), 800);
  }

  async function handleDownloadModel() {
    setDownloadError(null);
    setDownloadProgress(0);
    await invoke("download_model", { name: "tiny.en" });
  }

  async function handleStartTryout() {
    setLiveSegments([]);
    setIsRecording(true);
    await invoke("start_transcription", { model: "models/ggml-tiny.en.bin" });
  }

  async function handleStopTryout() {
    await invoke("stop_transcription");
    setIsRecording(false);
  }

  async function handleFinish() {
    if (isRecording) await invoke("stop_transcription");
    await invoke("complete_onboarding");
    onComplete();
  }

  const cardClass = "flex flex-col items-center text-center max-w-md mx-auto px-8 py-12";

  // Step 0 — Welcome
  const step0 = (
    <div className={cardClass}>
      <OmLogo size={80} />
      <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-teal-400 mt-6 mb-3"
        style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Welcome to OmWhisper
      </h1>
      <p className="text-white/50 text-base leading-relaxed mb-10"
        style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Real-time, on-device speech transcription.<br />
        Your voice. Your device. Your privacy.
      </p>
      <button onClick={() => setStep(1)}
        className="px-10 py-3.5 rounded-xl bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all duration-300 hover:-translate-y-0.5 cursor-pointer"
        style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Get Started
      </button>
    </div>
  );

  // Step 1 — Microphone
  const step1 = (
    <div className={cardClass}>
      <div className="text-5xl mb-6">🎙</div>
      <h2 className="text-2xl font-bold text-white mb-3" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Microphone Access
      </h2>
      <p className="text-white/50 text-sm leading-relaxed mb-8" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        OmWhisper needs access to your microphone to transcribe your speech. Audio is processed entirely on your device — nothing is ever sent to the cloud.
      </p>
      {micGranted === null && (
        <button onClick={handleMicPermission}
          className="px-8 py-3 rounded-xl bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all duration-300 cursor-pointer"
          style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Grant Microphone Access
        </button>
      )}
      {micGranted === true && (
        <div className="flex items-center gap-2 text-emerald-400" style={{ fontFamily: "'DM Mono', monospace" }}>
          <span>✓</span><span>Microphone access granted</span>
        </div>
      )}
      {micGranted === false && (
        <div className="text-center">
          <p className="text-red-400 text-sm mb-4" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Microphone access was denied.
          </p>
          <p className="text-white/40 text-xs" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            {platform === "windows"
              ? "Go to Settings → Privacy & Security → Microphone Privacy Settings and enable OmWhisper, then restart the app."
              : "Go to System Settings → Privacy & Security → Microphone and enable OmWhisper, then restart the app."}
          </p>
        </div>
      )}
    </div>
  );

  // Step 2 — Download Model
  const step2 = (
    <div className={cardClass}>
      <div className="text-5xl mb-6">🧠</div>
      <h2 className="text-2xl font-bold text-white mb-3" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Download AI Model
      </h2>
      <p className="text-white/50 text-sm leading-relaxed mb-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        OmWhisper uses OpenAI's Whisper model running locally on your device. Let's download the tiny model to get started.
      </p>
      <p className="text-white/40 text-xs mb-8" style={{ fontFamily: "'DM Mono', monospace" }}>
        tiny.en · 75 MB · Fastest model
      </p>

      {downloadProgress === null && !downloadDone && (
        <button onClick={handleDownloadModel}
          className="px-8 py-3 rounded-xl bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all duration-300 cursor-pointer"
          style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Download tiny.en
        </button>
      )}

      {downloadProgress !== null && !downloadDone && (
        <div className="w-full max-w-xs">
          <div className="flex justify-between text-xs text-white/40 mb-1" style={{ fontFamily: "'DM Mono', monospace" }}>
            <span>Downloading…</span>
            <span>{Math.round(downloadProgress * 100)}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress * 100}%` }} />
          </div>
          <p className="text-white/35 text-xs mt-2 text-center" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Verifying SHA256…
          </p>
        </div>
      )}

      {downloadDone && (
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-emerald-400" style={{ fontFamily: "'DM Mono', monospace" }}>
            <span>✓</span><span>Model downloaded & verified</span>
          </div>
          <button onClick={() => setStep(3)}
            className="px-8 py-3 rounded-xl bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all duration-300 cursor-pointer"
            style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Continue
          </button>
        </div>
      )}

      {downloadError && (
        <p className="text-red-400 text-xs mt-4" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          ✗ {downloadError}
        </p>
      )}
      <p className="text-white/35 text-xs mt-6" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        You can download larger models later in Settings → Models
      </p>
    </div>
  );

  // Step 3 — Try it out
  const step3 = (
    <div className={cardClass}>
      <div className="text-5xl mb-6">✨</div>
      <h2 className="text-2xl font-bold text-white mb-3" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Say Something!
      </h2>
      <p className="text-white/50 text-sm leading-relaxed mb-8" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Let's try it out. Press the button below and start speaking. Your words will appear in real time.
      </p>

      <button
        onClick={isRecording ? handleStopTryout : handleStartTryout}
        className={`px-8 py-3 rounded-xl font-semibold text-sm transition-all duration-300 cursor-pointer mb-6 ${
          isRecording ? "bg-red-500 text-white hover:bg-red-400" : "bg-emerald-500 text-black hover:bg-emerald-400"
        }`}
        style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {isRecording ? "⏹ Stop" : "⏺ Start Speaking"}
      </button>

      {isRecording && (
        <div className="flex items-center gap-2 text-emerald-400/60 text-xs mb-4" style={{ fontFamily: "'DM Mono', monospace" }}>
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Listening…
        </div>
      )}

      {liveSegments.length > 0 && (
        <div className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left max-h-32 overflow-y-auto">
          <p className="text-white/80 text-sm leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            {liveSegments.join(" ")}
          </p>
        </div>
      )}

      {liveSegments.length > 0 && (
        <button onClick={() => setStep(4)}
          className="mt-6 px-8 py-3 rounded-xl bg-emerald-500 text-black font-semibold hover:bg-emerald-400 transition-all duration-300 cursor-pointer"
          style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Looks Good! →
        </button>
      )}
    </div>
  );

  // Step 4 — Ready
  const step4 = (
    <div className={cardClass}>
      <OmLogo size={64} />
      <h2 className="text-2xl font-bold text-white mt-6 mb-3" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        You're All Set!
      </h2>
      <p className="text-white/50 text-sm leading-relaxed mb-8" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {platform === "windows" ? "OmWhisper lives in your system tray." : "OmWhisper lives in your menu bar."} Use the global hotkey to start transcribing from anywhere.
      </p>

      <div className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 mb-6">
        <div className="flex items-center justify-between">
          <span className="text-white/60 text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>Global Hotkey</span>
          <kbd className="px-3 py-1 rounded-lg bg-white/[0.08] text-white text-sm" style={{ fontFamily: "'DM Mono', monospace" }}>
            {platform === "windows" ? "Ctrl Shift V" : "⌘ Shift V"}
          </kbd>
        </div>
      </div>

      <button onClick={handleFinish}
        className="px-10 py-3.5 rounded-xl bg-emerald-500 text-black font-bold hover:bg-emerald-400 transition-all duration-300 hover:-translate-y-0.5 cursor-pointer"
        style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Start Using OmWhisper
      </button>
    </div>
  );

  const steps = [step0, step1, step2, step3, step4];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(165deg, #0a0f0d 0%, #0d1a14 40%, #0a0f0d 100%)" }}>
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 600px 400px at 50% 20%, rgba(52,211,153,0.06) 0%, transparent 70%)" }} />

      <div className="relative z-10 w-full">
        {steps[step]}
        <StepDots current={step} total={TOTAL_STEPS} />
      </div>
    </div>
  );
}
