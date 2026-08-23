import type { ActionResult, ComputerAction } from "../action"
import { ComputerUseError } from "../errors"
import { StdioMcpClient, mcpRefusal, mcpText, type McpCallToolResult, type McpClient } from "../mcp/stdio-client"
import type { ComputerUseProvider, ObserveScope, ProviderCapabilities } from "../provider"
import {
  AX_ACT_TOOL,
  AX_CAPABILITIES_TOOL,
  AX_LIST_APPS_TOOL,
  AX_LIST_WINDOWS_TOOL,
  AX_OBSERVE_TOOL,
  ActionResultSchema,
  ComputerActionSchema,
  ListAppsResultSchema,
  ListWindowsResultSchema,
  ComputerObservationSchema,
  ObserveScopeSchema,
  ProviderCapabilitiesSchema,
  ProtocolError,
  validateProtocolPeer,
  validatePayload,
} from "../protocol"
import type { AppInfo, ComputerObservation, WindowInfo } from "../types"

export interface ExternalComputerProviderConfig {
  command?: string
  args?: string[]
  requestTimeoutMs?: number
  env?: Record<string, string | undefined>
  /** test hook: inject a connected client instead of spawning the server */
  client?: McpClient
  /** initialize result the injected client would have returned; required for version negotiation */
  initializeResult?: unknown
}

/**
 * Assumed capabilities before the first round-trip completes. The server is
 * the authority — ax_capabilities is fetched during connect and cached — but
 * capabilities() is synchronous, so a provider that has not connected yet
 * reports the full canonical surface and lets the server refuse what it
 * cannot do.
 */
const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  actions: ["click", "type", "keypress", "scroll", "drag", "set_value", "activate_window", "launch_app"],
  backgroundDelivery: true,
  elementTargeting: true,
  windowActivation: true,
}

/**
 * ComputerUseProvider over the canonical AX Computer MCP protocol: spawns a
 * configured `{ command, args }` server via StdioMcpClient, negotiates the
 * protocol version from the initialize result, and maps the five canonical
 * tools (ax_capabilities / ax_list_apps / ax_list_windows / ax_observe /
 * ax_act) onto the provider surface. Every request and response payload is
 * validated against the protocol schemas — a peer that drifts from the
 * contract fails here with a ProtocolError, not deep in result mapping.
 */
export class ExternalComputerProvider implements ComputerUseProvider {
  readonly name = "external"

  private client: McpClient | undefined
  /** in-flight spawn, so concurrent first calls share one server process */
  private connecting: Promise<McpClient> | undefined
  private cachedCapabilities: ProviderCapabilities | undefined

  constructor(private readonly config: ExternalComputerProviderConfig = {}) {}

  capabilities(): ProviderCapabilities {
    return this.cachedCapabilities ?? DEFAULT_CAPABILITIES
  }

  async listApps(): Promise<AppInfo[]> {
    const result = await this.callCanonical(AX_LIST_APPS_TOOL, {})
    return validatePayload(ListAppsResultSchema, this.structured(result, AX_LIST_APPS_TOOL), AX_LIST_APPS_TOOL).apps
  }

  async listWindows(): Promise<WindowInfo[]> {
    const result = await this.callCanonical(AX_LIST_WINDOWS_TOOL, {})
    return validatePayload(ListWindowsResultSchema, this.structured(result, AX_LIST_WINDOWS_TOOL), AX_LIST_WINDOWS_TOOL)
      .windows
  }

  async observe(scope: ObserveScope): Promise<ComputerObservation> {
    // validate the request before it goes on the wire: a malformed scope must
    // fail here, not as a server-side rejection with a less actionable message
    validatePayload(ObserveScopeSchema, scope, "observe scope")
    const result = await this.callCanonical(AX_OBSERVE_TOOL, { scope })
    return validatePayload(ComputerObservationSchema, this.structured(result, AX_OBSERVE_TOOL), AX_OBSERVE_TOOL)
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    validatePayload(ComputerActionSchema, action, "act action")
    const result = await this.callCanonical(AX_ACT_TOOL, { action })
    // backend refusals are results, not protocol failures
    if (result.isError) {
      return { ok: false, provider: this.name, action: action.type, refusal: mcpRefusal(result) }
    }
    return validatePayload(ActionResultSchema, this.structured(result, AX_ACT_TOOL), AX_ACT_TOOL)
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
    this.cachedCapabilities = undefined
  }

  private async callCanonical(tool: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    return (await this.mcp()).callTool(tool, args)
  }

  /** structuredContent of a successful call; isError and missing payloads are provider/protocol errors */
  private structured(result: McpCallToolResult, tool: string): unknown {
    if (result.isError) {
      // Preserve the server's domain refusal code (structuredContent.code)
      // verbatim — e.g. unsupported_scope, which the compat suite reacts to
      // with an app-scope fallback. Text-only failures stay provider_error.
      const payload = result.structuredContent
      const code =
        typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).code === "string"
          ? ((payload as Record<string, unknown>).code as string)
          : "provider_error"
      throw new ComputerUseError(`${tool} refused: ${mcpText(result) || "unknown backend error"}`, {
        provider: this.name,
        code,
      })
    }
    if (result.structuredContent === undefined || result.structuredContent === null) {
      throw new ProtocolError("invalid_payload", `MCP tool "${tool}" returned no structuredContent payload`)
    }
    return result.structuredContent
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

  private resolveCommand(): string | undefined {
    return this.config.command ?? process.env.AX_COMPUTER_COMMAND
  }

  private async connect(): Promise<McpClient> {
    let client: McpClient
    let initializeResult: unknown
    if (this.config.client) {
      client = this.config.client
      initializeResult = this.config.initializeResult
    } else {
      const spawned = await StdioMcpClient.start({
        command: this.resolveCommand() ?? "",
        args: this.config.args ?? [],
        env: this.config.env,
        requestTimeoutMs: this.config.requestTimeoutMs,
      })
      client = spawned
      initializeResult = spawned.initializeResult
    }
    try {
      // version negotiation happens before any tool call: an incompatible
      // peer fails the connect with a clear version-mismatch error
      validateProtocolPeer(initializeResult)
      const caps = await client.callTool(AX_CAPABILITIES_TOOL, {})
      this.cachedCapabilities = validatePayload(
        ProviderCapabilitiesSchema,
        this.structured(caps, AX_CAPABILITIES_TOOL),
        AX_CAPABILITIES_TOOL,
      )
    } catch (error) {
      // never leak a spawned server for a peer that failed negotiation
      if (!this.config.client) await client.close().catch(() => {})
      throw error
    }
    this.client = client
    return client
  }
}
