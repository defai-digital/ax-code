import type { ActionResult, ComputerAction, ComputerTarget } from "../action"
import { ComputerUseError } from "../errors"
import {
  StdioMcpClient,
  mcpImage,
  mcpText,
  toActionResult,
  type McpCallToolResult,
  type McpClient,
} from "../mcp/stdio-client"
import type { ComputerUseProvider, ObserveScope, ProviderCapabilities } from "../provider"
import type { AppInfo, Bounds, ComputerElement, ComputerObservation, PixelImage, WindowInfo } from "../types"

export interface CuaProviderConfig {
  command?: string
  args?: string[]
  requestTimeoutMs?: number
  /** test hook: inject a connected client instead of spawning the server */
  client?: McpClient
}

/** routing context captured from the most recent observation */
interface CuaContext {
  scope: "window" | "desktop"
  pid?: number
  windowId?: number
  appName?: string
  /** pixel dimensions of the observation's screenshot, when known */
  screenshot?: { width: number; height: number }
}

/** targeting data for one element of the most recent observation */
interface CuaElementEntry {
  elementIndex?: number
  elementToken?: string
  bounds?: Bounds
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

/** cua prefers structuredContent; older fallbacks render JSON as a text block */
function structuredOf(result: McpCallToolResult): Record<string, unknown> | undefined {
  const direct = asRecord(result.structuredContent)
  if (direct) return direct
  for (const block of result.content ?? []) {
    if (block.type !== "text" || !block.text) continue
    try {
      const parsed = asRecord(JSON.parse(block.text))
      if (parsed) return parsed
    } catch {
      // not a JSON block
    }
  }
  return undefined
}

const MODIFIER_KEYS = new Set(["cmd", "command", "meta", "shift", "option", "alt", "ctrl", "control", "fn"])

// input tools whose schema accepts delivery_mode (verified against
// platform-macos/src/tools/*.rs); set_value and the app/window management
// tools do not, so they are never escalated
const FOREGROUND_CAPABLE_TOOLS = new Set([
  "click",
  "double_click",
  "right_click",
  "drag",
  "hotkey",
  "press_key",
  "scroll",
  "type_text",
])

/**
 * Whether a refused cua tool result recommends foreground escalation, per
 * cua's refusal contract (background_input.rs / tools/mod.rs
 * background_refusal_result): structuredContent.escalation.recommended, or
 * the refusal text itself (same_pid_keyboard_ambiguity and friends point at
 * delivery_mode:"foreground").
 */
function recommendsForeground(result: McpCallToolResult): boolean {
  const escalation = asRecord(asRecord(result.structuredContent)?.escalation)
  if (asString(escalation?.recommended) === "foreground") return true
  const text = mcpText(result)
  return text.includes('delivery_mode:"foreground"') || /_ambiguity|background.*refused/i.test(text)
}

/**
 * Adapter for the Cua driver (`cua-driver mcp`). Window-scoped: element and
 * pixel actions route through the (pid, window_id) of the most recent
 * observation. Supports background input delivery.
 */
export class CuaProvider implements ComputerUseProvider {
  readonly name = "cua"

  private client: McpClient | undefined
  /** in-flight spawn, so concurrent first calls share one server process */
  private connecting: Promise<McpClient> | undefined
  private context: CuaContext | undefined
  /** canonical element id -> cua targeting data, latest observation only */
  private elements = new Map<string, CuaElementEntry>()

  constructor(private readonly config: CuaProviderConfig = {}) {}

  capabilities(): ProviderCapabilities {
    return {
      actions: ["click", "type", "keypress", "scroll", "drag", "set_value", "activate_window", "launch_app"],
      backgroundDelivery: true,
      elementTargeting: true,
      windowActivation: true,
    }
  }

  async listApps(): Promise<AppInfo[]> {
    const result = await (await this.mcp()).callTool("list_apps", {})
    const apps = asRecord(structuredOf(result))?.apps
    if (!Array.isArray(apps)) return []
    const out: AppInfo[] = []
    for (const entry of apps) {
      const record = asRecord(entry)
      const name = record ? asString(record.name) : undefined
      if (!record || !name) continue
      out.push({ name, pid: asNumber(record.pid), bundleId: asString(record.bundle_id) })
    }
    return out
  }

  async listWindows(): Promise<WindowInfo[]> {
    return (await this.listWindowRecords()).map((record) => record.info)
  }

