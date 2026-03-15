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
    // Overlay: fully transparent chrome, content-sized pill
    document.documentElement.style.cssText = "background: transparent !important; margin: 0; padding: 0;";
    document.body.style.cssText = "background: transparent !important; margin: 0; padding: 0; height: 100vh; overflow: hidden; display: flex; align-items: center; justify-content: center;";
    ReactDOM.createRoot(root).render(<OverlayWindow />);
  } else {
    ReactDOM.createRoot(root).render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );
  }
});
