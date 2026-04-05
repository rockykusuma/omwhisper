import { useEffect, useState, useRef, useCallback } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles } from "lucide-react";
import Sidebar, { type View } from "./components/Sidebar";
import HomeView from "./components/HomeView";
import AiModelsView from "./components/AiModelsView";
import SettingsPanel, { type SettingsTab } from "./components/Settings";
import Onboarding from "./components/Onboarding";
import TranscriptionHistory from "./components/TranscriptionHistory";
import Vocabulary from "./components/Vocabulary";
import { logger } from "./utils/logger";
import { STORAGE_KEYS } from "./utils/storageKeys";
import { initTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import type { TranscriptionSegment } from "./types";

// Apply saved theme before first render
initTheme();

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isSmartDictation, setIsSmartDictation] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [activeView, setActiveView] = useState<View>("home");
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
  const [activeModel, setActiveModel] = useState("tiny.en");
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateNotes, setUpdateNotes] = useState("");
  const [updateVersion, setUpdateVersion] = useState("");
  const [isInstalling, setIsInstalling] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [runningFromDmg, setRunningFromDmg] = useState(false);
  const [showLlmNudge, setShowLlmNudge] = useState(false);
  const [noModelBanner, setNoModelBanner] = useState(false);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SIDEBAR) !== "closed";
  });
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
    setSettingsInitialTab(tab as SettingsTab | undefined);
  };

  // ── Centralised start / stop ────────────────────────────────────────────
  const startRecording = useCallback(async (smartDictation = false) => {
    if (isRecordingRef.current) return;
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
      // "cancelled" means the PTT key was released before the mic started — silent no-op.
      if (String(e) === "cancelled") return;
      logger.error("Failed to start transcription:", e);
      setMicError(String(e));
      setTimeout(() => setMicError(null), 5000);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    // Only arm the paste machinery if we were actually recording.
    if (isRecordingRef.current) {
      pendingIsSmartDictation.current = isSmartDictationRef.current;
      isPendingPaste.current = true;
    }
    try {
      await invoke("stop_transcription");
    } catch (e) {
      logger.error("Failed to stop transcription:", e);
      isPendingPaste.current = false;
    } finally {
      setIsRecording(false);
      setIsSmartDictation(false);
      // For smart dictation, the polish handler owns the overlay — skip the auto-hide.
      if (!pendingIsSmartDictation.current) {
        setTimeout(() => invoke("hide_overlay").catch((e) => logger.debug("hide_overlay:", e)), 1500);
      }
    }
  }, []);

  useEffect(() => {
    invoke<boolean>("is_first_launch").then(setShowOnboarding);
    invoke<boolean>("is_running_from_dmg").then(setRunningFromDmg).catch(() => {});
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
    invoke<{ active_model: string }>("get_settings")
      .then((s) => { if (s.active_model) setActiveModel(s.active_model); })
      .catch(() => {});
    invoke<{ is_downloaded: boolean }[]>("get_models")
      .then(models => { if (!models.some(m => m.is_downloaded)) setNoModelBanner(true); })
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
        setMicError("Smart Dictation needs AI setup. Open AI Models → Smart Dictation.");
        setTimeout(() => setMicError(null), 5000);
        return;
      }
      startRecording(true);
    });

    const unlistenPolishSelected = listen("hotkey-polish-selected", async () => {
      try {
        await invoke("polish_selected_text");
      } catch (err) {
        const msg = typeof err === "string" ? err : "Polish failed";
        setMicError(msg);
        setTimeout(() => setMicError(null), 5000);
      }
    });

    // Rust signals forced stop (usage limit, etc.)
    const unlistenState = listen<boolean>("recording-state", (event) => {
      if (!event.payload) {
        pendingIsSmartDictation.current = isSmartDictationRef.current;
        isPendingPaste.current = true;
        // For smart dictation, the polish handler owns the overlay — skip the auto-hide.
        if (!isSmartDictationRef.current) {
          setTimeout(() => invoke("hide_overlay").catch((e) => logger.debug("hide_overlay:", e)), 1500);
        }
        setIsRecording(false);
        setIsSmartDictation(false);
      }
    });

    const unlistenMic = listen<string>("transcription-error", (event) => {
      setMicError(event.payload);
      setTimeout(() => setMicError(null), 5000);
    });

    const unlistenTrayNav = listen<string>("tray-navigate", (event) => {
      const view = event.payload === "transcribe" ? "home" : event.payload;
      setActiveView(view as View);
    });

    const unlistenLlmNudge = listen("show-llm-nudge", () => {
      setShowLlmNudge(true);
    });

    const unlistenAccessibility = listen("accessibility-permission-missing", () => {
      invoke("show_main_window").catch(() => {});
      setMicError("Auto-paste needs Accessibility. Go to System Settings → Privacy → Accessibility → enable OmWhisper. Your text was copied to clipboard.");
      setTimeout(() => setMicError(null), 10000);
      invoke("open_accessibility_settings").catch(() => {});
    });

    const unlistenSettingsCorrupted = listen("settings-corrupted", () => {
      showToast("⚠ Settings were corrupted and reset to defaults. A backup was saved as settings.json.bak.");
    });

    return () => {
      Promise.all([unlistenHotkey, unlistenHotkeyStop, unlistenSmartDictation, unlistenPolishSelected, unlistenState, unlistenMic, unlistenTrayNav, unlistenLlmNudge, unlistenAccessibility, unlistenSettingsCorrupted])
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

      // In smart dictation mode, skip if the transcription is too short to be
      // real speech (empty recording / silence hallucination from Whisper).
      if (smartDictation && rawText.split(/\s+/).filter(Boolean).length < 3) return;

      const durationSeconds = (Date.now() - recordingStartRef.current) / 1000;
      const modelUsed = activeModelRef.current;

      if (smartDictation) {
        (async () => {
          setIsPolishing(true);
          try { await invoke("show_overlay"); } catch {}
          emit("polish-state", true).catch(() => {});
          try {
            const settings = await invoke<{ active_polish_style: string }>("get_settings");
            const style = settings.active_polish_style ?? "professional";
            const polished = await invoke<string>("polish_text_cmd", { text: rawText, style, forceBuiltin: null });
            await invoke("paste_transcription", { text: polished });
            invoke("save_transcription", { text: polished, durationSeconds, modelUsed, source: "smart_dictation", rawText, polishStyle: style })
              .catch((e) => logger.error("save_transcription failed:", e));
          } catch (e) {
            if (String(e) === "llm_not_ready") {
              showToast("AI model not ready — check AI Models settings.");
            } else {
              showToast("⚠ AI polish failed — pasting raw text");
              invoke("paste_transcription", { text: rawText }).catch(() => {});
              invoke("save_transcription", { text: rawText, durationSeconds, modelUsed }).catch(() => {});
              logger.error("Smart dictation polish failed:", e);
            }
          } finally {
            setIsPolishing(false);
            emit("polish-state", false).catch(() => {});
            invoke("hide_overlay").catch(() => {});
          }
        })();
      } else {
        (async () => {
          try {
            const settings = await invoke<{ apply_polish_to_regular: boolean }>("get_settings");
            if (settings.apply_polish_to_regular) {
              try {
                const polished = await invoke<string>("polish_text_cmd", { text: rawText, style: "smart_correct", forceBuiltin: null });
                await invoke("paste_transcription", { text: polished });
                invoke("save_transcription", { text: polished, durationSeconds, modelUsed, source: "regular_polished", rawText, polishStyle: "smart_correct" })
                  .catch((e) => logger.error("save_transcription failed:", e));
              } catch {
                showToast("AI not ready — pasting raw text");
                await invoke("paste_transcription", { text: rawText }).catch(() => {});
                invoke("save_transcription", { text: rawText, durationSeconds, modelUsed })
                  .catch((e) => logger.error("save_transcription failed:", e));
              }
            } else {
              await invoke<void>("paste_transcription", { text: rawText });
              invoke("save_transcription", { text: rawText, durationSeconds, modelUsed })
                .catch((e) => logger.error("save_transcription failed:", e));
            }
          } catch {
            // get_settings failed — fall back to raw paste
            await invoke<void>("paste_transcription", { text: rawText }).catch(() => {});
            invoke("save_transcription", { text: rawText, durationSeconds, modelUsed }).catch(() => {});
          }
        })();
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    import("@tauri-apps/plugin-updater").then(({ check }) => {
      check().then((update) => {
        if (update?.available) {
          setUpdateAvailable(true);
          setUpdateVersion(update.version);
          setUpdateNotes(update.body ?? "");
        }
      }).catch(() => {}); // silently ignore network errors
    });
  }, []);

  if (showOnboarding === null) {
    return <div className="min-h-screen" />;
  }

  if (showOnboarding === true) {
    return <Onboarding onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
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
            localStorage.setItem(STORAGE_KEYS.SIDEBAR, next ? "open" : "closed");
            return next;
          })}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Banners */}
          {runningFromDmg && (
            <div className="flex items-center justify-between px-5 py-2 shrink-0" style={{ background: "var(--warning-border)", boxShadow: "0 2px 8px var(--shadow-dark)" }}>
              <span className="text-xs" style={{ color: "var(--warning)" }}>
                You're running OmWhisper from the disk image. Drag it to Applications first.
              </span>
              <button onClick={() => setRunningFromDmg(false)} className="text-xs cursor-pointer ml-4 shrink-0" style={{ color: "var(--t3)" }} aria-label="Dismiss disk image warning">
                ✕
              </button>
            </div>
          )}

          {updateAvailable && (
            <div className="flex items-center justify-between px-5 py-2 shrink-0"
                 style={{ background: "rgba(52,211,153,0.07)", boxShadow: "0 2px 8px var(--shadow-dark)" }}>
              <span className="text-emerald-400 text-xs">
                OmWhisper v{updateVersion} is available — {updateNotes}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  disabled={isInstalling}
                  onClick={async () => {
                    setIsInstalling(true);
                    await invoke("install_update").catch(() => setIsInstalling(false));
                  }}
                  className="text-emerald-400 text-xs underline hover:text-emerald-300 cursor-pointer bg-transparent border-0 p-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isInstalling ? "Installing…" : "Install & Restart"}
                </button>
                <button
                  onClick={() => setUpdateAvailable(false)}
                  className="text-xs cursor-pointer"
                  style={{ color: "var(--t3)" }}
                  aria-label="Dismiss update notification"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {noModelBanner && (
            <div className="flex items-center justify-between px-5 py-2.5 shrink-0" style={{ background: "color-mix(in srgb, var(--accent) 7%, var(--bg))", borderBottom: "1px solid color-mix(in srgb, var(--accent) 18%, transparent)" }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <span style={{ color: "var(--accent)" }} className="shrink-0">✦</span>
                <span className="text-xs leading-snug" style={{ color: "var(--t2)" }}>
                  <span className="font-semibold" style={{ color: "var(--t1)" }}>tiny.en is ready.</span>
                  {" "}Explore AI Models to choose a more accurate model that suits your needs.
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-4">
                <button
                  onClick={() => { setActiveView("models"); setNoModelBanner(false); }}
                  className="text-xs font-semibold cursor-pointer transition-colors"
                  style={{ color: "var(--accent)" }}
                >
                  Explore Models →
                </button>
                <button onClick={() => setNoModelBanner(false)} className="text-xs cursor-pointer" style={{ color: "var(--t4)" }} aria-label="Dismiss">
                  ✕
                </button>
              </div>
            </div>
          )}

          {showLlmNudge && (
            <div
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
              style={{
                background: "color-mix(in srgb, var(--accent) 8%, var(--bg))",
                borderBottom: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <span style={{ color: "var(--t2)" }}>
                  <span className="font-semibold" style={{ color: "var(--t1)" }}>Enable AI cleanup</span>
                  {" — "}Download a 400 MB model to fix punctuation and remove filler words. Works offline.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={async () => {
                    setShowLlmNudge(false);
                    const s = await invoke<import("./types").AppSettings>("get_settings");
                    const updated = { ...s, ai_backend: "built_in" };
                    await invoke("update_settings", { newSettings: updated });
                    await invoke("download_llm_model", { name: updated.llm_model_name });
                    setActiveView("models");
                  }}
                  className="btn-primary text-xs px-3 py-1"
                >
                  Download &amp; Enable
                </button>
                <button
                  onClick={() => setShowLlmNudge(false)}
                  className="btn-ghost text-xs px-2 py-1"
                  style={{ color: "var(--t3)" }}
                >
                  Not now
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
                isPolishing={isPolishing}
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
                initialTab={settingsInitialTab as "whisper" | "smart-dictation" | undefined}
              />
            )}
            <div className={activeView === "settings" ? "h-full" : "hidden"}>
              <SettingsPanel initialTab={settingsInitialTab} onNavigate={navigate} />
            </div>
            {activeView === "history" && <TranscriptionHistory />}
            {activeView === "vocabulary" && <Vocabulary />}
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

    </div>
  );
}

export default App;