  async observe(scope: ObserveScope): Promise<ComputerObservation> {
    if ("desktop" in scope) {
      const result = await (await this.mcp()).callTool("get_desktop_state", {})
      const structured = structuredOf(result)
      const screenshot = withStructuredDims(mcpImage(result), structured)
      this.context = { scope: "desktop", screenshot: dimsOf(screenshot) }
      this.elements = new Map()
      return {
        platform: process.platform,
        provider: this.name,
        timestamp: Date.now(),
        screenshot,
        elements: [],
        a11yText: mcpText(result) || undefined,
        raw: result,
      }
    }
    if ("windowId" in scope) {
      const window = await this.findWindow(scope.windowId)
      return this.observeWindow(window.pid, window.windowId, window.info.app?.name, window.info)
    }
    const app = await this.findApp(scope.app)
    const windows = await this.listWindowRecords(app.pid)
    const key = windows[0]
    if (!key) {
      throw new ComputerUseError(`cua: app "${scope.app}" (pid ${app.pid}) has no windows`, {
        provider: this.name,
        code: "provider_error",
      })
    }
    return this.observeWindow(app.pid, key.windowId, app.name, key.info)
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    // activate_window resolves its pid up front (bring_to_front requires it);
    // everything else builds args in toCuaArgs
    if (action.type === "activate_window") {
      const window = await this.findWindow(action.windowId)
      const result = await (
        await this.mcp()
      ).callTool("bring_to_front", { pid: window.pid, window_id: window.windowId })
      return toActionResult(this.name, action, result)
    }
    const { tool, args } = this.toCuaArgs(action)
    const result = await (await this.mcp()).callTool(tool, args)
    if (result.isError && FOREGROUND_CAPABLE_TOOLS.has(tool) && recommendsForeground(result)) {
      // One-shot, backend-sanctioned escalation: foreground delivery briefly
      // fronts the window and may move the real cursor/focus — this is cua's
      // own refusal contract, not an implicit fallback. Never retried twice;
      // a refusing retry is returned as-is.
      const retried = await (await this.mcp()).callTool(tool, { ...args, delivery_mode: "foreground" })
      return toActionResult(this.name, action, retried)
    }
    return toActionResult(this.name, action, result)
  }

  async dispose(): Promise<void> {
    const connecting = this.connecting
    this.connecting = undefined
    // a spawn still in flight when dispose runs lands afterwards — close it
    // instead of leaking the process, and never cache it as the live client
    if (connecting)
      void connecting.then(
        (client) => {
          if (this.client === client) this.client = undefined
          void client.close()
        },
        () => {},
      )
    await this.client?.close()
    this.client = undefined
  }

  private async observeWindow(
    pid: number,
    windowId: number,
    appName: string | undefined,
    info: WindowInfo | undefined,
  ): Promise<ComputerObservation> {
    const result = await (await this.mcp()).callTool("get_window_state", { pid, window_id: windowId })
    const structured = structuredOf(result)
    const screenshot = withStructuredDims(mcpImage(result), structured)
    this.context = { scope: "window", pid, windowId, appName, screenshot: dimsOf(screenshot) }
    this.elements = new Map()
    const elements = this.parseElements(structured)
    return {
      platform: process.platform,
      provider: this.name,
      timestamp: Date.now(),
      app: { name: appName ?? String(pid), pid },
      window: info ?? windowInfoFrom(structured, pid, appName),
      screenshot,
      elements,
      a11yText: asString(structured?.tree_markdown) ?? (mcpText(result) || undefined),
      raw: result,
    }
  }

  /** fills this.elements as a side effect; entries use element_token when available */
  private parseElements(structured: Record<string, unknown> | undefined): ComputerElement[] {
    const list = structured?.elements
    if (!Array.isArray(list)) return []
    const out: ComputerElement[] = []
    for (const entry of list) {
      const record = asRecord(entry)
      if (!record) continue
      const index = asNumber(record.element_index)
      const token = asString(record.element_token)
      if (index === undefined && !token) continue
      const id = token ?? String(index)
      // cua frames are { x, y, w, h } in screen coordinates
      const frame = asRecord(record.frame)
      const bounds = frame
        ? {
            x: asNumber(frame.x) ?? 0,
            y: asNumber(frame.y) ?? 0,
            width: asNumber(frame.w) ?? 0,
            height: asNumber(frame.h) ?? 0,
          }
        : undefined
      out.push({ id, role: asString(record.role), name: asString(record.label), value: asString(record.value), bounds })
      this.elements.set(id, { elementIndex: index, elementToken: token, bounds })
    }
    return out
  }

  private async findApp(app: string): Promise<{ pid: number; name: string }> {
    const apps = await this.listApps()
    const needle = app.toLowerCase()
    const found = apps.find(
      (candidate) => candidate.name.toLowerCase() === needle || candidate.bundleId?.toLowerCase() === needle,
    )
    if (!found || found.pid === undefined) {
      throw new ComputerUseError(`cua: app "${app}" not found or not running`, {
        provider: this.name,
        code: "provider_error",
      })
    }
    return { pid: found.pid, name: found.name }
  }

