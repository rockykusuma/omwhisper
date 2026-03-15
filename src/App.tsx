import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import Sidebar, { type View } from "./components/Sidebar";
import TranscriptionView from "./components/TranscriptionView";
import ModelManager from "./components/ModelManager";
import SettingsPanel from "./components/Settings";
import Onboarding from "./components/Onboarding";
import TranscriptionHistory from "./components/TranscriptionHistory";
import Vocabulary from "./components/Vocabulary";
import { logger } from "./utils/logger";
import type { UpdateInfo } from "./types";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isSmartDictation, setIsSmartDictation] = useState(false);
  const [activeView, setActiveView] = useState<View>("home");
  const [activeModel, setActiveModel] = useState("tiny.en");
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [runningFromDmg, setRunningFromDmg] = useState(false);
  const [appVersion, setAppVersion] = useState("0.1.0");

  const modelPath = `models/ggml-${activeModel}.bin`;

  useEffect(() => {
    invoke<boolean>("is_first_launch").then(setShowOnboarding);
    invoke<boolean>("is_running_from_dmg").then(setRunningFromDmg).catch(() => {});
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    const startRecording = async (smartDictation = false) => {
      try {
        // capture_focused_app is now called in Rust shortcut handler before window activation
        await invoke("start_transcription", { model: modelPath });
        setIsRecording(true);
        setIsSmartDictation(smartDictation);
        try {
          const settings = await invoke<{ show_overlay: boolean }>("get_settings");
          if (settings.show_overlay) await invoke("show_overlay");
        } catch {}
      } catch (e) {
        logger.error("Failed to start transcription:", e);
      }
    };

    const unlistenHotkey = listen("hotkey-toggle-recording", () => startRecording(false));
    const unlistenSmartDictation = listen("hotkey-smart-dictation", async () => {
      const settings = await invoke<{ ai_backend: string }>("get_settings").catch(() => ({ ai_backend: "disabled" }));
      if (settings.ai_backend === "disabled") {
        setMicError("Smart Dictation needs AI setup. Open Settings → AI Processing.");
        setTimeout(() => setMicError(null), 5000);
        return;
      }
      startRecording(true);
    });

    const unlistenState = listen<boolean>("recording-state", (event) => {
      setIsRecording(event.payload);
      if (!event.payload) {
        setTimeout(() => invoke("hide_overlay").catch((e) => logger.debug("hide_overlay:", e)), 1500);
        // Reset smart dictation flag when recording stops externally (e.g. usage limit)
        setIsSmartDictation(false);
      }
    });

    const unlistenUpdate = listen<UpdateInfo>("update-available", (event) => {
      setUpdateInfo(event.payload);
    });

    const unlistenMic = listen<string>("transcription-error", (event) => {
      setMicError(event.payload);
      setTimeout(() => setMicError(null), 5000);
    });

    return () => {
      Promise.all([unlistenHotkey, unlistenSmartDictation, unlistenState, unlistenUpdate, unlistenMic])
        .then((fns) => fns.forEach((f) => f()));
    };
  }, [modelPath]);

  // Unknown state — blank screen while checking
  if (showOnboarding === null) {
    return <div className="min-h-screen" style={{ background: "var(--bg)" }} />;
  }

  // First launch — show onboarding
  if (showOnboarding === true) {
    return <Onboarding onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <div className="flex h-screen text-white overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        appVersion={appVersion}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Banners */}
        {runningFromDmg && (
          <div className="flex items-center justify-between px-5 py-2 shrink-0" style={{ background: "rgba(245,158,11,0.07)", boxShadow: "0 2px 8px var(--shadow-dark)" }}>
            <span className="text-amber-400 text-xs">
              You're running OmWhisper from the disk image. Drag it to Applications first.
            </span>
            <button
              onClick={() => setRunningFromDmg(false)}
              className="text-white/50 hover:text-white/60 text-xs cursor-pointer ml-4 shrink-0"
              aria-label="Dismiss disk image warning"
            >
              ✕
            </button>
          </div>
        )}

        {updateInfo && (
          <div className="flex items-center justify-between px-5 py-2 shrink-0" style={{ background: "rgba(52,211,153,0.07)", boxShadow: "0 2px 8px var(--shadow-dark)" }}>
            <span className="text-emerald-400 text-xs">
              OmWhisper v{updateInfo.latest} is available — {updateInfo.release_notes}
            </span>
            <div className="flex items-center gap-3 shrink-0">
              <a
                href={updateInfo.download_url}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 text-xs underline hover:text-emerald-300"
              >
                Download
              </a>
              <button
                onClick={() => setUpdateInfo(null)}
                className="text-white/50 hover:text-white/60 text-xs cursor-pointer"
                aria-label="Dismiss update notification"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Mic error toast */}
        {micError && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-red-400/80 text-xs font-mono pointer-events-none" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}>
            {micError}
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {activeView === "home" && (
            <TranscriptionView
              externalIsRecording={isRecording}
              onRecordingChange={(v) => { setIsRecording(v); if (!v) setIsSmartDictation(false); }}
              activeModel={activeModel}
              isSmartDictation={isSmartDictation}
            />
          )}
          {activeView === "models" && (
            <ModelManager
              activeModel={activeModel}
              onModelChange={(name) => {
                setActiveModel(name);
                setActiveView("home");
              }}
            />
          )}
          {activeView === "settings" && <SettingsPanel />}
          {activeView === "history" && <TranscriptionHistory />}
          {activeView === "vocabulary" && <Vocabulary />}
        </div>
      </div>
    </div>
  );
}

export default App;
