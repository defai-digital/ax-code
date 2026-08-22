import type { ActionResult, ComputerAction } from "../action"
import { ComputerUseError } from "../errors"
import { StdioMcpClient, mcpImage, mcpText, toActionResult, type McpClient } from "../mcp/stdio-client"
import type { ComputerUseProvider, ObserveScope, ProviderCapabilities } from "../provider"
import type { AppInfo, ComputerElement, ComputerObservation } from "../types"

export interface OcuProtocolProviderConfig {
  command?: string
  args?: string[]
  requestTimeoutMs?: number
  /** test hook: inject a connected client instead of spawning the server */
  client?: McpClient
}

// canonical key names -> xdotool keysyms. Modifiers: cmd maps to super.
// xdotool named keysyms are case-sensitive ("Escape", "Return"); single
// letters/digits pass through unchanged.
const XDOTOOL_NAMES: Record<string, string> = {
  cmd: "super",
  command: "super",
  meta: "super",
  option: "alt",
  escape: "Escape",
  return: "Return",
  enter: "Return",
  tab: "Tab",
  delete: "Delete",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "Page_Up",
  pagedown: "Page_Down",
}

function xdotoolKey(key: string): string {
  const lower = key.toLowerCase()
  if (XDOTOOL_NAMES[lower]) return XDOTOOL_NAMES[lower]
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase()
  return key
}

// the OCU dialect renders the AX tree as one `\t`-indented line per element:
//   3 outline (showing 0-19 of 32 items) Description: sidebar
// i.e. `<index> <role words> [(flags)] [free-text label] [Key: value ...]`.
const KNOWN_ROLES = [
  "standard window",
  "search text field",
  "disclosure triangle",
  "progress indicator",
  "pop up button",
  "radio button",
  "scroll area",
  "scroll bar",
  "split group",
  "menu button",
  "static text",
  "text field",
  "text area",
  "layout area",
  "layout item",
  "busy indicator",
  "level indicator",
  "value indicator",
  "combo box",
  "check box",
  "tab group",
  "web area",
  "color well",
  "menu bar",
  "menu item",
  "help tag",
  "window",
  "dialog",
  "sheet",
  "group",
  "splitter",
  "outline",
  "table",
  "row",
  "cell",
  "column",
  "button",
  "link",
  "image",
  "list",
  "menu",
  "tab",
  "toolbar",
  "slider",
  "stepper",
  "browser",
  "label",
].sort((a, b) => b.length - a.length) // longest prefix wins

const ANNOTATION_RE = /\b(Secondary Actions|Description|Help|Value|ID|Text):/g

function splitRole(segment: string): { role: string; label?: string } {
  const lower = segment.toLowerCase()
  for (const role of KNOWN_ROLES) {
    if (lower === role) return { role }
    if (lower.startsWith(role + " ")) {
      const label = segment.slice(role.length).trim()
      return { role, label: label || undefined }
    }
  }
  // unknown role: keep the whole segment rather than guessing a split point
  return { role: segment }
}

/**
 * Parse the OCU dialect's rendered accessibility tree into canonical elements.
 * Indices are valid against the snapshot the tree came from. The dialect
 * exposes no geometry in this rendering, so elements carry no bounds.
 */
export function parseA11yTree(text: string): ComputerElement[] {
  const elements: ComputerElement[] = []
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (!match) continue
    const [, id, rest] = match

    // annotations are `Key: value` segments; a value runs to the next key
    const annotations: Record<string, string> = {}
    let head = rest
    const keys = [...rest.matchAll(ANNOTATION_RE)]
    if (keys.length > 0) {
      head = rest.slice(0, keys[0].index)
      for (let i = 0; i < keys.length; i++) {
        const start = keys[i].index + keys[i][0].length
        const end = i + 1 < keys.length ? keys[i + 1].index : rest.length
        // values are comma-separated from a following key ("ID: x, Help: y")
        annotations[keys[i][1]] = rest.slice(start, end).trim().replace(/,+$/, "").trim()
      }
    }

    let enabled: boolean | undefined
    let focused: boolean | undefined
    const withoutParens = head.replace(/\(([^)]*)\)/g, (_paren, flags: string) => {
      for (const flag of flags.split(",")) {
        const normalized = flag.trim().toLowerCase()
        if (normalized === "disabled") enabled = false
        if (normalized === "focused") focused = true
      }
      return " "
    })

    const { role, label } = splitRole(withoutParens.replace(/\s+/g, " ").trim())
    elements.push({
      id,
      role,
      name: annotations["Description"] || annotations["ID"] || annotations["Text"] || label,
      value: annotations["Value"] || undefined,
      enabled,
      focused,
    })
  }
  return elements
}

