import type {
  ActionResult,
  AppInfo,
  ComputerAction,
  ComputerObservation,
  ComputerUseProvider,
  ObserveScope,
  ProviderCapabilities,
  WindowInfo,
} from "@ax-code/computer/index"

/** 2x2 PNG (dims decode from the IHDR header) */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjAwMAA8EAwF0yZrxAAAAAElFTkSuQmCC"

/** in-memory ComputerUseProvider for tool tests; no processes spawned */
export class FakeComputerProvider implements ComputerUseProvider {
  readonly name = "fake"
  disposed = false
  refusal: string | undefined
  readonly acts: ComputerAction[] = []
  readonly scopes: ObserveScope[] = []

  capabilities(): ProviderCapabilities {
    return {
      actions: ["click", "type", "keypress", "scroll", "drag", "set_value", "activate_window", "launch_app"],
      backgroundDelivery: true,
      elementTargeting: true,
      windowActivation: true,
    }
  }

  async listApps(): Promise<AppInfo[]> {
    return [{ name: "TextEdit", pid: 4242, bundleId: "com.apple.TextEdit" }]
  }

  async listWindows(): Promise<WindowInfo[]> {
    return [
      {
        id: "101",
        title: "Untitled",
        bounds: { x: 50, y: 50, width: 800, height: 600 },
        app: { name: "TextEdit", pid: 4242 },
      },
    ]
  }

  async observe(scope: ObserveScope): Promise<ComputerObservation> {
    this.scopes.push(scope)
    return {
      platform: "test",
      provider: this.name,
      timestamp: Date.now(),
      app: { name: "TextEdit", pid: 4242, bundleId: "com.apple.TextEdit" },
      window: {
        id: "101",
        title: "Untitled",
        bounds: { x: 50, y: 50, width: 800, height: 600 },
        app: { name: "TextEdit", pid: 4242 },
      },
      screenshot: { data: PNG_BASE64, mimeType: "image/png", width: 2, height: 2 },
      elements: [
        { id: "save-btn", role: "button", name: "Save", bounds: { x: 10, y: 20, width: 80, height: 24 } },
        { id: "editor", role: "text area", name: "Editor", enabled: true },
      ],
    }
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    this.acts.push(action)
    if (this.refusal) {
      return { ok: false, provider: this.name, action: action.type, refusal: this.refusal }
    }
    return { ok: true, provider: this.name, action: action.type, detail: `${action.type} done` }
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }
}