  private async findWindow(windowId: string): Promise<{ pid: number; windowId: number; info: WindowInfo }> {
    const id = Number(windowId)
    if (!Number.isFinite(id)) {
      throw new ComputerUseError(`cua: window id "${windowId}" is not numeric`, {
        provider: this.name,
        code: "provider_error",
      })
    }
    const found = (await this.listWindowRecords()).find((record) => record.windowId === id)
    if (!found) {
      throw new ComputerUseError(`cua: window ${windowId} not found`, { provider: this.name, code: "provider_error" })
    }
    return found
  }

  private async listWindowRecords(pid?: number): Promise<{ pid: number; windowId: number; info: WindowInfo }[]> {
    const result = await (await this.mcp()).callTool("list_windows", pid === undefined ? {} : { pid })
    const windows = structuredOf(result)?.windows
    if (!Array.isArray(windows)) return []
    const out: { pid: number; windowId: number; info: WindowInfo }[] = []
    for (const entry of windows) {
      const record = asRecord(entry)
      const windowId = record ? asNumber(record.window_id) : undefined
      const windowPid = record ? asNumber(record.pid) : undefined
      if (!record || windowId === undefined || windowPid === undefined) continue
      const bounds = asRecord(record.bounds)
      out.push({
        pid: windowPid,
        windowId,
        info: {
          id: String(windowId),
          title: asString(record.title) ?? "",
          bounds: {
            x: asNumber(bounds?.x) ?? 0,
            y: asNumber(bounds?.y) ?? 0,
            width: asNumber(bounds?.width) ?? 0,
            height: asNumber(bounds?.height) ?? 0,
          },
          app: { name: asString(record.app_name) ?? String(windowPid), pid: windowPid },
        },
      })
    }
    return out
  }

  /**
   * Every cua tool-call argument construction lives in this one function. The
   * field names follow the cua-driver macOS tool registry
   * (rust/crates/platform-macos/src/tools/*.rs); the click and scroll paths
   * are verified live against cua-driver 0.21.0 (`mcp --direct`), the rest
   * remains assumed — corrections should touch this function (and the
   * activate_window branch in `act`) only.
   */
  private toCuaArgs(action: ComputerAction): { tool: string; args: Record<string, unknown> } {
    switch (action.type) {
      case "click": {
        // verified live: the macOS registry accepts flat pid/window_id + x,y
        // (the contract crate's alternative shape is x, y, target:
        // { Window { pid, window_id } }). x,y are pixels of the last
        // get_window_state PNG; the driver reverses Retina backing scale and
        // any window-image downscale to window-local points.
        // assumption: double_click/right_click take the same target fields as click.
        // They require pid and reject `scope` (additionalProperties: false), so
        // they only apply to window-routed clicks; on desktop scope the click
        // tool's own button/count fields drive the screen-absolute pixel path.
        const windowed = this.context?.scope === "window"
        const tool =
          windowed && action.count === 2
            ? "double_click"
            : windowed && action.button === "right"
              ? "right_click"
              : "click"
        const args = this.targetArgs(action.target)
        if (tool === "click" && action.button && action.button !== "left") args.button = action.button
        if (tool === "click" && action.count && action.count > 1) args.count = action.count
        return { tool, args }
      }
      case "type":
        // assumption: type_text { text, pid?, window_id? }
        return { tool: "type_text", args: { ...this.routeArgs(), text: action.text } }
      case "keypress": {
        // assumption: press_key { key } for a single non-modifier key,
        // hotkey { keys: [...] } (min 2, modifiers first) for combinations
        const single = action.keys.length === 1 && !MODIFIER_KEYS.has(action.keys[0].toLowerCase())
        return single
          ? { tool: "press_key", args: { ...this.routeArgs(), key: action.keys[0] } }
          : { tool: "hotkey", args: { ...this.routeArgs(), keys: action.keys } }
      }
      case "scroll": {
        // ScrollInput requires x, y (cua-driver-contract). Verified live: for
        // a window target, x,y are window-local screenshot pixels (top-left of
        // the get_window_state PNG) routed through the pixel-wheel path. For
        // target-less scrolls, anchor at the center of the last observation's
        // screenshot when its dimensions are known.
        const args: Record<string, unknown> = action.target ? this.targetArgs(action.target) : this.routeArgs()
        if (!action.target) {
          const center = this.screenshotCenter()
          if (center) {
            args.x = center.x
            args.y = center.y
          }
        }
        args.direction = action.direction
        args.amount = action.amount ?? 3
        return { tool: "scroll", args }
      }
      case "drag": {
        // assumption: drag { from_x, from_y, to_x, to_y, pid?, window_id? }
        const from = this.pointOf(action.from)
        const to = this.pointOf(action.to)
        return { tool: "drag", args: { ...this.routeArgs(), from_x: from.x, from_y: from.y, to_x: to.x, to_y: to.y } }
      }
      case "set_value":
        // assumption: set_value { pid, value, element_index? | element_token? }
        if (action.target.kind !== "element") {
          throw new ComputerUseError("cua set_value requires an element target", {
            provider: this.name,
            code: "unsupported_target",
          })
        }
        return { tool: "set_value", args: { ...this.elementArgs(action.target.id), value: action.value } }
      case "launch_app":
        // assumption: launch_app { name } (the registry also accepts bundle_id)
        return { tool: "launch_app", args: { name: action.app } }
      case "activate_window":
        // unreachable: handled in act() because it needs an async pid lookup
        throw new ComputerUseError("internal: activate_window is handled in act()", {
          provider: this.name,
          code: "provider_error",
        })
    }
  }

