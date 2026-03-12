import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import OverlayWindow from "./components/OverlayWindow";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles/globals.css";

// Detect if we're in the overlay window
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
    // Overlay: transparent, no padding, full height
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
    document.body.style.height = "72px";
    document.body.style.overflow = "hidden";
    document.documentElement.style.background = "transparent";
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <div style={{ height: "72px", padding: 0 }}>
          <OverlayWindow />
        </div>
      </React.StrictMode>
    );
  } else {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
  }
});
