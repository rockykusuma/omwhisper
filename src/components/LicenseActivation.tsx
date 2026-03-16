import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onActivated: () => void;
}

export default function LicenseActivation({ onActivated }: Props) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleActivate() {
    if (!key.trim()) return;
    setStatus("checking");
    setErrorMsg("");
    try {
      await invoke("activate_license", { key: key.trim() });
      setStatus("success");
      setTimeout(onActivated, 1200);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("max_activations_reached")) {
        setErrorMsg("This key is already activated on another device. Deactivate it there first.");
      } else if (msg.includes("network_error")) {
        setErrorMsg("Network error. Check your connection and try again.");
      } else {
        setErrorMsg("Invalid license key. Please check and try again.");
      }
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="py-2 text-emerald-400 font-semibold text-sm">
        ✓ License activated! OmWhisper is fully unlocked.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={key}
        onChange={(e) => { setKey(e.target.value); setStatus("idle"); setErrorMsg(""); }}
        placeholder="Enter license key…"
        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-white/80 text-sm placeholder:text-white/35 outline-none focus:border-emerald-500/40 font-mono"
        aria-label="License key"
      />
      {errorMsg && <p className="text-red-400/70 text-xs">{errorMsg}</p>}
      <button
        onClick={handleActivate}
        disabled={status === "checking" || !key.trim()}
        className="btn-primary w-full py-2.5"
      >
        {status === "checking" ? "Activating…" : "Activate License"}
      </button>
      <p className="text-white/40 text-xs text-center">
        Don't have a key?{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            invoke("plugin:opener|open_url", { url: "https://omwhisper.lemonsqueezy.com" }).catch(() => {});
          }}
          className="text-emerald-500/60 hover:text-emerald-400 underline"
        >
          Buy for $12
        </a>
      </p>
    </div>
  );
}
