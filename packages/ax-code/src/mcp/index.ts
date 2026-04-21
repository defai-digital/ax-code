import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { Process } from "../util/process"
import { Env } from "../util/env"
import { NamedError } from "@ax-code/util/error"
import z from "zod/v4"
import { Instance } from "../project/instance"
import { Installation } from "../installation"
import { withTimeout } from "@/util/timeout"
import { Ssrf } from "@/util/ssrf"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import open from "open"

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000

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
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  // Register notification handlers for MCP client
  function registerNotificationHandlers(client: MCPClient, serverName: string) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      log.info("tools list changed notification received", { server: serverName })
      Bus.publishDetached(ToolsChanged, { server: serverName })
    })
  }

  // Convert MCP tool definition to AI SDK Tool type
  async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Promise<Tool> {
    const inputSchema = mcpTool.inputSchema

    // Spread first, then override type to ensure it's always "object"
    const schema: JSONSchema7 = {
      ...(inputSchema as JSONSchema7),
      type: "object",
      properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }

    return dynamicTool({
      description: mcpTool.description ?? "",
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) => {
        try {
          return await client.callTool(
            {
              name: mcpTool.name,
              arguments: (args || {}) as Record<string, unknown>,
            },
            CallToolResultSchema,
            {
              resetTimeoutOnProgress: true,
              timeout,
            },
          )
        } catch (e) {
          log.error("MCP tool call failed", { tool: mcpTool.name, error: e instanceof Error ? e.message : String(e) })
          throw e
        }
      },
    })
  }

  // Store transports for OAuth servers to allow finishing auth
  type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
  const pendingOAuthTransports = new Map<string, TransportWithAuth>()
  async function closePendingOAuthTransport(mcpName: string) {
    const transport = pendingOAuthTransports.get(mcpName)
    pendingOAuthTransports.delete(mcpName)
    await transport?.close?.().catch((error) => {
      log.debug("failed to close pending oauth transport", { mcpName, error })
    })
  }
  async function closeAllPendingOAuthTransports() {
    const transports = [...pendingOAuthTransports.entries()]
    pendingOAuthTransports.clear()
    await Promise.all(
      transports.map(async ([mcpName, transport]) => {
        await transport.close?.().catch((error) => {
          log.debug("failed to close pending oauth transport", { mcpName, error })
        })
      }),
    )
  }
  const pendingOAuthTransportCleanup = Instance.state(
    () => true,
    async () => {
      await closeAllPendingOAuthTransports()
    },
  )

  // Prompt cache types
  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]

  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]
  function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
    return typeof entry === "object" && entry !== null && "type" in entry
  }

  async function descendants(pid: number): Promise<number[]> {
    if (process.platform === "win32") return []
    const pids: number[] = []
    const seen = new Set<number>()
    const queue = [pid]
    while (queue.length > 0) {
      const current = queue.shift()!
      const lines = await Process.lines(["pgrep", "-P", String(current)], { nothrow: true })
      for (const tok of lines) {
        const cpid = parseInt(tok, 10)
        // O(1) Set lookup instead of O(n) array.includes. For build
        // systems that spawn hundreds of descendant processes the
        // previous quadratic scan noticeably slowed MCP shutdown.
        if (!isNaN(cpid) && !seen.has(cpid)) {
          seen.add(cpid)
          pids.push(cpid)
          queue.push(cpid)
        }
      }
    }
    return pids
  }

  const state = Instance.state(
    async () => {
      const cfg = await Config.get()
      const config = cfg.mcp ?? {}
      const clients: Record<string, MCPClient> = {}
      const status: Record<string, Status> = {}

      await Promise.all(
        Object.entries(config).map(async ([key, mcp]) => {
          if (!isMcpConfigured(mcp)) {
            log.error("Ignoring MCP config entry without type", { key })
            return
          }

          // If disabled by config, mark as disabled without trying to connect
          if (mcp.enabled === false) {
            status[key] = { status: "disabled" }
            return
          }

          // Log MCP creation failures and record a "failed" status so
          // the user sees why a server isn't connecting. Previously
          // this swallowed all errors into `undefined`, leaving
          // misconfigured MCP servers silently missing from the status
          // map with no feedback at all.
          const result = await create(key, mcp).catch((err) => {
            log.error("MCP server creation failed", { server: key, err })
            status[key] = {
              status: "failed" as const,
              error: err instanceof Error ? err.message : String(err),
            }
            return undefined
          })
          if (!result) return

          status[key] = result.status

          if (result.mcpClient) {
            clients[key] = result.mcpClient
          }
        }),
      )
      return {
        status,
        clients,
      }
    },
    async (state) => {
      // The MCP SDK only signals the direct child process on close.
      // Servers like chrome-devtools-mcp spawn grandchild processes
      // (e.g. Chrome) that the SDK never reaches, leaving them orphaned.
      // Kill the full descendant tree first so the server exits promptly
      // and no processes are left behind.
      for (const client of Object.values(state.clients)) {
        const pid = (client.transport as { pid?: number })?.pid
        if (typeof pid !== "number") continue
        for (const dpid of await descendants(pid)) {
          try {
            process.kill(dpid, "SIGTERM")
          } catch (e: any) {
            if (e?.code !== "ESRCH") log.debug("failed to kill descendant", { dpid, error: e?.code })
          }
        }
      }

      await Promise.all(
        Object.values(state.clients).map((client) =>
          client.close().catch((error) => {
            log.error("Failed to close MCP client", {
              error,
            })
          }),
        ),
      )
      toolsCacheUnsub?.()
      toolsCacheUnsub = undefined
      toolsCacheSubscribed = false
      cachedTools = undefined
      toolsPromise = undefined
      await closeAllPendingOAuthTransports()
    },
  )

  // MCP identifiers (client name, tool name, prompt name, resource
  // name) can contain characters that aren't valid in the registry
  // keys the agent layer expects — slashes, spaces, colons, etc. We
  // replace every non-alphanumeric / non-underscore / non-hyphen
  // byte with `_`. The rule must be identical for tools, prompts,
  // and resources: if it drifts, a prompt's lookup key stops
  // matching the client's registration and the feature silently
  // breaks. Extracted so the rule has exactly one definition.
  // See issue #14.
  function sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_")
  }

  // Helper function to fetch prompts for a specific client
  async function fetchPromptsForClient(clientName: string, client: Client) {
    const prompts = await client.listPrompts().catch((e) => {
      log.error("failed to get prompts", { clientName, error: NamedError.message(e) })
      return undefined
    })

    if (!prompts) {
      return
    }

    const commands: Record<string, PromptInfo & { client: string }> = {}

    for (const prompt of prompts.prompts) {
      const key = sanitize(clientName) + ":" + sanitize(prompt.name)

      commands[key] = { ...prompt, client: clientName }
    }
    return commands
  }

  async function fetchResourcesForClient(clientName: string, client: Client) {
    const resources = await client.listResources().catch((e) => {
      log.error("failed to get resources", { clientName, error: NamedError.message(e) })
      return undefined
    })

    if (!resources) {
      return
    }

    const commands: Record<string, ResourceInfo & { client: string }> = {}

    for (const resource of resources.resources) {
      const key = sanitize(clientName) + ":" + sanitize(resource.name)

      commands[key] = { ...resource, client: clientName }
    }
    return commands
  }

  export async function add(name: string, mcp: Config.Mcp) {
    const s = await state()
    const result = await create(name, mcp)
    if (!result) {
      const status = {
        status: "failed" as const,
        error: "unknown error",
      }
      s.status[name] = status
      return {
        status: s.status,
      }
    }
    if (!result.mcpClient) {
      s.status[name] = result.status
      return {
        status: s.status,
      }
    }
    // Close existing client if present to prevent memory leaks
    const existingClient = s.clients[name]
    if (existingClient) {
      await existingClient.close().catch((error) => {
        log.error("Failed to close existing MCP client", { name, error })
      })
    }
    s.clients[name] = result.mcpClient
    s.status[name] = result.status
    cachedTools = undefined
    toolsCacheGeneration++

    return {
      status: s.status,
    }
  }

  async function create(key: string, mcp: Config.Mcp) {
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
      // OAuth is enabled by default for remote servers unless explicitly disabled with oauth: false
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
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

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
          }),
        },
      ]

      let lastError: Error | undefined
      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      for (const { name, transport } of transports) {
        try {
          const client = new Client({
            name: "ax-code",
            version: Installation.VERSION,
          })
          await withTimeout(client.connect(transport), connectTimeout)
          registerNotificationHandlers(client, key)
          mcpClient = client
          log.info("connected", { key, transport: name })
          status = { status: "connected" }
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

          // Handle OAuth-specific errors.
          // The SDK throws UnauthorizedError when auth() returns 'REDIRECT',
          // but may also throw plain Errors when auth() fails internally
          // (e.g. during discovery, registration, or state generation).
          // When an authProvider is attached, treat both cases as auth-related.
          const isAuthError =
            error instanceof UnauthorizedError || (authProvider && lastError.message.includes("OAuth"))
          if (isAuthError) {
            log.info("mcp server requires authentication", { key, transport: name })

            // Check if this is a "needs registration" error
            if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
              await transport.close?.().catch(() => {})
              status = {
                status: "needs_client_registration" as const,
                error: "Server does not support dynamic client registration. Please provide clientId in config.",
              }
              // Show toast for needs_client_registration
              Bus.publishDetached(TuiEvent.ToastShow, {
                title: "MCP Authentication Required",
                message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                variant: "warning",
                duration: 8000,
              })
            } else {
              // Store transport for later finishAuth call
              pendingOAuthTransportCleanup()
              pendingOAuthTransports.set(key, transport)
              status = { status: "needs_auth" as const }
              // Show toast for needs_auth
              Bus.publishDetached(TuiEvent.ToastShow, {
                title: "MCP Authentication Required",
                message: `Server "${key}" requires authentication. Run: ax-code mcp auth ${key}`,
                variant: "warning",
                duration: 8000,
              })
            }
            break
          }

          await transport.close?.().catch(() => {})
          log.debug("transport connection failed", {
            key,
            transport: name,
            url: mcp.url,
            error: lastError.message,
          })
          status = {
            status: "failed" as const,
            error: lastError.message,
          }
        }
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
      // secrets can still be passed explicitly via `mcp.environment`.
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command: cmd,
        args,
        cwd,
        env: {
          ...Env.sanitize(process.env),
          ...(cmd === "ax-code" ? { BUN_BE_BUN: "1" } : {}),
          ...mcp.environment,
        },
      })
      const onStderr = (chunk: Buffer) => {
        const line = chunk.toString().trimEnd()
        if (line) log.info("mcp stderr", { key, line })
      }
      transport.stderr?.on("data", onStderr)
      const cleanupStderr = () => {
        transport.stderr?.off("data", onStderr)
      }

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      try {
        const client = new Client({
          name: "ax-code",
          version: Installation.VERSION,
        })
        await withTimeout(client.connect(transport), connectTimeout)
        registerNotificationHandlers(client, key)
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
      await mcpClient.close().catch((error) => {
        log.error("Failed to close MCP client", {
          error,
        })
      })
      status = {
        status: "failed",
        error: "Failed to get tools",
      }
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
      if (!isMcpConfigured(mcp)) continue
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
  const connectLocks = new Map<string, Promise<unknown>>()
  export async function connect(name: string) {
    const prev = connectLocks.get(name) ?? Promise.resolve()
    const next = prev.then(() => connectImpl(name), () => connectImpl(name))
    const locked = next.catch((err) => {
      log.warn("MCP connect failed", { name, error: err instanceof Error ? err.message : String(err) })
    }).finally(() => {
      // Clean up settled entries to prevent unbounded Map growth
      if (connectLocks.get(name) === locked) connectLocks.delete(name)
    })
    connectLocks.set(name, locked)
    return next
  }

  async function connectImpl(name: string) {
    cachedTools = undefined
    toolsCacheGeneration++
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const mcp = config[name]
    if (!mcp) {
      log.error("MCP config not found", { name })
      return
    }

    if (!isMcpConfigured(mcp)) {
      log.error("Ignoring MCP connect request for config without type", { name })
      return
    }

    const result = await create(name, { ...mcp, enabled: true })

    if (!result) {
      const s = await state()
      s.status[name] = {
        status: "failed",
        error: "Unknown error during connection",
      }
      return
    }

    const s = await state()
    s.status[name] = result.status
    if (result.mcpClient) {
      // Close existing client if present to prevent memory leaks
      const existingClient = s.clients[name]
      if (existingClient) {
        await existingClient.close().catch((error) => {
          log.error("Failed to close existing MCP client", { name, error })
        })
      }
      s.clients[name] = result.mcpClient
    }
  }

  export async function disconnect(name: string) {
    cachedTools = undefined
    toolsCacheGeneration++
    const s = await state()
    const client = s.clients[name]
    if (client) {
      await client.close().catch((error) => {
        log.error("Failed to close MCP client", { name, error })
      })
      delete s.clients[name]
    }
    s.status[name] = { status: "disabled" }
  }

  let cachedTools: Record<string, Tool> | undefined
  let toolsPromise: Promise<Record<string, Tool>> | undefined
  let toolsCacheSubscribed = false
  let toolsCacheUnsub: (() => void) | undefined
  let toolsCacheGeneration = 0
  let toolsCacheTime = 0
  const TOOLS_CACHE_TTL_MS = 10_000 // Minimum time between tool re-fetches

  export async function tools() {
    if (!toolsCacheSubscribed) {
      toolsCacheSubscribed = true
      toolsCacheUnsub = Bus.subscribe(ToolsChanged, () => {
        // Respect TTL: if cache was just populated, defer invalidation
        if (cachedTools && Date.now() - toolsCacheTime < TOOLS_CACHE_TTL_MS) return
        cachedTools = undefined
        toolsPromise = undefined
        toolsCacheGeneration++
      })
    }
    if (cachedTools) return cachedTools
    // Coalesce concurrent callers onto a single in-flight computation.
    // Without this, two simultaneous `tools()` calls would each do a
    // full listTools() roundtrip, and worse: if a client died during
    // the async window, one caller's result could bake a dead client
    // reference into the shared cache while the other completed a
    // clean fetch.
    if (toolsPromise) return toolsPromise
    const generation = toolsCacheGeneration
    toolsPromise = (async () => {
      const result: Record<string, Tool> = {}
      const s = await state()
      const cfg = await Config.get()
      const config = cfg.mcp ?? {}
      const clientsSnapshot = await clients()
      const defaultTimeout = cfg.experimental?.mcp_timeout

      const connectedClients = Object.entries(clientsSnapshot).filter(
        ([clientName]) => s.status[clientName]?.status === "connected",
      )

      const toolsResults = await Promise.all(
        connectedClients.map(async ([clientName, client]) => {
          const toolsResult = await client.listTools().catch((e) => {
            log.error("failed to get tools", { clientName, error: NamedError.message(e) })
            return { _failed: true as const, error: NamedError.message(e) }
          })
          return { clientName, client, toolsResult }
        }),
      )

      // Apply state mutations after all concurrent reads complete (BUG-021)
      for (const { clientName, toolsResult } of toolsResults) {
        if (toolsResult && "_failed" in toolsResult) {
          s.status[clientName] = { status: "failed" as const, error: (toolsResult as { error: string }).error }
          delete s.clients[clientName]
        }
      }

      const conversions: Promise<void>[] = []
      for (const { clientName, client, toolsResult } of toolsResults) {
        if (!toolsResult || "_failed" in toolsResult) continue
        const mcpConfig = config[clientName]
        const entry = isMcpConfigured(mcpConfig) ? mcpConfig : undefined
        const timeout = entry?.timeout ?? defaultTimeout
        for (const mcpTool of toolsResult.tools) {
          const key = sanitize(clientName) + "_" + sanitize(mcpTool.name)
          conversions.push(convertMcpTool(mcpTool, client, timeout).then((tool) => { result[key] = tool }).catch((e) => {
            log.error("failed to convert MCP tool", { clientName, tool: mcpTool.name, error: NamedError.message(e) })
          }))
        }
      }
      await Promise.all(conversions)
      // Only cache if no invalidation occurred during computation
      if (toolsCacheGeneration === generation) {
        cachedTools = result
        toolsCacheTime = Date.now()
      }
      return result
    })()
    const currentPromise = toolsPromise
    try {
      return await currentPromise
    } finally {
      if (toolsPromise === currentPromise) toolsPromise = undefined
    }
  }

  export async function prompts() {
    const s = await state()
    const clientsSnapshot = await clients()

    const prompts = Object.fromEntries<PromptInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchPromptsForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return prompts
  }

  export async function resources() {
    const s = await state()
    const clientsSnapshot = await clients()

    const result = Object.fromEntries<ResourceInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchResourcesForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return result
  }

  export async function getPrompt(clientName: string, name: string, args?: Record<string, string>) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName,
      })
      return undefined
    }

    const result = await client
      .getPrompt({
        name: name,
        arguments: args,
      })
      .catch((e) => {
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
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName: clientName,
      })
      return undefined
    }

    const result = await client
      .readResource({
        uri: resourceUri,
      })
      .catch((e) => {
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
  export async function startAuth(mcpName: string): Promise<{ authorizationUrl: string }> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]

    if (!mcpConfig) {
      throw new Error(`MCP server not found: ${mcpName}`)
    }

    if (!isMcpConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }

    if (mcpConfig.type !== "remote") {
      throw new Error(`MCP server ${mcpName} is not a remote server`)
    }

    // SSRF guard: validate the URL before initiating OAuth flow (BUG-003)
    await Ssrf.assertPublicUrl(mcpConfig.url, "mcp-auth")

    if (mcpConfig.oauth === false) {
      throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
    }

    // Start the callback server
    await McpOAuthCallback.ensureRunning()

    const oauthState =
      (await McpAuth.getOAuthState(mcpName)) ??
      Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    await McpAuth.updateOAuthState(mcpName, oauthState)

    // Create a new auth provider for this flow
    // OAuth config is optional - if not provided, we'll use auto-discovery
    const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
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
    )

    // Create transport with auth provider
    const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
      authProvider,
    })

    // Try to connect - this will trigger the OAuth flow
    try {
      const client = new Client({
        name: "ax-code",
        version: Installation.VERSION,
      })
      await client.connect(transport)
      // If we get here, we're already authenticated
      return { authorizationUrl: "" }
    } catch (error) {
      if (error instanceof UnauthorizedError && capturedUrl) {
        // Store transport for finishAuth
        pendingOAuthTransportCleanup()
        pendingOAuthTransports.set(mcpName, transport)
        return { authorizationUrl: capturedUrl.toString() }
      }
      await transport.close?.().catch(() => {})
      throw error
    }
  }

  /**
   * Complete OAuth authentication after user authorizes in browser.
   * Opens the browser and waits for callback.
   */
  export async function authenticate(mcpName: string): Promise<Status> {
    const { authorizationUrl } = await startAuth(mcpName)

    if (!authorizationUrl) {
      // Already authenticated
      const s = await state()
      return s.status[mcpName] ?? { status: "connected" }
    }

    // Get the state that was already generated and stored in startAuth()
    const oauthState = await McpAuth.getOAuthState(mcpName)
    if (!oauthState) {
      throw new Error("OAuth state not found - this should not happen")
    }

    // The SDK has already added the state parameter to the authorization URL
    // We just need to open the browser
    log.info("opening browser for oauth", { mcpName, url: authorizationUrl, state: oauthState })

    // Register the callback BEFORE opening the browser to avoid race condition
    // when the IdP has an active SSO session and redirects immediately
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

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

    // Validate and clear the state
    const storedState = await McpAuth.getOAuthState(mcpName)
    if (storedState !== oauthState) {
      await McpAuth.clearOAuthState(mcpName)
      throw new Error("OAuth state mismatch - potential CSRF attack")
    }

    await McpAuth.clearOAuthState(mcpName)

    // Finish auth
    return finishAuth(mcpName, code)
  }

  /**
   * Complete OAuth authentication with the authorization code.
   */
  export async function finishAuth(mcpName: string, authorizationCode: string): Promise<Status> {
    const transport = pendingOAuthTransports.get(mcpName)

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

      if (!isMcpConfigured(mcpConfig)) {
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
      await closePendingOAuthTransport(mcpName)
    }
  }

  /**
   * Remove OAuth credentials for an MCP server.
   */
  export async function removeAuth(mcpName: string): Promise<void> {
    await McpAuth.remove(mcpName)
    McpOAuthCallback.cancelPending(mcpName)
    await closePendingOAuthTransport(mcpName)
    await McpAuth.clearOAuthState(mcpName)
    log.info("removed oauth credentials", { mcpName })
  }

  /**
   * Check if an MCP server supports OAuth (remote servers support OAuth by default unless explicitly disabled).
   */
  export async function supportsOAuth(mcpName: string): Promise<boolean> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]
    if (!mcpConfig) return false
    if (!isMcpConfigured(mcpConfig)) return false
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
