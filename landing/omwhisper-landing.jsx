import { useState, useEffect, useRef } from "react";

const WAVEFORM_BARS = 40;

function OmLogo({ size = 40, glow = false }) {
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {glow && (
        <div
          className="absolute inset-0 rounded-full animate-pulse"
          style={{
            background: "radial-gradient(circle, rgba(16,185,129,0.25) 0%, transparent 70%)",
            transform: "scale(2.5)",
          }}
        />
      )}
      <svg viewBox="0 0 120 120" width={size} height={size} className="relative z-10">
        <defs>
          <linearGradient id="omGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6ee7b7" />
            <stop offset="50%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <filter id="omGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="60" cy="60" r="56" fill="none" stroke="url(#omGrad)" strokeWidth="2" opacity="0.3" />
        <text
          x="60" y="60"
          textAnchor="middle" dominantBaseline="central"
          fill="url(#omGrad)" filter="url(#omGlow)"
          style={{ fontSize: "72px", fontFamily: "serif" }}
        >ॐ</text>
      </svg>
    </div>
  );
}

function AnimatedWaveform({ isActive }) {
  const [bars, setBars] = useState(Array(WAVEFORM_BARS).fill(0.1));
  const frameRef = useRef(null);

  useEffect(() => {
    if (!isActive) {
      setBars(Array(WAVEFORM_BARS).fill(0.08));
      return;
    }
    let t = 0;
    const animate = () => {
      t += 0.06;
      setBars(
        Array(WAVEFORM_BARS)
          .fill(0)
          .map((_, i) => {
            const base = Math.sin(t + i * 0.3) * 0.3 + 0.4;
            const pulse = Math.sin(t * 2.1 + i * 0.15) * 0.2;
            const noise = Math.random() * 0.15;
            return Math.max(0.06, Math.min(1, base + pulse + noise));
          })
      );
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [isActive]);

  return (
    <div className="flex items-center justify-center gap-[2px]" style={{ height: 64 }}>
      {bars.map((h, i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-75"
          style={{
            width: 3,
            height: `${h * 64}px`,
            background: isActive
              ? `hsl(${160 + i * 2.5}, 70%, ${50 + h * 20}%)`
              : "#2a3a35",
          }}
        />
      ))}
    </div>
  );
}

function TypewriterText({ text, isActive }) {
  const [displayed, setDisplayed] = useState("");
  const indexRef = useRef(0);

  useEffect(() => {
    if (!isActive) {
      setDisplayed("");
      indexRef.current = 0;
      return;
    }
    indexRef.current = 0;
    setDisplayed("");
    const interval = setInterval(() => {
      if (indexRef.current < text.length) {
        setDisplayed(text.slice(0, indexRef.current + 1));
        indexRef.current++;
      } else {
        clearInterval(interval);
      }
    }, 38);
    return () => clearInterval(interval);
  }, [isActive, text]);

  return (
    <span>
      {displayed}
      {isActive && displayed.length < text.length && (
        <span className="inline-block w-[2px] h-[1.1em] bg-emerald-400 ml-[1px] animate-pulse align-text-bottom" />
      )}
    </span>
  );
}

function FeatureCard({ icon, title, desc }) {
  return (
    <div className="group relative p-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-emerald-500/20 transition-all duration-500">
      <div className="text-3xl mb-4">{icon}</div>
      <h3
        style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}
        className="text-white text-lg mb-2"
      >
        {title}
      </h3>
      <p
        style={{ fontFamily: "'DM Sans', sans-serif" }}
        className="text-white/50 text-sm leading-relaxed"
      >
        {desc}
      </p>
    </div>
  );
}

function PricingCard({ title, price, subtitle, features, isPrimary, badge }) {
  return (
    <div
      className={`relative p-8 rounded-2xl border transition-all duration-500 ${
        isPrimary
          ? "border-emerald-500/30 bg-emerald-500/[0.04] shadow-lg shadow-emerald-500/5"
          : "border-white/[0.06] bg-white/[0.02]"
      }`}
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-emerald-500 text-black text-xs font-bold tracking-wide">
          {badge}
        </div>
      )}
      <h3
        style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}
        className="text-white text-xl mb-1"
      >
        {title}
      </h3>
      <div className="flex items-baseline gap-1 mb-1">
        <span
          style={{ fontFamily: "'DM Mono', monospace" }}
          className="text-4xl text-white font-bold"
        >
          {price}
        </span>
        {subtitle && (
          <span className="text-white/30 text-sm">{subtitle}</span>
        )}
      </div>
      <div className="w-full h-px bg-white/[0.06] my-5" />
      <ul className="space-y-3">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className="text-emerald-400 mt-0.5 shrink-0">
              {f.included ? "✓" : "—"}
            </span>
            <span
              style={{ fontFamily: "'DM Sans', sans-serif" }}
              className={f.included ? "text-white/70" : "text-white/30"}
            >
              {f.text}
            </span>
          </li>
        ))}
      </ul>
      <button
        className={`w-full mt-6 py-3 rounded-xl text-sm font-semibold tracking-wide transition-all duration-300 cursor-pointer ${
          isPrimary
            ? "bg-emerald-500 text-black hover:bg-emerald-400 hover:shadow-lg hover:shadow-emerald-500/20"
            : "bg-white/[0.06] text-white/70 hover:bg-white/[0.1] hover:text-white"
        }`}
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        {isPrimary ? "Buy License — $12" : "Download Free"}
      </button>
    </div>
  );
}

