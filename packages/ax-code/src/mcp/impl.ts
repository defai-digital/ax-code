import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { Env } from "../util/env"
import { toError, toErrorMessage } from "../util/error-message"
import { TOAST_DURATION_LONG_MS } from "@/constants/server"
import { NamedError } from "@ax-code/util/error"
import z from "zod/v4"
import { Instance } from "../project/instance"
import { Installation } from "../installation"
import { sleep, withTimeout } from "@/util/timeout"
import { Ssrf } from "@/util/ssrf"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { McpTrust } from "./trust"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { NotificationEvent } from "@/notification/events"
import open from "open"
import { isRecord } from "@/util/record"
import { KeyedSerialQueue } from "@/util/queue"
import { Shell } from "../shell/shell"
import {
  convertMcpTool,
  mcpItemKey,
  mcpToolPermissionKey,
  resolveMcpToolPermissionKeys,
  type ConvertedMcpTool,
} from "./tool-conversion"
import {
  MCP_CONNECT_ATTEMPTS,
  MCP_CONNECT_RETRY_DELAY_MS,
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_TOOLS_READY_WAIT_MS,
} from "./constants"
import {
  combineTransportErrors,
  isTransientMcpConnectError,
  mcpClientUserAgent,
  mergeRemoteMcpHeaders,
} from "./connect-error"

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = MCP_DEFAULT_TIMEOUT_MS
  const MAX_STDERR_LINE = 2_000
  const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
    error instanceof Error && "code" in error && typeof (error as NodeJS.ErrnoException).code === "string"

  /**
   * Detect when the MCP SDK wrapped a non-JSON error body from a failed
   * dynamic client registration (e.g. Figma returns HTTP 403 with plain
   * text "Forbidden"). The SDK's parseErrorResponse throws a SyntaxError
   * and surfaces it as "HTTP 403: Invalid OAuth error response:
   * SyntaxError: …". Catch this pattern and surface an actionable hint
   * instead of the raw parse error.
   */
  const DYNAMIC_REGISTRATION_REJECTED = /Invalid OAuth error response.*SyntaxError|Invalid OAuth error response.*JSON/i
  function isDynamicRegistrationRejection(message: string): boolean {
    // Match either the explicit registration keywords or the SDK's
    // non-JSON-body wrapper that commonly accompanies a 403/401 from a
    // server that advertises registration_endpoint but rejects unknown
    // clients (e.g. Figma).
    return (
      message.includes("registration") || message.includes("client_id") || DYNAMIC_REGISTRATION_REJECTED.test(message)
    )
  }

  function killProcessTree(pid: number) {
    return Shell.killTree({
      pid,
      kill: (signal?: NodeJS.Signals | number) => {
        try {
          process.kill(pid, signal)
          return true
        } catch (error) {
          if (isErrnoException(error) && error.code === "ESRCH") return false
          throw error
        }
      },
    })
  }

  function pinnedMcpFetch(label: string) {
    return (url: string | URL, init?: RequestInit) => Ssrf.pinnedFetch(url.toString(), { ...init, label })
  }

  function remoteRequestInit(headers?: Record<string, string>): RequestInit {
    return { headers: mergeRemoteMcpHeaders(headers, mcpClientUserAgent(Installation.VERSION)) }
  }

  async function connectRemoteTransport(
    transport: StreamableHTTPClientTransport | SSEClientTransport,
    key: string,
    transportName: string,
    timeout: number,
  ): Promise<MCPClient> {
    let lastError: unknown
    for (let attempt = 1; attempt <= MCP_CONNECT_ATTEMPTS; attempt++) {
      const client = createClient()
      try {
        await withTimeout(client.connect(transport), timeout)
        return client
      } catch (error) {
        lastError = error
        const retry = attempt < MCP_CONNECT_ATTEMPTS && isTransientMcpConnectError(error)
        const authError = error instanceof UnauthorizedError || toErrorMessage(error).includes("OAuth")
        log.debug("remote MCP connect attempt failed", {
          key,
          transport: transportName,
          attempt,
          retry,
          error: toErrorMessage(error),
        })
        // Auth errors leave the client/transport open so finishAuth can reuse them.
        // Closing the SDK client here would also close the pending OAuth transport.
        if (!authError) {
          await closeIfPossible(client, key, `connect attempt failed (${transportName})`)
        }
        if (!retry) throw error
        await sleep(MCP_CONNECT_RETRY_DELAY_MS)
      }
    }
    throw lastError
  }

  export const Resource = z
    .object({
      name: z.string(),
      uri: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      client: z.string(),
    })
    .meta({ ref: "McpResource" })
  export type Resource = z.infer<typeof Resource>

  const ResourceContentsBase = z.object({
    uri: z.string().optional(),
    mimeType: z.string().optional(),
  })

  export const ReadResourceResult = z
    .object({
      contents: z.array(
        z.union([
          ResourceContentsBase.extend({
            text: z.string(),
          }).passthrough(),
          ResourceContentsBase.extend({
            blob: z.string(),
          }).passthrough(),
        ]),
      ),
    })
    .passthrough()
    .meta({ ref: "McpReadResourceResult" })
  export type ReadResourceResult = z.infer<typeof ReadResourceResult>

  export const ToolsChanged = BusEvent.define(
    "mcp.tools.changed",
    z.object({
      server: z.string(),
    }),
  )

  export const BrowserOpenFailed = BusEvent.define(
    "mcp.browser.open.failed",
    z.object({
      mcpName: z.string(),
      url: z.string(),
    }),
  )

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  type MCPClient = Client

  export const Status = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({
          ref: "MCPStatusConnected",
        }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({
          ref: "MCPStatusDisabled",
        }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusFailed",
        }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({
          ref: "MCPStatusNeedsAuth",
        }),
      z
        .object({
          status: z.literal("needs_client_registration"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusNeedsClientRegistration",
        }),
      z
        .object({
          status: z.literal("needs_trust"),
          fingerprint: z.string(),
          source: z.object({
            kind: Config.McpSourceKind,
            path: z.string().optional(),
            url: z.string().optional(),
          }),
        })
        .meta({
          ref: "MCPStatusNeedsTrust",
        }),
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  // Register notification handlers for MCP client
  function registerNotificationHandlers(client: MCPClient, serverName: string, owner: McpState) {
    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      Instance.bind(async () => {
        if (owner.disposed || owner.clients[serverName] !== client) return
        log.info("tools list changed notification received", { server: serverName })
        Bus.publishDetached(ToolsChanged, { server: serverName })
      }),
    )
  }

  // Store transports for OAuth servers to allow finishing auth
  type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
  type ClosableMcpObject = {
    close?: (() => Promise<unknown>) | undefined
    transport?: unknown
    pid?: unknown
  }

  function processTreePid(target: ClosableMcpObject) {
    if (typeof target.pid === "number") return target.pid
    const transport = isRecord(target.transport) ? target.transport : undefined
    return typeof transport?.pid === "number" ? transport.pid : undefined
  }

  async function closeIfPossible(target: ClosableMcpObject | undefined, mcpName: string, context: string) {
    if (!target || typeof target.close !== "function") {
      return
    }
    const pid = processTreePid(target)
    if (typeof pid === "number") {
      try {
        await killProcessTree(pid)
      } catch (error) {
        log.debug("failed to kill MCP process tree", {
          mcpName,
          context,
          pid,
          error: isErrnoException(error) ? error.code : toErrorMessage(error),
        })
      }
    }
    await target.close().catch((error) => {
      log.debug("failed to close MCP object", { mcpName, context, error })
    })
  }
  const pendingOAuthTransports = new Map<string, TransportWithAuth>()
  const explicitOAuthTransports = new Set<TransportWithAuth>()
  let oauthCallbackUsers = 0
  function oauthFlowKey(mcpName: string, directory = Instance.directory) {
    return `${directory}\0${mcpName}`
  }
  async function closePendingOAuthTransport(mcpName: string, directory = Instance.directory) {
    const key = oauthFlowKey(mcpName, directory)
    const transport = pendingOAuthTransports.get(key)
    pendingOAuthTransports.delete(key)
    if (transport) explicitOAuthTransports.delete(transport)
    await transport?.close?.().catch((error) => {
      log.debug("failed to close pending oauth transport", { mcpName, error })
    })
  }
  async function closePendingOAuthTransportsForDirectory(directory: string) {
    const prefix = `${directory}\0`
    const transports = [...pendingOAuthTransports.entries()].filter(([key]) => key.startsWith(prefix))
    for (const [key, transport] of transports) {
      pendingOAuthTransports.delete(key)
      explicitOAuthTransports.delete(transport)
    }
    await Promise.all(
      transports.map(async ([key, transport]) => {
        await transport.close?.().catch((error) => {
          log.debug("failed to close pending oauth transport", { key, error })
        })
      }),
    )
  }
  async function stopOAuthCallbackIfIdle(context: string) {
    if (oauthCallbackUsers > 0 || explicitOAuthTransports.size > 0) return
    await McpOAuthCallback.stopIfIdle().catch((error) => {
      log.debug("failed to stop idle oauth callback listener", { context, error })
    })
  }
  async function acquireOAuthCallback() {
    oauthCallbackUsers++
    try {
      await McpOAuthCallback.ensureRunning()
    } catch (error) {
      oauthCallbackUsers--
      throw error
    }
  }
  async function releaseOAuthCallback(context: string) {
    oauthCallbackUsers = Math.max(0, oauthCallbackUsers - 1)
    await stopOAuthCallbackIfIdle(context)
  }
  const pendingOAuthState = Instance.state(
    () => ({ directory: Instance.directory }),
    async ({ directory }) => {
      await closePendingOAuthTransportsForDirectory(directory)
      await stopOAuthCallbackIfIdle("instance oauth shutdown")
    },
  )
  // Prompt cache types
  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]

  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]
  export function isConfigured(entry: McpEntry): entry is Config.Mcp {
    return isRecord(entry) && "type" in entry
  }

  type McpState = {
    status: Record<string, Status>
    clients: Record<string, MCPClient>
    /** Set true in the dispose hook so late connect completions drop clients. */
    disposed: boolean
    tools: {
      cached?: Record<string, ConvertedMcpTool>
      pending?: Promise<Record<string, ConvertedMcpTool>>
      unsubscribe?: () => void
      generation: number
    }
    connectQueue: KeyedSerialQueue
    ready: Promise<void>
  }

  const rawState = Instance.state(
    (): McpState => {
      const clients: Record<string, MCPClient> = {}
      const status: Record<string, Status> = {}
      const next: McpState = {
        status,
        clients,
        disposed: false,
        tools: { generation: 0 },
        connectQueue: new KeyedSerialQueue(),
        ready: Promise.resolve(),
      }

      next.ready = (async () => {
        const cfg = await Config.get()
        const config = cfg.mcp ?? {}
        const entries = await Config.mcpEntries()
        await Promise.all(
          Object.entries(config).map(async ([key, mcp]) => {
            if (!isConfigured(mcp)) {
              log.error("Ignoring MCP config entry without type", { key })
              return
            }

            // If disabled by config, mark as disabled without trying to connect
            if (mcp.enabled === false) {
              status[key] = { status: "disabled" }
              return
            }

            const trust = await McpTrust.decision(key, mcp, entries[key]?.source ?? Config.trustedMcpSource("unknown"))
            if (!trust.trusted) {
              if (!next.disposed) status[key] = needsTrustStatus(trust)
              return
            }

            // Log MCP creation failures and record a "failed" status so the
            // user sees why a server isn't connecting.
            const result = await create(key, mcp, next).catch((err) => {
              log.error("MCP server creation failed", { server: key, err })
              if (!next.disposed) {
                status[key] = {
                  status: "failed" as const,
                  error: toErrorMessage(err),
                }
              }
              return undefined
            })
            if (!result) return

            // The synchronous state shell lets disposal mark `disposed` even
            // while startup connection work is still pending.
            if (next.disposed) {
              if (result.mcpClient) {
                await closeIfPossible(result.mcpClient, key, "discard after instance disposal")
              }
              return
            }

            status[key] = result.status

            if (result.mcpClient) {
              clients[key] = result.mcpClient
              registerClientOnClose(key, result.mcpClient, next)
            }
            // Late startup connects must bust any tools() cache built after the
            // bounded first-turn wait, so the next model step sees new servers.
            invalidateTools(next)
          }),
        )
      })()
      return next
    },
    async (mcpState) => {
      mcpState.disposed = true
      mcpState.tools.unsubscribe?.()
      mcpState.tools.unsubscribe = undefined
      invalidateTools(mcpState)
      mcpState.connectQueue.close()
      // Close already-established clients before waiting for startup or
      // admitted queue work. Those operations may take up to the MCP connect
      // timeout, while State disposal has a much smaller per-entry budget.
      // Late clients still observe `disposed` and are closed by their owner
      // callback; the second pass below is a final safety net.
      const establishedClients = Object.entries(mcpState.clients)
      for (const [mcpName, client] of establishedClients) {
        if (mcpState.clients[mcpName] === client) delete mcpState.clients[mcpName]
      }
      await Promise.all(
        establishedClients.map(([mcpName, client]) =>
          closeIfPossible(client, mcpName, "instance shutdown before queue drain"),
        ),
      )
      await mcpState.ready.catch((error) => {
        log.debug("MCP startup settled with an error during instance shutdown", { error: toErrorMessage(error) })
      })
      // clear() alone does not stop already-started or chained queue work.
      // Wait for those owner-bound callbacks to observe `disposed` and settle
      // before closing the final client set.
      await mcpState.connectQueue.drain()
      mcpState.connectQueue.clear()
      await Promise.all(
        Object.entries(mcpState.clients).map(([mcpName, client]) =>
          closeIfPossible(client, mcpName, "instance shutdown"),
        ),
      )
      // The callback listener is process-global and otherwise keeps one-shot
      // commands alive after their instance has been disposed. Do not disrupt
      // an authorization flow owned by another concurrent instance.
      await stopOAuthCallbackIfIdle("instance shutdown")
      // Drop any in-flight connect promises tracked here so a graceful
      // instance shutdown doesn't leave entries pointing at promises
      // that still resolve and try to write to state we just tore down.
      // Self-cleaning via `finally` would still happen, but explicit
      // clear keeps shutdown deterministic and stops confusing post-
      // shutdown error logs from late `connectImpl` writes.
    },
  )

  async function state(): Promise<McpState> {
    const current = rawState()
    try {
      await current.ready
      return current
    } catch (error) {
      await rawState.invalidate()
      throw error
    }
  }

  function invalidateTools(mcpState: McpState) {
    mcpState.tools.cached = undefined
    mcpState.tools.pending = undefined
    mcpState.tools.generation++
  }

  function createClient() {
    return new Client({
      name: "ax-code",
      version: Installation.VERSION,
    })
  }

  function rememberClientTransport(client: MCPClient, transport: unknown) {
    ;(client as { transport?: unknown }).transport ??= transport
  }

  // When a server drops the connection, clear the stale "connected" status and
  // remove the dead client so a later reconnect isn't short-circuited by the
  // early-return in connect() (status === "connected" && clients[name]). This
  // must be wired on EVERY path that stores a client — both the lazy startup
  // bulk-connect in state() and the explicit connect() — otherwise servers
  // connected at startup (the common case) would stall on reconnect.
  function registerClientOnClose(name: string, client: MCPClient, owner: McpState) {
    const s = owner
    client.onclose = Instance.bind(() => {
      void Promise.resolve()
        .then(() => {
          // Capture the owning state instead of calling state() here. A late
          // close callback can fire after Instance disposal; resolving state
          // again would create a zombie MCP state for the disposed directory.
          if (s.disposed) return
          if (s.clients[name] === client) {
            delete s.clients[name]
            s.status[name] = { status: "failed", error: "Server closed the connection" }
            invalidateTools(s)
          }
        })
        .catch((error) => {
          log.warn("MCP client close handler failed", { name, error: toErrorMessage(error) })
        })
    })
  }

  function needsTrustStatus(decision: McpTrust.Decision): Status {
    return {
      status: "needs_trust",
      fingerprint: decision.fingerprint,
      source: {
        kind: decision.source.kind,
        path: decision.source.path,
        url: decision.source.url,
      },
    }
  }

  async function trustDecision(name: string, mcp: Config.Mcp): Promise<McpTrust.Decision> {
    const entry = await Config.mcpEntry(name)
    return McpTrust.decision(name, mcp, entry?.source ?? Config.trustedMcpSource("unknown"))
  }

  // Generic helper for prompts-resources: fetch the array, log on
  // failure, key each item by `clientName:itemName`. Used by both
  // prompts() and resources() — the only thing that varies per call
  // site is the SDK fetcher and the label for the error log.
  function requestTimeout(cfg: { experimental?: { mcp_timeout?: number } }, entry: McpEntry | undefined) {
    const configured = entry && isConfigured(entry) ? entry.timeout : undefined
    return configured ?? cfg.experimental?.mcp_timeout ?? DEFAULT_TIMEOUT
  }

  async function fetchItemsForClient<T extends { name: string }>(
    clientName: string,
    label: string,
    fetcher: () => Promise<T[]>,
    timeout: number,
  ): Promise<Record<string, T & { client: string }> | undefined> {
    const items = await withTimeout(
      fetcher(),
      timeout,
      `listing ${label} timed out for MCP server ${clientName}`,
    ).catch((e) => {
      log.error(`failed to get ${label}`, { clientName, error: NamedError.message(e) })
      return undefined
    })
    if (!items) return
    const result: Record<string, T & { client: string }> = {}
    for (const item of items) {
      const key = mcpItemKey(clientName, item.name)
      result[key] = { ...item, client: clientName }
    }
    return result
  }

  export async function add(name: string, mcp: Config.Mcp) {
    return withConnectLock(name, "MCP add failed", async (s) => {
      const result = await create(name, mcp, s).catch((error) => {
        return { error }
      })
      if (s.disposed) {
        if (!("error" in result) && result.mcpClient) {
          await closeIfPossible(result.mcpClient, name, "discard add after instance disposal")
        }
        return { status: s.status }
      }
      if ("error" in result) {
        const existingClient = s.clients[name]
        delete s.clients[name]
        await closeIfPossible(existingClient, name, "replacement creation failed")
        s.status[name] = { status: "failed", error: NamedError.message(result.error) }
        invalidateTools(s)
        throw result.error
      }
      if (!result.mcpClient) {
        const existingClient = s.clients[name]
        delete s.clients[name]
        await closeIfPossible(existingClient, name, "replacement did not connect")
        s.status[name] = result.status
        invalidateTools(s)
        return {
          status: s.status,
        }
      }
      // Close existing client if present to prevent memory leaks
      const existingClient = s.clients[name]
      if (existingClient) {
        await closeIfPossible(existingClient, name, "replacing existing client")
      }
      if (s.disposed) {
        await closeIfPossible(result.mcpClient, name, "discard replacement after instance disposal")
        return { status: s.status }
      }
      s.clients[name] = result.mcpClient
      registerClientOnClose(name, result.mcpClient, s)
      s.status[name] = result.status
      invalidateTools(s)

      return {
        status: s.status,
      }
    })
  }

  async function create(key: string, mcp: Config.Mcp, owner: McpState) {
    if (mcp.enabled === false) {
      log.info("mcp server disabled", { key })
      return {
        mcpClient: undefined,
        status: { status: "disabled" as const },
      }
    }

    log.info("found", { key, type: mcp.type })
    let mcpClient: MCPClient | undefined
    let status: Status | undefined = undefined

    if (mcp.type === "remote") {
      let callbackListenerStarted = false
      try {
        // OAuth is enabled by default for remote servers unless explicitly disabled with oauth: false
        const oauthDisabled = mcp.oauth === false
        const oauthConfig = isRecord(mcp.oauth) ? mcp.oauth : undefined
        let authProvider: McpOAuthProvider | undefined

        if (!oauthDisabled) {
          // Open callback listener first so the OAuth redirect URI is always bound
          // to a real local port before creating the provider or attempting
          // discovery/registration.
          await acquireOAuthCallback()
          callbackListenerStarted = true

          authProvider = new McpOAuthProvider(
            key,
            mcp.url,
            {
              clientId: oauthConfig?.clientId,
              clientSecret: oauthConfig?.clientSecret,
              scope: oauthConfig?.scope,
            },
            {
              onRedirect: async (url) => {
                log.info("oauth redirect requested", { key, url: url.toString() })
                // Store the URL - actual browser opening is handled by startAuth
              },
            },
          )
        }

        await Ssrf.assertPublicUrl(mcp.url, "mcp")
        const requestInit = remoteRequestInit(mcp.headers)
        const fetch = pinnedMcpFetch("mcp")

        const transports: Array<{ name: string; transport: TransportWithAuth }> = [
          {
            name: "StreamableHTTP",
            transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
              authProvider,
              requestInit,
              fetch,
            }),
          },
          {
            name: "SSE",
            transport: new SSEClientTransport(new URL(mcp.url), {
              authProvider,
              requestInit,
              fetch,
            }),
          },
        ]

        const transportErrors: Array<{ name: string; error: unknown }> = []
        const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
        for (let i = 0; i < transports.length; i++) {
          const { name, transport } = transports[i]!
          try {
            const client = await connectRemoteTransport(transport, key, name, connectTimeout)
            rememberClientTransport(client, transport)
            registerNotificationHandlers(client, key, owner)
            mcpClient = client
            log.info("connected", { key, transport: name })
            status = { status: "connected" }

            // Close transports that were never tried. This keeps constructor-created
            // clients from leaking sockets (notably SSE when StreamableHTTP succeeds).
            for (let j = i + 1; j < transports.length; j++) {
              await transports[j].transport.close?.().catch((e) => {
                log.debug("failed to close unused transport", {
                  key,
                  transport: transports[j].name,
                  error: toErrorMessage(e),
                })
              })
            }
            break
          } catch (error) {
            transportErrors.push({ name, error })
            const failed = toError(error)

            // Handle OAuth-specific errors.
            // The SDK throws UnauthorizedError when auth() returns 'REDIRECT',
            // but may also throw plain Errors when auth() fails internally
            // (e.g. during discovery, registration, or state generation).
            // When an authProvider is attached, treat both cases as auth-related.
            const isAuthError = error instanceof UnauthorizedError || (authProvider && failed.message.includes("OAuth"))
            if (isAuthError) {
              log.info("mcp server requires authentication", { key, transport: name })

              // Check if this is a "needs registration" error — includes the
              // case where the server rejects dynamic registration with a
              // non-JSON body (HTTP 403 Forbidden), which the SDK wraps as a
              // cryptic SyntaxError inside "Invalid OAuth error response".
              if (isDynamicRegistrationRejection(failed.message)) {
                await transport.close?.().catch((e) => {
                  log.debug("failed to close transport after registration rejection", {
                    key,
                    transport: name,
                    error: toErrorMessage(e),
                  })
                })
                status = {
                  status: "needs_client_registration" as const,
                  error: "Server does not support dynamic client registration. Please provide clientId in config.",
                }
                // Show toast for needs_client_registration
                Bus.publishDetached(NotificationEvent.ToastShow, {
                  title: "MCP Authentication Required",
                  message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                  variant: "warning",
                  duration: TOAST_DURATION_LONG_MS,
                })
              } else {
                // needs_auth path: the client/transport will be reused by
                // `finishAuth` once the user completes the OAuth flow.
                // Closing the client here would close the underlying
                // transport too (the SDK chains close), so by the time
                // finishAuth tried to call `transport.finishAuth(code)` the
                // transport would already be dead. Leave both open and only
                // close the *other* untried candidates.
                for (let j = i + 1; j < transports.length; j++) {
                  await transports[j].transport.close?.().catch((e) => {
                    log.debug("failed to close unused transport during auth flow", {
                      key,
                      transport: transports[j].name,
                      error: toErrorMessage(e),
                    })
                  })
                }
                await closePendingOAuthTransport(key)
                pendingOAuthState()
                pendingOAuthTransports.set(oauthFlowKey(key), transport)
                status = { status: "needs_auth" as const }
                // Show toast for needs_auth
                Bus.publishDetached(NotificationEvent.ToastShow, {
                  title: "MCP Authentication Required",
                  message: `Server "${key}" requires authentication. Run: ax-code mcp auth ${key}`,
                  variant: "warning",
                  duration: TOAST_DURATION_LONG_MS,
                })
              }
              break
            }

            // Non-auth error: clean up everything before falling through to
            // the next transport candidate.
            await transport.close?.().catch((e) => {
              log.debug("failed to close transport after connection failure", {
                key,
                transport: name,
                error: toErrorMessage(e),
              })
            })
            log.debug("transport connection failed", {
              key,
              transport: name,
              url: mcp.url,
              error: failed.message,
            })
            status = {
              status: "failed" as const,
              error: combineTransportErrors(transportErrors),
            }
          }
        }
      } finally {
        // Initial capability detection does not wait for a browser callback.
        // Keep the listener only for an explicit authentication flow.
        if (callbackListenerStarted) await releaseOAuthCallback("initial capability detection")
      }
    }

    if (mcp.type === "local") {
      const [cmd, ...args] = mcp.command
      const cwd = Instance.directory
      // Strip provider keys, tokens, passwords, etc. before forwarding
      // the environment to a local MCP server. Community MCP servers
      // are typically installed from npm and run arbitrary code — a
      // compromised server would otherwise read API keys straight out
      // of its own environment. The bash tool applies the same
      // sanitizer to shell commands for identical reasons. MCP-specific
      // secrets can still be passed explicitly via `mcp.environment`, but
      // process-injection variables (LD_PRELOAD, NODE_OPTIONS, …) are
      // always stripped from that overlay.
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...Env.sanitize(process.env),
          ...(cmd === "ax-code" ? { BUN_BE_BUN: "1" } : {}),
          ...Env.stripProcessInjection(mcp.environment),
        },
      })
      const onStderr = (chunk: Buffer) => {
        const line = Env.redactSecrets(chunk.toString().trimEnd()).slice(0, MAX_STDERR_LINE)
        if (line) log.info("mcp stderr", { key, line })
      }
      transport.stderr?.on("data", onStderr)
      const cleanupStderr = () => {
        transport.stderr?.off("data", onStderr)
      }

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      try {
        const client = createClient()
        await withTimeout(client.connect(transport), connectTimeout)
        rememberClientTransport(client, transport)
        registerNotificationHandlers(client, key, owner)
        const close = client.close.bind(client)
        client.close = async () => {
          cleanupStderr()
          return close()
        }
        mcpClient = client
        status = {
          status: "connected",
        }
      } catch (error) {
        log.error("local mcp startup failed", {
          key,
          command: mcp.command,
          cwd,
          error: NamedError.message(error),
        })
        // Kill the subprocess that StdioClientTransport spawned.
        // Without this, a failed connect (timeout, transport error)
        // leaves the MCP server process running orphaned — holding
        // its PID, pipes, and any ports it opened — until the parent
        // ax-code process exits.
        cleanupStderr()
        await transport.close().catch((closeErr) => {
          log.debug("failed to close mcp transport after connect failure", { key, err: closeErr })
        })
        status = {
          status: "failed" as const,
          error: NamedError.message(error),
        }
      }
    }

    if (!status) {
      status = {
        status: "failed" as const,
        error: "Unknown error",
      }
    }

    if (!mcpClient) {
      return {
        mcpClient: undefined,
        status,
      }
    }

    const result = await withTimeout(mcpClient.listTools(), mcp.timeout ?? DEFAULT_TIMEOUT).catch((err) => {
      log.error("failed to get tools from client", { key, error: err })
      return undefined
    })
    if (!result) {
      await closeIfPossible(mcpClient, key, "initial listTools failed")
      return {
        mcpClient: undefined,
        status: {
          status: "failed" as const,
          error: "Failed to get tools",
        },
      }
    }

    log.info("create() successfully created client", { key, toolCount: result.tools.length })
    return {
      mcpClient,
      status,
    }
  }

  export async function status() {
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const result: Record<string, Status> = {}

    // Include all configured MCPs from config, not just connected ones
    for (const [key, mcp] of Object.entries(config)) {
      if (!isConfigured(mcp)) continue
      result[key] = s.status[key] ?? { status: "disabled" }
    }

    return result
  }

  export async function clients() {
    return state().then((state) => state.clients)
  }

  // Per-server connect serialization. Two concurrent connect(name)
  // calls would otherwise each run create() in parallel, then race
  // on `s.clients[name] = result.mcpClient` — the loser's client
  // reference is silently dropped without `.close()`, leaking the
  // child process. The lock scopes to `name` so different servers
  // still connect in parallel.
  async function withConnectLock<T>(name: string, errorLabel: string, fn: (owner: McpState) => Promise<T>) {
    const s = await state()
    if (s.disposed) throw new Error(`MCP instance was disposed before ${name} operation was queued`)
    const next = s.connectQueue.run(name, async () => {
      if (s.disposed) throw new Error(`MCP instance was disposed before ${name} operation started`)
      return fn(s)
    })
    next.catch((err) => {
      log.warn(errorLabel, {
        name,
        error: toErrorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    })
    return next
  }
  export async function connect(name: string) {
    return withConnectLock(name, "MCP connect failed", (s) => connectImpl(name, s))
  }

  async function connectImpl(name: string, s: McpState) {
    invalidateTools(s)
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const mcp = config[name]
    if (!mcp) {
      log.error("MCP config not found", { name })
      return
    }

    if (!isConfigured(mcp)) {
      log.error("Ignoring MCP connect request for config without type", { name })
      return
    }

    const trust = await trustDecision(name, mcp)
    if (!trust.trusted) {
      s.status[name] = needsTrustStatus(trust)
      if (s.clients[name]) {
        await closeIfPossible(s.clients[name], name, "trust revoked")
        delete s.clients[name]
      }
      return
    }

    if (s.disposed) return
    if (s.status[name]?.status === "connected" && s.clients[name]) return

    const result = await create(name, { ...mcp, enabled: true }, s).catch(async (error) => {
      if (s.disposed) throw error
      const existingClient = s.clients[name]
      delete s.clients[name]
      await closeIfPossible(existingClient, name, "reconnect creation failed")
      s.status[name] = { status: "failed", error: NamedError.message(error) }
      throw error
    })

    // Dispose may have raced with create(); never register on a dead instance.
    if (s.disposed) {
      if (result?.mcpClient) {
        await closeIfPossible(result.mcpClient, name, "discard after instance disposal")
      }
      return
    }

    if (!result) {
      const existingClient = s.clients[name]
      delete s.clients[name]
      await closeIfPossible(existingClient, name, "reconnect returned no result")
      s.status[name] = {
        status: "failed",
        error: "Unknown error during connection",
      }
      return
    }

    s.status[name] = result.status
    if (result.mcpClient) {
      // Close existing client if present to prevent memory leaks
      const existingClient = s.clients[name]
      if (existingClient) {
        await closeIfPossible(existingClient, name, "disconnecting existing client")
      }
      s.clients[name] = result.mcpClient
      registerClientOnClose(name, result.mcpClient, s)
    } else {
      const existingClient = s.clients[name]
      delete s.clients[name]
      await closeIfPossible(existingClient, name, "reconnect did not connect")
    }
  }

  export async function disconnect(name: string) {
    return withConnectLock(name, "MCP disconnect failed", async (s) => {
      invalidateTools(s)
      const client = s.clients[name]
      if (client) {
        await closeIfPossible(client, name, "disconnecting")
        delete s.clients[name]
      }
      await closePendingOAuthTransport(name)
      s.status[name] = { status: "disabled" }
    })
  }

  export async function trust(name: string): Promise<Record<string, Status>> {
    const entry = await Config.mcpEntry(name)
    const mcp = entry?.config
    if (!mcp || !isConfigured(mcp)) {
      throw new Error(`MCP server not found: ${name}`)
    }
    await McpTrust.trust(name, mcp, entry.source)
    await connect(name)
    return status()
  }

  export async function untrust(name: string): Promise<Record<string, Status>> {
    const entry = await Config.mcpEntry(name)
    const mcp = entry?.config
    if (!mcp || !isConfigured(mcp)) {
      throw new Error(`MCP server not found: ${name}`)
    }
    const decision = await McpTrust.untrust(name, mcp)
    await withConnectLock(name, "MCP untrust failed", async (s) => {
      invalidateTools(s)
      const client = s.clients[name]
      if (client) {
        await closeIfPossible(client, name, "untrusting")
        delete s.clients[name]
      }
      await closePendingOAuthTransport(name)
      s.status[name] = needsTrustStatus(decision)
    })
    return status()
  }

  async function stateForTools(): Promise<McpState> {
    const current = rawState()
    await Promise.race([
      current.ready.then(
        () => undefined,
        (error) => {
          log.debug("MCP startup settled with an error before tools()", { error: toErrorMessage(error) })
        },
      ),
      sleep(MCP_TOOLS_READY_WAIT_MS),
    ])
    return current
  }

  export async function tools() {
    const s = await stateForTools()
    if (!s.tools.unsubscribe) {
      s.tools.unsubscribe = Bus.subscribe(ToolsChanged, () => {
        // Always invalidate. The previous TTL guard suppressed
        // server-emitted `tools/list_changed` notifications inside a 10s
        // window, leaving the LLM using stale tool definitions until the
        // TTL elapsed. Burst protection is provided by the pending-promise
        // coalescing below — concurrent callers share a single fetch.
        invalidateTools(s)
      })
    }
    if (s.tools.cached) return s.tools.cached
    // Coalesce concurrent callers onto a single in-flight computation.
    // Without this, two simultaneous `tools()` calls would each do a
    // full listTools() roundtrip, and worse: if a client died during
    // the async window, one caller's result could bake a dead client
    // reference into the shared cache while the other completed a
    // clean fetch.
    if (s.tools.pending) return s.tools.pending
    const generation = s.tools.generation
    const promise = (async () => {
      const result: Record<string, ConvertedMcpTool> = {}
      const cfg = await Config.get()
      const config = cfg.mcp ?? {}
      const clientsSnapshot = { ...s.clients }

      const connectedClients = Object.entries(clientsSnapshot).filter(
        ([clientName]) => s.status[clientName]?.status === "connected",
      )

      const toolsResults = await Promise.all(
        connectedClients.map(async ([clientName, client]) => {
          const mcpConfig = config[clientName]
          const entry = isConfigured(mcpConfig) ? mcpConfig : undefined
          const timeout = requestTimeout(cfg, entry)
          const toolsResult = await withTimeout(
            client.listTools(),
            timeout,
            `listing tools timed out for MCP server ${clientName}`,
          ).catch((e) => {
            log.error("failed to get tools", { clientName, error: NamedError.message(e) })
            return { _failed: true as const, error: NamedError.message(e) }
          })
          return { clientName, client, toolsResult }
        }),
      )

      if (s.disposed) return {}

      // Apply state mutations after all concurrent reads complete (BUG-021)
      for (const { clientName, client, toolsResult } of toolsResults) {
        if (toolsResult && "_failed" in toolsResult) {
          // A reconnect may have replaced this snapshot while listTools was
          // pending. Never let the stale request downgrade or close the new
          // connected client.
          if (s.clients[clientName] !== client) continue
          if (s.status[clientName]?.status !== "disabled") {
            s.status[clientName] = { status: "failed" as const, error: (toolsResult as { error: string }).error }
          }
          delete s.clients[clientName]
          await closeIfPossible(client, clientName, "listTools failed")
        }
      }

      const listedTools = toolsResults.flatMap(({ clientName, client, toolsResult }) => {
        if (!toolsResult || "_failed" in toolsResult) return []
        return toolsResult.tools.map((mcpTool) => ({ clientName, client, mcpTool }))
      })
      const permissionKeys = resolveMcpToolPermissionKeys(
        listedTools.map(({ clientName, mcpTool }) => ({ server: clientName, tool: mcpTool.name })),
      )
      const conversions: Promise<void>[] = []
      for (const [index, { clientName, client, mcpTool }] of listedTools.entries()) {
        const mcpConfig = config[clientName]
        const entry = isConfigured(mcpConfig) ? mcpConfig : undefined
        const timeout = requestTimeout(cfg, entry)
        const key = permissionKeys[index]!
        conversions.push(
          convertMcpTool(mcpTool, client, timeout)
            .then((tool) => {
              if (s.disposed || s.clients[clientName] !== client) return
              result[key] = tool
            })
            .catch((e) => {
              const error = NamedError.message(e)
              log.error("failed to convert MCP tool", {
                clientName,
                tool: mcpTool.name,
                error,
              })
              if (!s.disposed && s.clients[clientName] === client) {
                s.status[clientName] = {
                  status: "failed",
                  error: `Failed to convert MCP tool ${mcpTool.name}: ${error}`,
                }
              }
            }),
        )
      }
      await Promise.all(conversions)
      // Only cache if no invalidation occurred during computation
      if (s.tools.generation === generation) {
        s.tools.cached = result
      }
      return result
    })()
    s.tools.pending = promise
    try {
      return await promise
    } finally {
      if (s.tools.pending === promise) s.tools.pending = undefined
    }
  }

  // The established base permission key. Runtime tool enumeration preserves
  // this shape when unique and adds a deterministic hash suffix only when two
  // raw identities sanitize to the same base. listAllTools() exposes the exact
  // resolved key; server wildcards such as "github_*" continue to cover both.
  export function permissionKey(server: string, tool: string): string {
    return mcpToolPermissionKey(server, tool)
  }

  export type ToolListing = {
    server: string
    name: string
    description?: string
    permissionKey: string
  }

  // Enumerate every tool exposed by every CONNECTED MCP server. Unlike
  // `tools()`, this does not convert to AI SDK tool objects, does not
  // cache, and surfaces servers individually so the CLI / tests can
  // group by server. Disconnected / disabled / failed servers are
  // omitted; callers can cross-reference `status()` to surface those.
  export async function listAllTools(): Promise<ToolListing[]> {
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const clientsSnapshot = await clients()
    const results = await Promise.all(
      Object.entries(clientsSnapshot).map(async ([server, client]) => {
        if (s.status[server]?.status !== "connected") return []
        const mcpConfig = config[server]
        const entry = isConfigured(mcpConfig) ? mcpConfig : undefined
        const timeout = requestTimeout(cfg, entry)
        const listed = await withTimeout(
          client.listTools(),
          timeout,
          `listing tools timed out for MCP server ${server}`,
        ).catch((e) => {
          log.error("failed to list tools", { server, error: NamedError.message(e) })
          return undefined
        })
        if (!listed) return []
        return listed.tools.map((t) => ({
          server,
          name: t.name,
          description: t.description,
        }))
      }),
    )
    const tools = results.flat()
    const permissionKeys = resolveMcpToolPermissionKeys(tools.map(({ server, name }) => ({ server, tool: name })))
    return tools.map((tool, index) => ({ ...tool, permissionKey: permissionKeys[index]! }))
  }

  export async function prompts() {
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const clientsSnapshot = await clients()

    const prompts = Object.fromEntries<PromptInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries(
              (await fetchItemsForClient<PromptInfo>(
                clientName,
                "prompts",
                async () => (await client.listPrompts()).prompts,
                requestTimeout(cfg, config[clientName]),
              )) ?? {},
            )
          }),
        )
      ).flat(),
    )

    return prompts
  }

  export async function resources() {
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const clientsSnapshot = await clients()

    const result = Object.fromEntries<ResourceInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries(
              (await fetchItemsForClient<ResourceInfo>(
                clientName,
                "resources",
                async () => (await client.listResources()).resources,
                requestTimeout(cfg, config[clientName]),
              )) ?? {},
            )
          }),
        )
      ).flat(),
    )

    return result
  }

  export async function getPrompt(clientName: string, name: string, args?: Record<string, string>) {
    const clientsSnapshot = await clients()
    const s = await state()
    const client = clientsSnapshot[clientName]

    if (!client || s.status[clientName]?.status !== "connected") {
      log.warn("client not found for prompt", {
        clientName,
      })
      return undefined
    }

    const cfg = await Config.get()
    const timeout = requestTimeout(cfg, cfg.mcp?.[clientName])
    const result = await withTimeout(
      client.getPrompt({
        name: name,
        arguments: args,
      }),
      timeout,
      `getting prompt timed out for MCP server ${clientName}`,
    ).catch((e) => {
      log.error("failed to get prompt from MCP server", {
        clientName,
        promptName: name,
        error: NamedError.message(e),
      })
      return undefined
    })

    return result
  }

  export async function readResource(clientName: string, resourceUri: string) {
    const clientsSnapshot = await clients()
    const s = await state()
    const client = clientsSnapshot[clientName]

    if (!client || s.status[clientName]?.status !== "connected") {
      log.warn("client not found for resource", {
        clientName: clientName,
      })
      return undefined
    }

    const cfg = await Config.get()
    const timeout = requestTimeout(cfg, cfg.mcp?.[clientName])
    const result = await withTimeout(
      client.readResource({
        uri: resourceUri,
      }),
      timeout,
      `reading resource timed out for MCP server ${clientName}`,
    ).catch((e) => {
      log.error("failed to read resource from MCP server", {
        clientName: clientName,
        resourceUri: resourceUri,
        error: NamedError.message(e),
      })
      return undefined
    })

    return result
  }

  /**
   * Start OAuth authentication flow for an MCP server.
   * Returns the authorization URL that should be opened in a browser.
   */
  export async function startAuth(mcpName: string): Promise<{ authorizationUrl: string; oauthState?: string }> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]

    if (!mcpConfig) {
      throw new Error(`MCP server not found: ${mcpName}`)
    }

    if (!isConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }

    if (mcpConfig.type !== "remote") {
      throw new Error(`MCP server ${mcpName} is not a remote server`)
    }

    const trust = await trustDecision(mcpName, mcpConfig)
    if (!trust.trusted) {
      throw new Error(`MCP server ${mcpName} requires trust before authentication`)
    }

    // SSRF guard: validate the URL before initiating OAuth flow (BUG-003)
    await Ssrf.assertPublicUrl(mcpConfig.url, "mcp-auth")

    if (mcpConfig.oauth === false) {
      throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
    }

    // Hold a listener lease during discovery/registration so concurrent MCP
    // probes cannot stop or rebind the callback port mid-flow.
    await acquireOAuthCallback()
    try {
      const oauthState =
        (await McpAuth.getOAuthState(mcpName)) ??
        Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      await McpAuth.updateOAuthState(mcpName, oauthState)

      // Create a new auth provider for this flow
      // OAuth config is optional - if not provided, we'll use auto-discovery
      const oauthConfig = isRecord(mcpConfig.oauth) ? mcpConfig.oauth : undefined
      let capturedUrl: URL | undefined
      const authProvider = new McpOAuthProvider(
        mcpName,
        mcpConfig.url,
        {
          clientId: oauthConfig?.clientId,
          clientSecret: oauthConfig?.clientSecret,
          scope: oauthConfig?.scope,
        },
        {
          onRedirect: async (url) => {
            capturedUrl = url
          },
        },
        oauthState,
      )

      // Create transport with auth provider
      const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
        authProvider,
        requestInit: remoteRequestInit(mcpConfig.headers),
        fetch: pinnedMcpFetch("mcp-auth"),
      })
      const client = createClient()

      // Try to connect - this will trigger the OAuth flow
      try {
        await withTimeout(client.connect(transport), mcpConfig.timeout ?? DEFAULT_TIMEOUT)
        // If we get here, we're already authenticated.
        await transport.close?.().catch((e) => {
          log.debug("failed to close transport after successful auth", { mcpName, error: toErrorMessage(e) })
        })
        await closeIfPossible(client, mcpName, "startAuth authenticated")
        await McpAuth.clearOAuthState(mcpName).catch((e) => {
          log.debug("failed to clear OAuth state after successful auth", { mcpName, error: toErrorMessage(e) })
        })
        return { authorizationUrl: "", oauthState }
      } catch (error) {
        if (!error) {
          throw new Error("Unknown OAuth error")
        }
        if (error instanceof UnauthorizedError && capturedUrl) {
          // Store transport for finishAuth
          await closePendingOAuthTransport(mcpName)
          pendingOAuthState()
          pendingOAuthTransports.set(oauthFlowKey(mcpName), transport)
          explicitOAuthTransports.add(transport)
          return { authorizationUrl: capturedUrl.toString(), oauthState }
        }
        // Clear stale OAuth state so retry starts fresh
        await McpAuth.clearOAuthState(mcpName).catch((e) => {
          log.debug("failed to clear stale OAuth state", { mcpName, error: toErrorMessage(e) })
        })
        await transport.close?.().catch((e) => {
          log.debug("failed to close transport during error recovery", { mcpName, error: toErrorMessage(e) })
        })
        await closeIfPossible(client, mcpName, "startAuth error recovery")
        // Surface an actionable message when dynamic client registration was
        // rejected with a non-JSON body (e.g. Figma returns HTTP 403
        // "Forbidden" and the SDK wraps it as a SyntaxError).
        const errMsg = toErrorMessage(error)
        if (isDynamicRegistrationRejection(errMsg)) {
          throw new Error(
            `Dynamic client registration was rejected by "${mcpName}". ` +
              `The server may require a pre-registered client ID — provide oauth.clientId and oauth.clientSecret in your MCP config.`,
          )
        }
        throw error
      }
    } finally {
      await releaseOAuthCallback("startAuth setup completed")
    }
  }

  /**
   * Complete OAuth authentication after user authorizes in browser.
   * Opens the browser and waits for callback.
   */
  export async function authenticate(mcpName: string): Promise<Status> {
    try {
      const { authorizationUrl, oauthState } = await startAuth(mcpName)

      if (!authorizationUrl) {
        // Already authenticated
        const s = await state()
        return s.status[mcpName] ?? { status: "connected" }
      }

      if (!oauthState) {
        throw new Error("OAuth state not found - this should not happen")
      }

      // The SDK has already added the state parameter to the authorization URL
      // We just need to open the browser
      log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

      // Register the callback BEFORE opening the browser to avoid race condition
      // when the IdP has an active SSO session and redirects immediately
      const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, oauthFlowKey(mcpName))

      try {
        const subprocess = await open(authorizationUrl)
        // The open package spawns a detached process and returns immediately.
        // We need to listen for errors which fire asynchronously:
        // - "error" event: command not found (ENOENT)
        // - "exit" with non-zero code: command exists but failed (e.g., no display)
        await new Promise<void>((resolve, reject) => {
          const proc = subprocess as unknown as {
            on(event: "error", listener: (error: Error) => void): void
            on(event: "exit", listener: (code: number | null) => void): void
          }
          // Give the process a moment to fail if it's going to
          const timeout = setTimeout(() => resolve(), 500)
          proc.on("error", (error) => {
            clearTimeout(timeout)
            reject(error)
          })
          proc.on("exit", (code) => {
            if (code !== null && code !== 0) {
              clearTimeout(timeout)
              reject(new Error(`Browser open failed with exit code ${code}`))
            }
          })
        })
      } catch (error) {
        // Browser opening failed (e.g., in remote/headless sessions like SSH, devcontainers)
        // Emit event so CLI can display the URL for manual opening
        log.warn("failed to open browser, user must open URL manually", { mcpName, error })
        Bus.publishDetached(BrowserOpenFailed, { mcpName, url: authorizationUrl })
      }

      // Wait for callback using the already-registered promise
      const code = await callbackPromise

      // The callback waiter already validated the state against the request that
      // initiated this flow. Only clear the persisted state if it still matches
      // this flow so a concurrent replacement flow does not get torn down here.
      await McpAuth.clearOAuthStateIfMatches(mcpName, oauthState)

      // Finish auth
      return await finishAuth(mcpName, code)
    } catch (error) {
      await closePendingOAuthTransport(mcpName)
      throw error
    } finally {
      await stopOAuthCallbackIfIdle("authenticate completed")
    }
  }

  /**
   * Complete OAuth authentication with the authorization code.
   */
  export async function finishAuth(mcpName: string, authorizationCode: string): Promise<Status> {
    const key = oauthFlowKey(mcpName)
    const transport = pendingOAuthTransports.get(key)

    if (!transport) {
      throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)
    }

    try {
      // Call finishAuth on the transport
      await transport.finishAuth(authorizationCode)

      // Clear the code verifier after successful auth
      await McpAuth.clearCodeVerifier(mcpName)

      // Now try to reconnect
      const cfg = await Config.get()
      const mcpConfig = cfg.mcp?.[mcpName]

      if (!mcpConfig) {
        throw new Error(`MCP server not found: ${mcpName}`)
      }

      if (!isConfigured(mcpConfig)) {
        throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
      }

      // Re-add the MCP server to establish connection
      const result = await add(mcpName, mcpConfig)

      const statusRecord = result.status as Record<string, Status>
      return statusRecord[mcpName] ?? { status: "failed", error: "Unknown error after auth" }
    } catch (error) {
      log.error("failed to finish oauth", { mcpName, error })
      return {
        status: "failed",
        error: NamedError.message(error),
      }
    } finally {
      if (pendingOAuthTransports.get(key) === transport) {
        pendingOAuthTransports.delete(key)
      }
      explicitOAuthTransports.delete(transport)
      await transport.close?.().catch((e) => {
        log.debug("failed to close transport after finishAuth", { mcpName, error: toErrorMessage(e) })
      })
      await stopOAuthCallbackIfIdle("finishAuth completed")
    }
  }

  /**
   * Remove OAuth credentials for an MCP server.
   */
  export async function removeAuth(mcpName: string): Promise<void> {
    await McpAuth.remove(mcpName)
    McpOAuthCallback.cancelPending(oauthFlowKey(mcpName))
    await closePendingOAuthTransport(mcpName)
    await stopOAuthCallbackIfIdle("removeAuth completed")
    log.info("removed oauth credentials", { mcpName })
  }

  /**
   * Check if an MCP server supports OAuth (remote servers support OAuth by default unless explicitly disabled).
   */
  export async function supportsOAuth(mcpName: string): Promise<boolean> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]
    if (!mcpConfig) return false
    if (!isConfigured(mcpConfig)) return false
    return mcpConfig.type === "remote" && mcpConfig.oauth !== false
  }

  /**
   * Check if an MCP server has stored OAuth tokens.
   */
  export async function hasStoredTokens(mcpName: string): Promise<boolean> {
    const entry = await McpAuth.get(mcpName)
    return !!entry?.tokens
  }

  export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

  /**
   * Get the authentication status for an MCP server.
   */
  export async function getAuthStatus(mcpName: string): Promise<AuthStatus> {
    const hasTokens = await hasStoredTokens(mcpName)
    if (!hasTokens) return "not_authenticated"
    const expired = await McpAuth.isTokenExpired(mcpName)
    return expired ? "expired" : "authenticated"
  }
}
