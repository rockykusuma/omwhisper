import { useEffect, useState, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import Sidebar, { type View } from "./components/Sidebar";
import HomeView from "./components/HomeView";
import AiModelsView from "./components/AiModelsView";
import SettingsPanel from "./components/Settings";
import Onboarding from "./components/Onboarding";
import TranscriptionHistory from "./components/TranscriptionHistory";
import Vocabulary from "./components/Vocabulary";
import LicensePage from "./components/License";
import LicenseActivation from "./components/LicenseActivation";
import { logger } from "./utils/logger";
import { initTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import type { UpdateInfo, TranscriptionSegment } from "./types";

// Apply saved theme before first render
initTheme();

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isSmartDictation, setIsSmartDictation] = useState(false);
  const [activeView, setActiveView] = useState<View>("home");
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  const [activeModel, setActiveModel] = useState("tiny.en");
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [runningFromDmg, setRunningFromDmg] = useState(false);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem("omwhisper-sidebar") !== "closed";
  });
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const { toast, showToast } = useToast();

  // ── Paste machinery (always-active, view-independent) ──────────────────
  const isRecordingRef = useRef(false);
  const segmentsRef = useRef<TranscriptionSegment[]>([]);
  const recordingStartRef = useRef<number>(0);
  const isPendingPaste = useRef(false);
  const pendingIsSmartDictation = useRef(false);
  const hasPasted = useRef(false);
  const isSmartDictationRef = useRef(false);
  const activeModelRef = useRef(activeModel);
  const modelPathRef = useRef(`models/ggml-${activeModel}.bin`);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isSmartDictationRef.current = isSmartDictation; }, [isSmartDictation]);
  useEffect(() => {
    activeModelRef.current = activeModel;
    modelPathRef.current = `models/ggml-${activeModel}.bin`;
  }, [activeModel]);

  const navigate = (target: string) => {
    const [view, tab] = target.split(":");
    setActiveView(view as View);
    setSettingsInitialTab(tab);
  };

  // ── Centralised start / stop ────────────────────────────────────────────
  const startRecording = useCallback(async (smartDictation = false) => {
    recordingStartRef.current = Date.now();
    segmentsRef.current = [];
    hasPasted.current = false;
    try {
      await invoke("capture_focused_app");
      await invoke("start_transcription", { model: modelPathRef.current });
      setIsRecording(true);
      setIsSmartDictation(smartDictation);
      try {
        const settings = await invoke<{ show_overlay: boolean }>("get_settings");
        if (settings.show_overlay) await invoke("show_overlay");
      } catch {}
    } catch (e) {
      logger.error("Failed to start transcription:", e);
      setMicError(String(e));
      setTimeout(() => setMicError(null), 5000);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    pendingIsSmartDictation.current = isSmartDictationRef.current;
    isPendingPaste.current = true;
    try {
      await invoke("stop_transcription");
    } catch (e) {
      logger.error("Failed to stop transcription:", e);
      isPendingPaste.current = false;
    } finally {
      setIsRecording(false);
      setIsSmartDictation(false);
      setTimeout(() => invoke("hide_overlay").catch((e) => logger.debug("hide_overlay:", e)), 1500);
    }
  }, []);

  useEffect(() => {
    invoke<boolean>("is_first_launch").then(setShowOnboarding);
    invoke<boolean>("is_running_from_dmg").then(setRunningFromDmg).catch(() => {});
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
    invoke<{ active_model: string }>("get_settings")
      .then((s) => { if (s.active_model) setActiveModel(s.active_model); })
      .catch(() => {});
  }, []);

  // ── Hotkeys + recording-state ───────────────────────────────────────────
  useEffect(() => {
    // Rust emits "hotkey-toggle-recording" when NOT recording, "hotkey-stop-recording" when IS recording
    const unlistenHotkey = listen("hotkey-toggle-recording", () => startRecording(false));
    const unlistenHotkeyStop = listen("hotkey-stop-recording", () => stopRecording());

    const unlistenSmartDictation = listen("hotkey-smart-dictation", async () => {
      if (isRecordingRef.current) { stopRecording(); return; }
      const settings = await invoke<{ ai_backend: string }>("get_settings").catch(() => ({ ai_backend: "disabled" }));
      if (settings.ai_backend === "disabled") {
        setMicError("Smart Dictation needs AI setup. Open Settings → AI Processing.");
        setTimeout(() => setMicError(null), 5000);
        return;
      }
      startRecording(true);
    });

    // Rust signals forced stop (usage limit, etc.)
    const unlistenState = listen<boolean>("recording-state", (event) => {
      if (!event.payload) {
        pendingIsSmartDictation.current = isSmartDictationRef.current;
        isPendingPaste.current = true;
        setTimeout(() => invoke("hide_overlay").catch((e) => logger.debug("hide_overlay:", e)), 1500);
        setIsRecording(false);
        setIsSmartDictation(false);
      }
    });

    const unlistenUpdate = listen<UpdateInfo>("update-available", (event) => setUpdateInfo(event.payload));

    const unlistenMic = listen<string>("transcription-error", (event) => {
      setMicError(event.payload);
      setTimeout(() => setMicError(null), 5000);
    });

    const unlistenTrayNav = listen<string>("tray-navigate", (event) => {
      const view = event.payload === "transcribe" ? "home" : event.payload;
      setActiveView(view as View);
    });

    return () => {
      Promise.all([unlistenHotkey, unlistenHotkeyStop, unlistenSmartDictation, unlistenState, unlistenUpdate, unlistenMic, unlistenTrayNav])
        .then((fns) => fns.forEach((f) => f()));
    };
  }, [startRecording, stopRecording]);

  // ── Collect segments for paste ──────────────────────────────────────────
  useEffect(() => {
    const unlisten = listen<{ segments: TranscriptionSegment[] }>("transcription-update", (event) => {
      segmentsRef.current = [...segmentsRef.current, ...event.payload.segments];
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // ── Paste on transcription complete ────────────────────────────────────
  useEffect(() => {
    const unlisten = listen("transcription-complete", () => {
      if (!isPendingPaste.current) return;
      isPendingPaste.current = false;
      if (hasPasted.current) return;
      hasPasted.current = true;

      const smartDictation = pendingIsSmartDictation.current;
      const rawText = segmentsRef.current.map((s) => s.text).join(" ").trim();
      if (!rawText) return;

      const durationSeconds = (Date.now() - recordingStartRef.current) / 1000;
      const modelUsed = activeModelRef.current;

      if (smartDictation) {
        (async () => {
          try {
            const settings = await invoke<{ active_polish_style: string }>("get_settings");
            const style = settings.active_polish_style ?? "professional";
            const polished = await invoke<string>("polish_text_cmd", { text: rawText, style });
            await invoke("paste_transcription", { text: polished });
            showToast("✓ AI-polished & copied");
            invoke("save_transcription", { text: polished, durationSeconds, modelUsed, source: "smart_dictation", rawText, polishStyle: style })
              .catch((e) => logger.error("save_transcription failed:", e));
          } catch (e) {
            showToast("⚠ AI polish failed — pasting raw text");
            invoke("paste_transcription", { text: rawText }).catch(() => {});
            invoke("save_transcription", { text: rawText, durationSeconds, modelUsed }).catch(() => {});
            logger.error("Smart dictation polish failed:", e);
          }
        })();
      } else {
        invoke<void>("paste_transcription", { text: rawText })
          .then(() => showToast("✓ Copied to clipboard"))
          .catch((e) => logger.error("paste_transcription failed:", e));
        invoke("save_transcription", { text: rawText, durationSeconds, modelUsed })
          .catch((e) => logger.error("save_transcription failed:", e));
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Usage limit ─────────────────────────────────────────────────────────
  useEffect(() => {
    const unlisten = listen("usage-limit-reached", async () => {
      try { await invoke("stop_transcription"); } catch {}
      setIsRecording(false);
      setIsSmartDictation(false);
      setTimeout(() => invoke("hide_overlay").catch((e) => logger.debug("hide_overlay:", e)), 500);
      setShowUpgradePrompt(true);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  if (showOnboarding === null) {
    return <div className="min-h-screen" style={{ background: "var(--bg)" }} />;
  }

  if (showOnboarding === true) {
    return <Onboarding onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <div
        data-tauri-drag-region
        className="w-full shrink-0"
        style={{ height: 28, cursor: "grab", userSelect: "none" }}
      />

      <div className="flex flex-1 overflow-hidden" style={{ color: "var(--t1)" }}>
        <Sidebar
          activeView={activeView}
          onNavigate={(v) => { setActiveView(v); setSettingsInitialTab(undefined); }}
          appVersion={appVersion}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((v) => {
            const next = !v;
            localStorage.setItem("omwhisper-sidebar", next ? "open" : "closed");
            return next;
          })}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Banners */}
          {runningFromDmg && (
            <div className="flex items-center justify-between px-5 py-2 shrink-0" style={{ background: "rgba(245,158,11,0.07)", boxShadow: "0 2px 8px var(--shadow-dark)" }}>
              <span className="text-amber-400 text-xs">
                You're running OmWhisper from the disk image. Drag it to Applications first.
              </span>
              <button onClick={() => setRunningFromDmg(false)} className="text-white/50 hover:text-white/60 text-xs cursor-pointer ml-4 shrink-0" aria-label="Dismiss disk image warning">
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
                <a href={updateInfo.download_url} target="_blank" rel="noreferrer" className="text-emerald-400 text-xs underline hover:text-emerald-300">
                  Download
                </a>
                <button onClick={() => setUpdateInfo(null)} className="text-white/50 hover:text-white/60 text-xs cursor-pointer" aria-label="Dismiss update notification">
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
              <HomeView
                activeModel={activeModel}
                onNavigate={navigate}
                isRecording={isRecording}
                isSmartDictation={isSmartDictation}
                onStartRecording={() => startRecording(false)}
                onStopRecording={stopRecording}
              />
            )}
            {activeView === "models" && (
              <AiModelsView
                activeModel={activeModel}
                onModelChange={async (name) => {
                  setActiveModel(name);
                  try {
                    const s = await invoke<Record<string, unknown>>("get_settings");
                    await invoke("update_settings", { newSettings: { ...s, active_model: name } });
                  } catch {}
                }}
                initialTab={
                  settingsInitialTab === "whisper" || settingsInitialTab === "smart-dictation"
                    ? settingsInitialTab
                    : undefined
                }
              />
            )}
            {activeView === "settings" && <SettingsPanel initialTab={settingsInitialTab as any} />}
            {activeView === "history" && <TranscriptionHistory />}
            {activeView === "vocabulary" && <Vocabulary />}
            {activeView === "license" && <LicensePage />}
          </div>
        </div>
      </div>

      {/* Global toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-emerald-400 text-xs font-mono pointer-events-none z-50"
          style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm), 0 0 16px var(--accent-glow-weak)" }}
        >
          {toast}
        </div>
      )}

      {/* Upgrade modal */}
      {showUpgradePrompt && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50" role="dialog" aria-modal="true">
          <div className="rounded-2xl p-7 max-w-sm w-full mx-4 text-center" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised), 0 0 60px rgba(0,0,0,0.5)" }}>
            <div className="text-3xl mb-3 select-none" style={{ filter: "drop-shadow(0 0 10px var(--accent-glow))" }}>ॐ</div>
            <h3 className="text-white/90 font-bold text-lg mb-2">You've used your 30 free minutes today</h3>
            <p className="text-white/40 text-sm mb-5 leading-relaxed">
              Upgrade for unlimited transcription — just $12, one time. Your usage resets at midnight.
            </p>
            <LicenseActivation onActivated={() => setShowUpgradePrompt(false)} />
            <button onClick={() => setShowUpgradePrompt(false)} className="mt-3 w-full py-2 text-white/40 hover:text-white/55 text-sm transition-colors cursor-pointer">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
