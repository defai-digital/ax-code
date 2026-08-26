import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles/fonts"
import "./index.css"
import App from "./App.tsx"
import { SessionAuthGate } from "./components/auth/SessionAuthGate"
import { ThemeSystemProvider } from "./contexts/ThemeSystemContext"
import { ThemeProvider } from "./components/providers/ThemeProvider"
import "./lib/debug"
import { syncDesktopSettings, initializeAppearancePreferences } from "./lib/persistence"
import { applyPersistedDirectoryPreferences } from "./lib/directoryPersistence"
import { initializeLocale, I18nProvider } from "./lib/i18n"
import { recordDesktopStartupEvent } from "./lib/desktop"
import { scheduleRendererPaintMilestone } from "./lib/rendererPaintMilestone"

const runtimeAPIs =
  (typeof window !== "undefined" && window.__AX_CODE_DESKTOP_RUNTIME_APIS__) ||
  (() => {
    throw new Error("Runtime APIs not provided for legacy UI entrypoint.")
  })()

initializeLocale()

const recordRendererPaintMilestone = () => {
  if (typeof window === "undefined" || typeof performance === "undefined") return

  scheduleRendererPaintMilestone({
    readPaintEntries: () => performance.getEntriesByType("paint"),
    observePaint:
      "PerformanceObserver" in window
        ? (onPaint) => {
            const observer = new PerformanceObserver(() => onPaint())
            observer.observe({ type: "paint", buffered: true })
            return observer
          }
        : undefined,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    schedule: (callback) => window.setTimeout(callback, 0),
    record: (details) => recordDesktopStartupEvent("renderer.first-paint", details),
  })
}

void recordDesktopStartupEvent("renderer.entry.start")
recordRendererPaintMilestone()

// Initialize settings asynchronously — the app renders with defaults first
// and hydrates once persisted preferences are applied. Users with non-default
// themes may briefly see default appearance on cold start; accepted trade-off
// for faster time-to-first-paint.
void initializeAppearancePreferences()
  .then(() => {
    void Promise.all([syncDesktopSettings(), applyPersistedDirectoryPreferences()]).catch((err) => {
      console.error("[main] settings init failed:", err)
    })

    // Start watchers regardless of whether secondary settings succeed.
    void import("./lib/appearanceAutoSave")
      .then(({ startAppearanceAutoSave }) => startAppearanceAutoSave())
      .catch((err) => {
        console.error("[main] appearance autosave init failed:", err)
      })
    void import("./lib/modelPrefsAutoSave")
      .then(({ startModelPrefsAutoSave }) => startModelPrefsAutoSave())
      .catch((err) => {
        console.error("[main] model preferences autosave init failed:", err)
      })
    void import("./lib/typographyWatcher")
      .then(({ startTypographyWatcher }) => startTypographyWatcher())
      .catch((err) => {
        console.error("[main] typography watcher init failed:", err)
      })
  })
  .catch((err) => {
    console.error("[main] appearance init failed:", err)
  })

const rootElement = document.getElementById("root")
if (!rootElement) {
  throw new Error("Root element not found")
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <ThemeSystemProvider>
        <ThemeProvider>
          <SessionAuthGate>
            <App apis={runtimeAPIs} />
          </SessionAuthGate>
        </ThemeProvider>
      </ThemeSystemProvider>
    </I18nProvider>
  </StrictMode>,
)
