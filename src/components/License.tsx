import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CreditCard, CheckCircle2, XCircle } from "lucide-react";

interface LicenseInfo {
  status: string;
  email: string | null;
  activated_on: string | null;
}

export default function LicensePage() {
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [key, setKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function loadInfo() {
    try {
      const data = await invoke<LicenseInfo>("get_license_info");
      setInfo(data);
    } catch {}
  }

  useEffect(() => { loadInfo(); }, []);

  useEffect(() => {
    const unlisten = listen("license-status", () => loadInfo());
    return () => { unlisten.then((f) => f()); };
  }, []);

  async function handleActivate() {
    if (!key.trim()) return;
    setActivating(true);
    setError(null);
    try {
      await invoke("activate_license", { key: key.trim() });
      setKey("");
      showToast("✓ License activated!");
      await loadInfo();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("max_activations_reached")) {
        setError("Already activated on another device. Deactivate it there first.");
      } else if (msg.includes("network_error")) {
        setError("Network error. Check your connection and try again.");
      } else {
        setError("Invalid license key.");
      }
    } finally {
      setActivating(false);
    }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    try {
      await invoke("deactivate_license");
      showToast("Deactivated. You can now activate on another device.");
      await loadInfo();
    } catch {
      showToast("Deactivation failed.");
    } finally {
      setDeactivating(false);
    }
  }

  const isActive = info?.status === "Licensed" || info?.status === "GracePeriod";

  return (
    <div className="w-full max-w-lg mx-auto px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ width: 40, height: 40, background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
        >
          <CreditCard size={18} style={{ color: "var(--accent)" }} />
        </div>
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--t1)" }}>License</h2>
          <p className="text-xs" style={{ color: "var(--t3)" }}>Manage your OmWhisper activation</p>
        </div>
      </div>

      {/* Status card */}
      <div className="card p-5 mb-4">
        {isActive ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} style={{ color: "var(--accent)" }} />
                <span className="font-semibold text-sm" style={{ color: "var(--accent)" }}>
                  {info?.status === "GracePeriod" ? "Licensed (grace period)" : "Licensed"}
                </span>
              </div>
              <button
                onClick={handleDeactivate}
                disabled={deactivating}
                className="text-xs transition-colors cursor-pointer disabled:opacity-50"
                style={{ color: "var(--t3)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "rgba(248,113,113,0.8)")}
                onMouseLeave={e => (e.currentTarget.style.color = "var(--t3)")}
              >
                {deactivating ? "Deactivating…" : "Deactivate"}
              </button>
            </div>
            {info?.email && (
              <p className="text-xs font-mono" style={{ color: "var(--t2)" }}>{info.email}</p>
            )}
            {info?.activated_on && (
              <p className="text-xs font-mono" style={{ color: "var(--t3)" }}>
                Activated {new Date(info.activated_on).toLocaleDateString()}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <XCircle size={16} style={{ color: "var(--t3)" }} />
              <span className="text-sm" style={{ color: "var(--t2)" }}>
                {info?.status === "Expired"
                  ? "License expired — please re-validate or buy a new key."
                  : "Free tier · 30 min/day · tiny.en only"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Activation form — only when not active */}
      {!isActive && (
        <div className="card p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest font-mono" style={{ color: "var(--t3)" }}>
            Activate License
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={key}
              onChange={(e) => { setKey(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleActivate()}
              placeholder="Enter license key…"
              className="flex-1 rounded-xl px-3 py-2 text-sm placeholder:text-white/25 outline-none font-mono"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)", color: "var(--t1)" }}
              aria-label="License key"
            />
            <button
              onClick={handleActivate}
              disabled={activating || !key.trim()}
              className="btn-primary shrink-0"
            >
              {activating ? "…" : "Activate"}
            </button>
          </div>
          {error && <p className="text-red-400/70 text-xs">{error}</p>}
          <p className="text-xs" style={{ color: "var(--t4)" }}>
            Don't have a key?{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                invoke("plugin:opener|open_url", { url: "https://omwhisper.lemonsqueezy.com" }).catch(() => {});
              }}
              className="underline transition-colors"
              style={{ color: "var(--accent)" }}
            >
              Buy OmWhisper for $12
            </a>
          </p>
        </div>
      )}

      {toast && (
        <p className="text-xs font-mono mt-3" style={{ color: "var(--accent)" }}>{toast}</p>
      )}

      {/* Feature comparison */}
      <div className="mt-6 card p-5">
        <p className="text-xs font-semibold uppercase tracking-widest font-mono mb-3" style={{ color: "var(--t3)" }}>
          What's included
        </p>
        {[
          { label: "Unlimited transcription",     free: false, pro: true  },
          { label: "All Whisper models",           free: false, pro: true  },
          { label: "AI polish & translation",      free: false, pro: true  },
          { label: "Export history",               free: false, pro: true  },
          { label: "30 min/day with tiny.en",      free: true,  pro: true  },
        ].map(({ label, free, pro }) => (
          <div
            key={label}
            className="flex items-center justify-between py-2"
            style={{ borderBottom: "1px solid color-mix(in srgb, var(--t1) 5%, transparent)" }}
          >
            <span className="text-xs" style={{ color: "var(--t2)" }}>{label}</span>
            <div className="flex gap-6">
              <span className="text-xs w-8 text-center font-mono" style={{ color: free ? "var(--t2)" : "var(--t4)" }}>
                {free ? "✓" : "—"}
              </span>
              <span className="text-xs w-8 text-center font-mono" style={{ color: "var(--accent)" }}>
                {pro ? "✓" : "—"}
              </span>
            </div>
          </div>
        ))}
        <div className="flex justify-end gap-6 mt-2 pt-1">
          <span className="text-[10px] w-8 text-center font-mono" style={{ color: "var(--t3)" }}>Free</span>
          <span className="text-[10px] w-8 text-center font-mono" style={{ color: "var(--accent)" }}>Pro</span>
        </div>
      </div>
    </div>
  );
}
