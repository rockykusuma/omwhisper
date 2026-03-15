import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Mic, Clock, Flame, Hash, Cpu, ChevronRight } from "lucide-react";
import { logger } from "../utils/logger";
import type { UsageStats } from "../types";

interface Props {
  activeModel?: string;
  onNavigate?: (view: string) => void;
}

export default function HomeView({ activeModel = "tiny.en", onNavigate }: Props) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [micName, setMicName] = useState<string>("Default Microphone");

  const loadStats = useCallback(async () => {
    const [s, settings] = await Promise.all([
      invoke<UsageStats>("get_usage_stats").catch(() => null),
      invoke<{ audio_input_device: string | null }>("get_settings").catch(() => null),
    ]);
    setStats(s);
    if (settings?.audio_input_device) setMicName(settings.audio_input_device);
    else setMicName("Default Microphone");
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    const unlisten = listen("settings-changed", () => loadStats());
    return () => { unlisten.then((f) => f()); };
  }, [loadStats]);

  const showStats = stats && stats.total_recordings > 0;

  return (
    <div className="flex flex-col h-full px-8 py-6">
      {/* Stats grid */}
      {showStats ? (
        <div className="grid grid-cols-4 gap-2.5 mb-5">
          <div className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-2" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}>
            <Mic size={14} style={{ color: "var(--accent)" }} strokeWidth={2} />
            <span className="text-xl font-bold font-mono tabular-nums leading-none" style={{ color: "var(--t1)" }}>
              {stats.total_recordings >= 1000 ? `${(stats.total_recordings / 1000).toFixed(1)}k` : stats.total_recordings}
            </span>
            <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--t4)" }}>Recordings</span>
          </div>
          <div className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-2" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}>
            <Clock size={14} style={{ color: "var(--accent)" }} strokeWidth={2} />
            <span className="text-xl font-bold font-mono tabular-nums leading-none" style={{ color: "var(--t1)" }}>
              {(() => {
                const h = Math.floor(stats.total_duration_seconds / 3600);
                const m = Math.floor((stats.total_duration_seconds % 3600) / 60);
                if (h > 0) return `${h}h`;
                if (m > 0) return `${m}m`;
                return `${Math.round(stats.total_duration_seconds)}s`;
              })()}
            </span>
            <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--t4)" }}>Time</span>
          </div>
          <div className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-2" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}>
            <Hash size={14} style={{ color: "var(--accent)" }} strokeWidth={2} />
            <span className="text-xl font-bold font-mono tabular-nums leading-none" style={{ color: "var(--t1)" }}>
              {stats.total_words >= 1000 ? `${(stats.total_words / 1000).toFixed(1)}k` : stats.total_words}
            </span>
            <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--t4)" }}>Words</span>
          </div>
          <div className="flex flex-col items-center gap-1.5 rounded-2xl py-3 px-2" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}>
            <Flame size={14} strokeWidth={2} style={{ color: stats.streak_days > 1 ? "#f59e0b" : "var(--accent)" }} />
            <span className="text-xl font-bold font-mono tabular-nums leading-none" style={{ color: stats.streak_days > 1 ? "#f59e0b" : "var(--t1)" }}>
              {stats.streak_days > 1 ? stats.streak_days : stats.recordings_today}
            </span>
            <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--t4)" }}>
              {stats.streak_days > 1 ? "Streak" : "Today"}
            </span>
          </div>
        </div>
      ) : (
        <div className="mb-5" />
      )}

      {/* Keyboard shortcuts */}
      <div className="mb-4">
        <p className="text-[10px] font-mono uppercase tracking-widest mb-2 px-1" style={{ color: "var(--t4)" }}>Shortcuts</p>
        <div className="rounded-2xl px-4 py-3 space-y-2.5" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--t2)" }}>Dictate in any app</span>
            <div className="flex items-center gap-1">
              {["⌘", "⇧", "V"].map((k) => (
                <kbd key={k} className="inline-flex items-center justify-center text-[11px] font-mono rounded-md px-1.5 py-0.5 min-w-[22px]"
                  style={{ background: "var(--bg)", color: "var(--accent)", boxShadow: "var(--nm-raised-sm)", lineHeight: 1.4 }}>
                  {k}
                </kbd>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--t2)" }}>
              Smart Dictation <span className="text-[10px]" style={{ color: "var(--t4)" }}>(AI polish)</span>
            </span>
            <div className="flex items-center gap-1">
              {["⌘", "⇧", "B"].map((k) => (
                <kbd key={k} className="inline-flex items-center justify-center text-[11px] font-mono rounded-md px-1.5 py-0.5 min-w-[22px]"
                  style={{ background: "var(--bg)", color: "var(--t3)", boxShadow: "var(--nm-raised-sm)", lineHeight: 1.4 }}>
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Active setup */}
      <div className="mb-5">
        <p className="text-[10px] font-mono uppercase tracking-widest mb-2 px-1" style={{ color: "var(--t4)" }}>Active Setup</p>
        <div className="rounded-2xl overflow-hidden flex" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}>
          <button
            onClick={() => onNavigate?.("settings:audio")}
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
            onClick={() => onNavigate?.("models")}
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
      </div>

      {/* What's New */}
      <div className="mt-auto">
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 5%, transparent)" }}>
            <span className="text-xs font-semibold tracking-tight" style={{ color: "var(--t1)" }}>What's New</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ background: "linear-gradient(135deg, var(--accent-grad-from), var(--accent-grad-to))", color: "#0a1a12", fontWeight: 600 }}>
              v0.1.0
            </span>
          </div>
          <ul className="px-4 py-3 space-y-2.5">
            {[
              { label: "Multilingual models", detail: "tiny · base · small · medium · large-v2/v3" },
              { label: "Large-v3-turbo", detail: "Best accuracy at half the size" },
              { label: "Smart Dictation", detail: "AI polishing via Ollama or cloud LLMs" },
              { label: "Push-to-talk & clipboard restore", detail: "Settings → General" },
              { label: "Custom vocabulary + mic selector", detail: "In-app & menu bar" },
            ].map(({ label, detail }) => (
              <li key={label} className="flex items-start gap-2.5">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--accent)", opacity: 0.7 }} />
                <span className="text-[11.5px] leading-snug" style={{ color: "var(--t2)" }}>
                  {label}
                  <span className="ml-1.5 text-[10.5px]" style={{ color: "var(--t4)" }}>{detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