/**
 * Base adapter for backends speaking the app-scoped OCU tool dialect over
 * stdio MCP (`<binary> mcp`): every tool takes an `app` argument, and
 * `get_app_state` launches/activates the app as a side effect — there is no
 * window-level activation. Shared by the AX-owned native driver
 * (AXNativeProvider) and the test-only upstream reference arm; CuaProvider is
 * also MCP-based but speaks a different dialect and does not derive from this
 * class.
 *
 * Error messages surfaced to the model name `this.name` (or the dialect), so
 * subclasses never mislabel themselves as the upstream backend.
 */
export abstract class OcuProtocolProvider implements ComputerUseProvider {
  abstract readonly name: string

  private client: McpClient | undefined
  /** in-flight spawn, so concurrent first calls share one server process */
  private connecting: Promise<McpClient> | undefined
  /** app of the most recent observe/launch; dialect tools require it */
  private currentApp: string | undefined
  /** elements of the most recent observation (raw provider ids) */
  private lastElements: ComputerElement[] = []

  constructor(protected readonly config: OcuProtocolProviderConfig = {}) {}

  capabilities(): ProviderCapabilities {
    return {
      actions: ["click", "type", "keypress", "scroll", "drag", "set_value", "launch_app"],
      backgroundDelivery: true,
      elementTargeting: true,
      windowActivation: false,
    }
  }

  async listApps(): Promise<AppInfo[]> {
    const result = await (await this.mcp()).callTool("list_apps", {})
    const apps: AppInfo[] = []
    for (const line of mcpText(result).split("\n")) {
      // the dialect renders one app per line: "Name — bundle.id [running, frontmost]"
      const match = /^(?<name>.+?) — (?<bundle>\S+)(?: \[.*\])?$/.exec(line.trim())
      if (match?.groups) apps.push({ name: match.groups.name, bundleId: match.groups.bundle })
    }
    return apps
  }

