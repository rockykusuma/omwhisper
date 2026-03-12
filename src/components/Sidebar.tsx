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

  // Also refresh license status when license-status event fires
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
    <div className="w-48 shrink-0 flex flex-col h-full bg-[#080d0b] border-r border-white/[0.05]">

      {/* Logo */}
      <div className="px-4 py-5 border-b border-white/[0.05]">
        <div className="flex items-center gap-2">
          <span className="text-emerald-400 text-[22px] leading-none select-none">ॐ</span>
          <span className="text-white/85 font-semibold text-sm tracking-tight">OmWhisper</span>
          {isLicensed && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono leading-none">
              PRO
            </span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5" aria-label="Main navigation">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const isActive = activeView === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              aria-current={isActive ? "page" : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 cursor-pointer text-left ${
                isActive
                  ? "bg-emerald-500/10 text-emerald-400 border-l-[3px] border-emerald-500 pl-[9px]"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border-l-[3px] border-transparent"
              }`}
            >
              <Icon size={15} strokeWidth={isActive ? 2 : 1.75} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 pt-3 border-t border-white/[0.05] space-y-2.5">
        {isFreeTier && remaining !== null && (
          <div>
            <div className="flex justify-between text-[10px] text-white/25 mb-1 font-mono">
              <span>Free today</span>
              <span>{Math.floor(remaining / 60)}m {remaining % 60}s left</span>
            </div>
            <div className="h-0.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  usagePct >= 100 ? "bg-red-500" : usagePct >= 83 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          </div>
        )}
        {appVersion && (
          <p className="text-white/15 text-[10px] font-mono">v{appVersion}</p>
        )}
      </div>
    </div>
  );
}
