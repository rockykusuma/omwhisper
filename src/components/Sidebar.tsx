import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Mic, Clock, Box, Settings, BookMarked } from "lucide-react";

export type View = "home" | "history" | "models" | "vocabulary" | "settings";

interface Props {
  activeView: View;
  onNavigate: (view: View) => void;
  appVersion?: string;
}

const NAV_ITEMS: { id: View; icon: React.ElementType; label: string }[] = [
  { id: "home",       icon: Mic,        label: "Transcribe" },
  { id: "history",    icon: Clock,      label: "History"    },
  { id: "models",     icon: Box,        label: "Models"     },
  { id: "vocabulary", icon: BookMarked, label: "Vocabulary" },
  { id: "settings",   icon: Settings,   label: "Settings"   },
];

export default function Sidebar({ activeView, onNavigate, appVersion }: Props) {
  const [usageSeconds, setUsageSeconds] = useState<number | null>(null);
  const [isFreeTier, setIsFreeTier] = useState(false);
  const [isLicensed, setIsLicensed] = useState(false);

  useEffect(() => {
    invoke<{ seconds_used: number; is_free_tier: boolean }>("get_usage_today")
      .then((u) => { setIsFreeTier(u.is_free_tier); setUsageSeconds(u.seconds_used); })
      .catch(() => {});
    invoke<string>("get_license_status")
      .then((s) => setIsLicensed(s === "Licensed" || s === "GracePeriod"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unlisten = listen<{ seconds_used: number; is_free_tier: boolean }>(
      "usage-update",
      (e) => { setUsageSeconds(e.payload.seconds_used); setIsFreeTier(e.payload.is_free_tier); }
    );
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    const unlisten = listen("license-status", () => {
      invoke<string>("get_license_status")
        .then((s) => setIsLicensed(s === "Licensed" || s === "GracePeriod"))
        .catch(() => {});
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const remaining = usageSeconds !== null ? Math.max(0, 1800 - usageSeconds) : null;
  const usagePct = usageSeconds !== null ? Math.min(100, (usageSeconds / 1800) * 100) : 0;

  return (
    <div
      className="w-48 shrink-0 flex flex-col h-full"
      style={{
        background: "var(--bg)",
        boxShadow: "4px 0 16px var(--shadow-dark)",
      }}
    >
      {/* Logo */}
      <div className="px-5 py-5">
        <div
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-2xl"
          style={{ boxShadow: "var(--nm-raised-sm)" }}
        >
          <span className="text-emerald-400 text-[22px] leading-none select-none drop-shadow-[0_0_8px_rgba(52,211,153,0.6)]">ॐ</span>
          <span className="text-white/90 font-semibold text-sm tracking-tight">OmWhisper</span>
          {isLicensed && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full text-emerald-300 font-mono leading-none ml-auto"
              style={{ background: "rgba(52,211,153,0.12)", boxShadow: "var(--nm-pressed-sm)" }}
            >
              PRO
            </span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-1.5" aria-label="Main navigation">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const isActive = activeView === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              aria-current={isActive ? "page" : undefined}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 cursor-pointer text-left"
              style={{
                boxShadow: isActive ? "var(--nm-pressed-sm)" : "var(--nm-raised-sm)",
                color: isActive ? "rgb(52,211,153)" : "rgba(255,255,255,0.55)",
                background: "var(--bg)",
              }}
            >
              <Icon
                size={15}
                strokeWidth={isActive ? 2.25 : 1.75}
                style={{ filter: isActive ? "drop-shadow(0 0 4px rgba(52,211,153,0.5))" : "none" }}
              />
              <span className={isActive ? "font-medium" : ""}>{label}</span>
              {isActive && (
                <span
                  className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400"
                  style={{ boxShadow: "0 0 6px rgba(52,211,153,0.8)" }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 pt-3 space-y-3">
        {isFreeTier && remaining !== null && (
          <div
            className="px-3 py-2.5 rounded-xl"
            style={{ boxShadow: "var(--nm-pressed-sm)" }}
          >
            <div className="flex justify-between text-[10px] text-white/50 mb-2 font-mono">
              <span>Free today</span>
              <span>{Math.floor(remaining / 60)}m {remaining % 60}s</span>
            </div>
            <div
              className="h-1 rounded-full overflow-hidden"
              style={{ boxShadow: "var(--nm-pressed-sm)", background: "var(--bg)" }}
            >
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  usagePct >= 100 ? "bg-red-400" : usagePct >= 83 ? "bg-amber-400" : "bg-emerald-400"
                }`}
                style={{
                  width: `${usagePct}%`,
                  boxShadow: usagePct > 0 ? "0 0 6px rgba(52,211,153,0.6)" : "none",
                }}
              />
            </div>
          </div>
        )}
        {appVersion && (
          <p className="text-white/35 text-[10px] font-mono px-1">v{appVersion}</p>
        )}
      </div>
    </div>
  );
}