  async observe(scope: ObserveScope): Promise<ComputerObservation> {
    if (!("app" in scope)) {
      throw new ComputerUseError(`${this.name} only supports the { app } scope; the dialect is app-scoped`, {
        provider: this.name,
        code: "unsupported_scope",
      })
    }
    const result = await (await this.mcp()).callTool("get_app_state", { app: scope.app })
    this.currentApp = scope.app
    const a11yText = mcpText(result)
    // element indices come from the rendered tree text; the dialect exposes no
    // geometry in it, so elements carry no bounds
    this.lastElements = parseA11yTree(a11yText)
    return {
      platform: "darwin", // the OCU dialect is macOS-only
      provider: this.name,
      timestamp: Date.now(),
      app: { name: scope.app },
      screenshot: mcpImage(result),
      elements: this.lastElements,
      a11yText: a11yText || undefined,
      raw: result,
    }
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    if (action.type === "activate_window") {
      throw new ComputerUseError("the app-scoped OCU tool dialect cannot activate individual windows", {
        provider: this.name,
        code: "unsupported_action",
      })
    }
    if (action.type === "launch_app") {
      // no explicit launch tool: get_app_state launches/activates as a side effect
      const result = await (await this.mcp()).callTool("get_app_state", { app: action.app })
      this.currentApp = action.app
      return toActionResult(this.name, action, result)
    }
    const app = this.requireApp(action)
    switch (action.type) {
      case "click": {
        const args: Record<string, unknown> = { app }
        if (action.target.kind === "element") {
          args.element_index = action.target.id
        } else {
          args.x = action.target.x
          args.y = action.target.y
        }
        if (action.count && action.count > 1) args.click_count = action.count
        if (action.button && action.button !== "left") args.mouse_button = action.button
        return this.call(action, "click", args)
      }
      case "type":
        return this.call(action, "type_text", { app, text: action.text })
      case "keypress":
        // the dialect takes xdotool key syntax: ["ctrl", "c"] -> "ctrl+c"
        return this.call(action, "press_key", { app, key: action.keys.map(xdotoolKey).join("+") })
      case "scroll": {
        if (action.target?.kind === "point") {
          throw new ComputerUseError("the app-scoped OCU tool dialect scrolls elements, not points", {
            provider: this.name,
            code: "unsupported_target",
          })
        }
        // the dialect's scroll schema requires element_index; without an
        // explicit target, anchor on the first scrollable element of the last
        // observation rather than calling the tool with a missing argument
        let elementIndex = action.target?.kind === "element" ? action.target.id : undefined
        if (!elementIndex) {
          const scrollable =
            this.lastElements.find((element) => element.role?.includes("scroll area")) ??
            this.lastElements.find((element) => element.role?.includes("scroll"))
          if (!scrollable) {
            return {
              ok: false,
              provider: this.name,
              action: action.type,
              refusal: "no scrollable element in last observation",
            }
          }
          elementIndex = scrollable.id
        }
        return this.call(action, "scroll", {
          app,
          direction: action.direction,
          pages: action.amount ?? 1,
          element_index: elementIndex,
        })
      }
      case "drag": {
        if (action.from.kind !== "point" || action.to.kind !== "point") {
          throw new ComputerUseError("the app-scoped OCU tool dialect drags pixel coordinates only", {
            provider: this.name,
            code: "unsupported_target",
          })
        }
        return this.call(action, "drag", {
          app,
          from_x: action.from.x,
          from_y: action.from.y,
          to_x: action.to.x,
          to_y: action.to.y,
        })
      }
      case "set_value": {
        if (action.target.kind !== "element") {
          throw new ComputerUseError("the app-scoped OCU tool dialect set_value requires an element target", {
            provider: this.name,
            code: "unsupported_target",
          })
        }
        return this.call(action, "set_value", { app, element_index: action.target.id, value: action.value })
      }
    }
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

  private requireApp(action: ComputerAction): string {
    if (!this.currentApp) {
      throw new ComputerUseError(
        `${this.name}.act("${action.type}") requires a prior observe({ app }) — the dialect tools are app-scoped`,
        { provider: this.name, code: "no_active_observation" },
      )
    }
    return this.currentApp
  }

  /**
   * The single protected tool-call hook: invokes one dialect tool and maps the
   * result. Subclasses use it to add AX-only tools beyond the shared surface;
   * connection state itself stays private to the base.
   */
  protected async call(action: ComputerAction, tool: string, args: Record<string, unknown>): Promise<ActionResult> {
    const result = await (await this.mcp()).callTool(tool, args)
    return toActionResult(this.name, action, result)
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

  /** command used when neither config.command nor an env override is set */
  protected abstract defaultCommand(): string

  /** env var consulted before defaultCommand(); subclasses name their own var */
  protected abstract commandEnvVar(): string

  protected defaultArgs(): string[] {
    return ["mcp"]
  }

  /** full command resolution chain: config.command > env override > default */
  protected resolveCommand(): string {
    return this.config.command ?? process.env[this.commandEnvVar()] ?? this.defaultCommand()
  }

  private async connect(): Promise<McpClient> {
    const client =
      this.config.client ??
      (await StdioMcpClient.start({
        command: this.resolveCommand(),
        args: this.config.args ?? this.defaultArgs(),
        requestTimeoutMs: this.config.requestTimeoutMs,
      }))
    this.client = client
    return client
  }
}