export default function OmWhisperLanding() {
  const [demoActive, setDemoActive] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDemoActive(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const demoText =
    "The quick brown fox jumps over the lazy dog. OmWhisper captures every word with incredible accuracy, right on your device.";

  return (
    <div
      className="min-h-screen text-white overflow-x-hidden"
      style={{
        background: "linear-gradient(165deg, #0a0f0d 0%, #0d1a14 40%, #0a0f0d 100%)",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Instrument+Serif&display=swap"
        rel="stylesheet"
      />

      {/* Ambient glow */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 800px 600px at 50% 0%, rgba(16,185,129,0.06) 0%, transparent 70%)",
          transform: `translateY(${scrollY * 0.15}px)`,
        }}
      />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <OmLogo size={34} />
          <span
            style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}
            className="text-white text-lg tracking-tight"
          >
            OmWhisper
          </span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="#features"
            className="text-white/40 hover:text-white/80 text-sm transition-colors"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Features
          </a>
          <a
            href="#pricing"
            className="text-white/40 hover:text-white/80 text-sm transition-colors"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Pricing
          </a>
          <button
            className="px-5 py-2 rounded-lg bg-emerald-500 text-black text-sm font-semibold hover:bg-emerald-400 transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/20 cursor-pointer"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Download
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-4xl mx-auto px-8 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] mb-8">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span
            style={{ fontFamily: "'DM Mono', monospace" }}
            className="text-emerald-400/80 text-xs tracking-wide"
          >
            100% on-device · No cloud · No subscription
          </span>
        </div>

        <h1 className="mb-6">
          <span
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="block text-6xl md:text-7xl text-white leading-[1.05] tracking-tight"
          >
            Your voice,
          </span>
          <span
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="block text-6xl md:text-7xl leading-[1.05] tracking-tight"
          >
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-teal-400">
              transcribed instantly
            </span>
          </span>
        </h1>

        <p
          style={{ fontFamily: "'DM Sans', sans-serif" }}
          className="text-white/40 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mb-12"
        >
          Speak naturally and watch your words appear in real time. Powered by
          OpenAI Whisper, running entirely on your Mac. Private by design.
        </p>

        <div className="flex items-center justify-center gap-4 mb-20">
          <button
            className="px-8 py-3.5 rounded-xl bg-emerald-500 text-black font-semibold text-sm hover:bg-emerald-400 transition-all duration-300 hover:shadow-xl hover:shadow-emerald-500/20 hover:-translate-y-0.5 cursor-pointer"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Download for macOS
          </button>
          <button
            className="px-8 py-3.5 rounded-xl border border-white/[0.08] text-white/60 font-medium text-sm hover:bg-white/[0.04] hover:text-white/80 transition-all duration-300 cursor-pointer"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            View on GitHub
          </button>
        </div>

        {/* Interactive Demo */}
        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl border border-white/[0.06] bg-[#0d1510] overflow-hidden shadow-2xl shadow-black/40">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.04]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28c840]" />
              </div>
              <span
                style={{ fontFamily: "'DM Mono', monospace" }}
                className="text-white/20 text-xs ml-3"
              >
                OmWhisper — Listening...
              </span>
              <div className="ml-auto flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full transition-colors duration-500 ${
                    demoActive ? "bg-emerald-400 animate-pulse" : "bg-white/10"
                  }`}
                />
                <span
                  style={{ fontFamily: "'DM Mono', monospace" }}
                  className={`text-xs transition-colors duration-500 ${
                    demoActive ? "text-emerald-400/60" : "text-white/10"
                  }`}
                >
                  {demoActive ? "REC" : "OFF"}
                </span>
              </div>
            </div>

            <div className="px-6 pt-5 pb-3">
              <AnimatedWaveform isActive={demoActive} />
            </div>

            <div className="px-6 pb-6">
              <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-5 min-h-[80px]">
                <p
                  style={{ fontFamily: "'DM Sans', sans-serif" }}
                  className="text-white/80 text-sm leading-relaxed"
                >
                  <TypewriterText text={demoText} isActive={demoActive} />
                </p>
              </div>
              <div className="flex items-center justify-between mt-3 px-1">
                <span
                  style={{ fontFamily: "'DM Mono', monospace" }}
                  className="text-white/15 text-xs"
                >
                  model: small.en · latency: ~340ms
                </span>
                <button
                  onClick={() => {
                    setDemoActive(false);
                    setTimeout(() => setDemoActive(true), 400);
                  }}
                  className="text-white/20 hover:text-emerald-400/60 text-xs transition-colors cursor-pointer"
                  style={{ fontFamily: "'DM Mono', monospace" }}
                >
                  ↻ replay
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 max-w-5xl mx-auto px-8 py-24">
        <div className="text-center mb-16">
          <h2
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-4xl md:text-5xl text-white mb-4"
          >
            Built different
          </h2>
          <p
            style={{ fontFamily: "'DM Sans', sans-serif" }}
            className="text-white/35 text-lg"
          >
            Every feature designed around one principle: your voice, your device, your privacy.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FeatureCard icon="🔒" title="Completely Private" desc="Audio never leaves your Mac. No cloud processing, no data collection, no accounts. Powered by on-device AI." />
          <FeatureCard icon="⚡" title="Real-time Speed" desc="See words appear as you speak. Optimized for Apple Silicon with Core ML acceleration. Sub-500ms latency." />
          <FeatureCard icon="🎯" title="Incredible Accuracy" desc="Powered by OpenAI's Whisper models. Choose from tiny (fast) to large (precise) based on your needs." />
          <FeatureCard icon="🌐" title="Works Offline" desc="No internet needed. Models run locally. Perfect for flights, cafes with bad WiFi, or air-gapped environments." />
          <FeatureCard icon="⌨️" title="Paste Anywhere" desc="One hotkey to start dictating. Text appears in whatever app you're focused on — docs, email, Slack, code editors." />
          <FeatureCard icon="🪶" title="Featherlight" desc="~10MB app size. Lives in your menu bar. Uses minimal resources when idle. No Electron bloat." />
        </div>
      </section>

      {/* How it works */}
      <section className="relative z-10 max-w-4xl mx-auto px-8 py-24">
        <div className="text-center mb-16">
          <h2
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-4xl md:text-5xl text-white mb-4"
          >
            Three seconds to start
          </h2>
        </div>

        <div className="flex flex-col md:flex-row gap-8 items-start justify-center">
          {[
            { step: "01", title: "Press the hotkey", desc: "Cmd + Shift + V (customizable) activates listening from anywhere." },
            { step: "02", title: "Speak naturally", desc: "Talk at your normal pace. OmWhisper handles pauses, filler words, and punctuation." },
            { step: "03", title: "Text appears", desc: "Words flow into your focused app in real-time. Release the hotkey when done." },
          ].map((item) => (
            <div key={item.step} className="flex-1 text-center md:text-left">
              <span style={{ fontFamily: "'DM Mono', monospace" }} className="text-emerald-500/40 text-xs tracking-widest">{item.step}</span>
              <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }} className="text-white text-lg mt-2 mb-2">{item.title}</h3>
              <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-white/40 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="relative z-10 max-w-4xl mx-auto px-8 py-24">
        <div className="text-center mb-16">
          <h2 style={{ fontFamily: "'Instrument Serif', serif" }} className="text-4xl md:text-5xl text-white mb-4">Simple, honest pricing</h2>
          <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-white/35 text-lg">No subscriptions. No hidden fees. Pay once, use forever.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <PricingCard
            title="Free"
            price="$0"
            features={[
              { text: "30 minutes / day", included: true },
              { text: "Tiny model only", included: true },
              { text: "Basic transcription", included: true },
              { text: "All models", included: false },
              { text: "Custom vocabulary", included: false },
              { text: "Export & history", included: false },
            ]}
          />
          <PricingCard
            title="Full License"
            price="$12"
            subtitle="one-time"
            badge="BEST VALUE"
            isPrimary
            features={[
              { text: "Unlimited transcription", included: true },
              { text: "All model sizes", included: true },
              { text: "Custom vocabulary", included: true },
              { text: "Export & history", included: true },
              { text: "1 year of updates", included: true },
              { text: "Priority email support", included: true },
            ]}
          />
        </div>

        <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-white/20 text-xs text-center mt-8">
          Future major versions available at 50% discount for existing users. Your app works forever, even without updates.
        </p>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-3xl mx-auto px-8 py-24 text-center">
        <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.03] p-12">
          <OmLogo size={48} glow />
          <h2 style={{ fontFamily: "'Instrument Serif', serif" }} className="text-3xl md:text-4xl text-white mb-4 mt-6">
            Ready to type with your voice?
          </h2>
          <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-white/40 mb-8 text-lg">
            Download OmWhisper and start transcribing in under a minute. Free tier included — no credit card needed.
          </p>
          <button
            className="px-10 py-4 rounded-xl bg-emerald-500 text-black font-bold text-sm hover:bg-emerald-400 transition-all duration-300 hover:shadow-xl hover:shadow-emerald-500/20 hover:-translate-y-0.5 cursor-pointer"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Download for macOS — Free
          </button>
          <p style={{ fontFamily: "'DM Mono', monospace" }} className="text-white/15 text-xs mt-4">
            Requires macOS Sonoma (14.0) or later · Apple Silicon optimized
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] px-8 py-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <OmLogo size={20} />
            <span style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-white/20 text-sm">
              © 2026 OmWhisper. Crafted with reverence.
            </span>
          </div>
          <div className="flex items-center gap-6">
            {["Privacy", "Terms", "GitHub", "Twitter"].map((link) => (
              <a key={link} href="#" style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-white/20 hover:text-white/50 text-sm transition-colors">
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
