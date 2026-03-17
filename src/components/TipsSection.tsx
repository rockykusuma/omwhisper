import { ChevronRight } from "lucide-react";

interface Tip {
  icon: string;        // emoji, rendered as <span> — not a lucide icon
  headline: string;
  description: string;
  target: string;      // passed verbatim to onNavigate()
}

const TIPS: Tip[] = [
  {
    icon: "⚡",
    headline: "Speed vs accuracy",
    description: "tiny.en is fastest — try small or large-v3-turbo for longer or technical dictations",
    target: "models:whisper",
  },
  {
    icon: "🌐",
    headline: "Multilingual",
    description: "Switch to a non-.en model to transcribe any language, or translate it to English live",
    target: "settings:transcription",
  },
  {
    icon: "✨",
    headline: "Smart Dictation",
    description: "⌘⇧B sends your voice through AI — cleans grammar, writes emails, formats meeting notes",
    target: "models:smart-dictation",
  },
  {
    icon: "📖",
    headline: "Custom Vocabulary",
    description: "Whisper keeps mishearing a word? Add it once and it'll always get it right",
    target: "vocabulary",
  },
  {
    icon: "🔁",
    headline: "Word Replacements",
    description: "Auto-swap phrases after transcription — remove filler words or fix recurring mistakes",
    target: "vocabulary",
  },
  {
    icon: "🎯",
    headline: "Push-to-Talk",
    description: "Hold a key to record, release to stop — faster than toggle mode for quick dictations",
    target: "settings:general",
  },
  {
    icon: "📋",
    headline: "History & Export",
    description: "Every transcription is saved and searchable. Export as text, markdown, or JSON",
    target: "history",
  },
];

interface TipsSectionProps {
  onNavigate: (view: string) => void;
}

export default function TipsSection({ onNavigate }: TipsSectionProps) {
  return (
    <div
      className="rounded-2xl overflow-hidden flex-shrink-0"
      style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
    >
      {TIPS.map((tip, i) => (
        <div key={tip.headline}>
          <button
            onClick={() => onNavigate(tip.target)}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 cursor-pointer"
            style={{ background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--t1) 4%, transparent)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span className="text-sm shrink-0">{tip.icon}</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold" style={{ color: "var(--t2)" }}>
                {tip.headline}
              </span>
              <span className="text-xs" style={{ color: "var(--t3)" }}>
                {" — "}
                {tip.description}
              </span>
            </div>
            <ChevronRight size={11} className="shrink-0" style={{ color: "var(--t4)" }} />
          </button>
          {i < TIPS.length - 1 && (
            <div
              data-testid="tip-divider"
              className="mx-4"
              style={{ height: "1px", background: "color-mix(in srgb, var(--t1) 6%, transparent)" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
