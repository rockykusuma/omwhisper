import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import OverlayWindow from "./components/OverlayWindow";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles/globals.css";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN ?? "";

async function getWindowLabel(): Promise<string> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

getWindowLabel().then(label => {
  const root = document.getElementById("root") as HTMLElement;

  if (label === "overlay") {
    document.documentElement.style.cssText = "background: transparent !important; margin: 0; padding: 0;";
    document.body.style.cssText = "background: transparent !important; margin: 0; padding: 0; height: 100vh; overflow: hidden; display: flex; align-items: center; justify-content: center;";
    root.style.cssText = "background: transparent !important; display: flex; align-items: center; justify-content: center;";
    ReactDOM.createRoot(root).render(<OverlayWindow />);
    return;
  }

  // Main window: init Sentry before first render.
  // localStorage key is written by Settings.tsx whenever the user changes the toggle.
  // Absent key = first launch = default on.
  const crashEnabled = localStorage.getItem("crash_reporting_enabled") !== "false";
  Sentry.init({
    dsn: crashEnabled ? SENTRY_DSN : "",
    beforeSend(event) {
      delete event.request;
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.filter(
          (b: import("@sentry/react").Breadcrumb) => b.category !== "navigation" && b.category !== "xhr"
        );
      }
      return event;
    },
  });

  ReactDOM.createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
});
