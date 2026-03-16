import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Clock, Brain, Settings, BookMarked, Sparkles, House } from "lucide-react";

export type View = "home" | "history" | "models" | "vocabulary" | "license" | "settings";

interface Props {
  activeView: View;
  onNavigate: (view: View) => void;
  appVersion?: string;
  isOpen: boolean;
  onToggle: () => void;
}

const NAV_ITEMS: { id: View; icon: React.ElementType; label: string }[] = [
  { id: "home",       icon: House,      label: "Home"       },
  { id: "history",    icon: Clock,      label: "History"    },
  { id: "models",     icon: Brain,      label: "AI Models"  },
  { id: "vocabulary", icon: BookMarked, label: "Vocabulary" },
  { id: "settings",   icon: Settings,   label: "Settings"   },
];

export default function Sidebar({ activeView, onNavigate, appVersion, isOpen, onToggle }: Props) {
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
      className="shrink-0 flex flex-col h-full relative overflow-hidden"
      style={{
        width: isOpen ? 192 : 56,
        transition: "width 220ms cubic-bezier(0.4, 0, 0.2, 1)",
        background: "var(--bg)",
        boxShadow: "4px 0 16px var(--shadow-dark)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center shrink-0"
        style={{
          padding: isOpen ? "18px 8px 18px 16px" : "18px 6px",
          transition: "padding 220ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* ॐ mark — click to toggle sidebar */}
        <div
          onClick={onToggle}
          title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
          className="shrink-0 flex items-center justify-center rounded-[14px] cursor-pointer transition-all duration-150"
          style={{
            width: 44,
            height: 44,
            background: "var(--bg)",
            boxShadow: "5px 5px 10px var(--shadow-dark), -5px -5px 10px var(--shadow-light)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "var(--nm-pressed-sm)")}
          onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "5px 5px 10px var(--shadow-dark), -5px -5px 10px var(--shadow-light)")}
        >
          <img
            src="/app-icon.png"
            alt="OmWhisper"
            draggable={false}
            style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }}
          />
        </div>

        {/* App name — fades out when collapsed */}
        <div
          className="flex flex-col min-w-0 ml-3"
          style={{
            opacity: isOpen ? 1 : 0,
            width: isOpen ? "auto" : 0,
            overflow: "hidden",
            transition: "opacity 180ms ease, width 220ms cubic-bezier(0.4, 0, 0.2, 1)",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          <span className="font-semibold text-sm tracking-tight leading-tight" style={{ color: "var(--t1)" }}>
            Whisper
          </span>
          {isLicensed && (
            <span
              className="text-[9px] font-mono leading-none mt-0.5 w-fit px-1.5 py-0.5 rounded-full"
              style={{ color: "var(--accent)", background: "var(--accent-bg)", boxShadow: "var(--nm-pressed-sm)" }}
            >
              PRO
            </span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 space-y-1.5 overflow-hidden" aria-label="Main navigation">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const isActive = activeView === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              aria-current={isActive ? "page" : undefined}
              title={!isOpen ? label : undefined}
              className="w-full flex items-center rounded-xl text-sm transition-all duration-200 cursor-pointer"
              style={{
                gap: isOpen ? 10 : 0,
                padding: isOpen ? "10px 12px" : "10px 0",
                justifyContent: isOpen ? "flex-start" : "center",
                boxShadow: isActive ? "var(--nm-pressed-sm)" : "var(--nm-raised-sm)",
                color: isActive ? "var(--accent)" : "var(--t2)",
                background: "var(--bg)",
                transition: "box-shadow 150ms, color 150ms, padding 220ms cubic-bezier(0.4, 0, 0.2, 1), gap 220ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <Icon
                size={15}
                strokeWidth={isActive ? 2.25 : 1.75}
                style={{ filter: isActive ? "drop-shadow(0 0 4px var(--accent-glow))" : "none", flexShrink: 0 }}
              />

              {/* Label — fades out */}
              <span
                style={{
                  opacity: isOpen ? 1 : 0,
                  width: isOpen ? "auto" : 0,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  fontWeight: isActive ? 500 : 400,
                  transition: "opacity 160ms ease, width 220ms cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {label}
              </span>

              {/* Active dot */}
              {isActive && isOpen && (
                <span
                  className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: "var(--accent)", boxShadow: "0 0 6px var(--accent-glow)" }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 pb-3 pt-2 space-y-2 shrink-0">
        {/* Free tier: usage bar + upgrade CTA */}
        {isFreeTier && remaining !== null && (
          <div
            className="rounded-xl overflow-hidden cursor-pointer transition-all duration-150"
            style={{ boxShadow: "var(--nm-pressed-sm)" }}
            onClick={() => onNavigate("license")}
            title={!isOpen ? "Upgrade to Pro" : undefined}
          >
            {isOpen ? (
              <div className="px-3 py-2.5">
                <span className="text-[10px] mb-2 font-mono block" style={{ color: "var(--t2)" }}>
                  {Math.floor(remaining / 60)}m {remaining % 60}s left · resets at midnight
                </span>
                <div className="h-1 rounded-full overflow-hidden mb-2.5" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}>
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      usagePct >= 100 ? "bg-red-400" : usagePct >= 83 ? "bg-amber-400" : "bg-emerald-400"
                    }`}
                    style={{ width: `${usagePct}%`, boxShadow: usagePct > 0 ? "0 0 6px var(--accent-glow)" : "none" }}
                  />
                </div>
                {/* Upgrade CTA — only shown in free tier */}
                <div
                  className="flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-all duration-150"
                  style={{
                    background: "var(--accent-bg)",
                    border: "1px solid var(--accent-glow-weak)",
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={10} style={{ color: "var(--accent)" }} />
                    <span className="text-[10px] font-semibold" style={{ color: "var(--accent)" }}>
                      Upgrade to Pro
                    </span>
                  </div>
                  <span style={{ color: "var(--accent)", fontSize: 10 }}>→</span>
                </div>
              </div>
            ) : (
              /* Collapsed: just a glowing sparkle icon button */
              <div
                className="flex items-center justify-center py-2.5"
                title="Upgrade to Pro"
              >
                <Sparkles size={14} style={{ color: "var(--accent)" }} />
              </div>
            )}
          </div>
        )}

        {/* Licensed: compact manage link */}
        {isLicensed && (
          <button
            onClick={() => onNavigate("license")}
            title={!isOpen ? "License" : undefined}
            className="w-full flex items-center rounded-xl px-3 py-2 cursor-pointer transition-all duration-150"
            style={{
              gap: isOpen ? 8 : 0,
              justifyContent: isOpen ? "flex-start" : "center",
              color: "var(--t3)",
              background: "var(--bg)",
              boxShadow: activeView === "license" ? "var(--nm-pressed-sm)" : "none",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t3)")}
          >
            <Sparkles size={12} style={{ flexShrink: 0 }} />
            {isOpen && (
              <span className="text-[10px] font-mono" style={{ whiteSpace: "nowrap" }}>
                Pro · Manage
              </span>
            )}
          </button>
        )}

        {appVersion && isOpen && (
          <p className="text-[10px] font-mono px-1" style={{ color: "var(--t4)" }}>v{appVersion}</p>
        )}
      </div>
    </div>
  );
}
