import { Clock, Brain, Settings, BookMarked, House } from "lucide-react";

export type View = "home" | "history" | "models" | "vocabulary" | "settings";

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
          <span
            className="text-[9px] font-mono leading-none mt-0.5 w-fit px-1.5 py-0.5 rounded-full"
            style={{ color: "var(--accent)", background: "var(--accent-bg)", boxShadow: "var(--nm-pressed-sm)" }}
          >
            BETA
          </span>
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
      <div className="px-2 pb-3 pt-2 shrink-0">
        {appVersion && isOpen && (
          <p className="text-[10px] font-mono px-1" style={{ color: "var(--t4)" }}>v{appVersion}</p>
        )}
      </div>
    </div>
  );
}