  /** routing fields of the last observation: pid/window_id for a window scope, scope for desktop */
  private routeArgs(): Record<string, unknown> {
    // desktop-scoped input tools take scope:"desktop" instead of pid/window_id;
    // without it the backend fails the call with a missing-pid error
    if (this.context?.scope === "desktop") return { scope: "desktop" }
    if (this.context?.scope !== "window" || this.context.pid === undefined) return {}
    return { pid: this.context.pid, window_id: this.context.windowId }
  }

  private targetArgs(target: ComputerTarget): Record<string, unknown> {
    if (target.kind === "element") return this.elementArgs(target.id)
    if (this.context?.scope === "desktop") {
      // assumption: windowless pixel clicks need scope: "desktop"
      return { x: target.x, y: target.y, scope: "desktop" }
    }
    return { ...this.routeArgs(), x: target.x, y: target.y }
  }

  private elementArgs(id: string): Record<string, unknown> {
    const entry = this.elements.get(id)
    if (!entry) {
      throw new ComputerUseError(`cua: element "${id}" is not part of the most recent observation`, {
        provider: this.name,
        code: "stale_target",
      })
    }
    // assumption: tools accept element_token (preferred, snapshot-validated)
    // or element_index + window_id
    return entry.elementToken
      ? { ...this.routeArgs(), element_token: entry.elementToken }
      : { ...this.routeArgs(), element_index: entry.elementIndex }
  }

  /** center of the last observation's screenshot, in its pixel space */
  private screenshotCenter(): { x: number; y: number } | undefined {
    const shot = this.context?.screenshot
    return shot ? { x: Math.floor(shot.width / 2), y: Math.floor(shot.height / 2) } : undefined
  }

  /** resolve a target to screenshot pixel coordinates (element -> bounds center) */
  private pointOf(target: ComputerTarget): { x: number; y: number } {
    if (target.kind === "point") return { x: target.x, y: target.y }
    const bounds = this.elements.get(target.id)?.bounds
    if (!bounds) {
      throw new ComputerUseError(`cua: element "${target.id}" has no bounds in the most recent observation`, {
        provider: this.name,
        code: "unsupported_target",
      })
    }
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  }

  private async mcp(): Promise<McpClient> {
    if (this.client) return this.client
    // concurrent first calls share one spawn; a failed spawn is not cached
    this.connecting ??= this.connect()
    try {
      return await this.connecting
    } finally {
      this.connecting = undefined
    }
  }

  private async connect(): Promise<McpClient> {
    const client =
      this.config.client ??
      (await StdioMcpClient.start({
        command: this.config.command ?? process.env.AX_COMPUTER_CUA_COMMAND ?? "cua-driver",
        args: this.config.args ?? ["mcp"],
        requestTimeoutMs: this.config.requestTimeoutMs,
      }))
    this.client = client
    return client
  }
}

/** cua reports screenshot_width/screenshot_height in structuredContent; prefer them over PNG header dims */
function withStructuredDims(
  image: PixelImage | undefined,
  structured: Record<string, unknown> | undefined,
): PixelImage | undefined {
  if (!image) return undefined
  const width = asNumber(structured?.screenshot_width)
  const height = asNumber(structured?.screenshot_height)
  return width !== undefined && height !== undefined ? { ...image, width, height } : image
}

function dimsOf(image: PixelImage | undefined): { width: number; height: number } | undefined {
  return image?.width !== undefined && image.height !== undefined
    ? { width: image.width, height: image.height }
    : undefined
}

function windowInfoFrom(
  structured: Record<string, unknown> | undefined,
  pid: number,
  appName: string | undefined,
): WindowInfo | undefined {
  const id = asNumber(structured?.window_id)
  const bounds = asRecord(structured?.window_bounds)
  if (id === undefined || !bounds) return undefined
  return {
    id: String(id),
    title: "",
    bounds: {
      x: asNumber(bounds.x) ?? 0,
      y: asNumber(bounds.y) ?? 0,
      width: asNumber(bounds.width) ?? 0,
      height: asNumber(bounds.height) ?? 0,
    },
    app: { name: appName ?? String(pid), pid },
  }
}
