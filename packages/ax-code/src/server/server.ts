import { Log } from "../util/log"
import { describeRoute, generateSpecs, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Provider } from "../provider/provider"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { ProviderID } from "../provider/schema"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { EventRoutes } from "./routes/event"
import { InstanceBootstrap } from "../project/bootstrap"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { serve as runtimeServe, type ServerHandle } from "./runtime-adapter"
import { appErrorEnvelope, errors, forbidden } from "./error"
import { validator } from "./validation"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { AuditRoutes } from "./routes/audit"
import { GraphRoutes } from "./routes/graph"
import { DreGraphRoutes } from "./routes/dre-graph"
import { IsolationRoutes } from "./routes/isolation"
import { AutonomousRoutes } from "./routes/autonomous"
import { SmartLlmRoutes } from "./routes/smart-llm"
import { SuperLongRoutes } from "./routes/super-long"
import { PromptHistoryRoutes } from "./routes/prompt-history"
import { TaskQueueRoutes } from "./routes/task-queue"
import { ScheduledTaskRoutes } from "./routes/scheduled-task"
import { WorkflowRoutineRoutes, WorkflowRunRoutes, WorkflowTemplateRoutes } from "./routes/workflow"
import { GlobalRoutes } from "./routes/global"
import { AppContextRoutes } from "./routes/app-context"
import { AppRoutes } from "./routes/app"
import { SkillRoutes } from "./routes/skill"
import { RuntimeStatusRoutes } from "./routes/runtime-status"
import { PROVIDER_ID_PARAM, withProviderID } from "./routes/route-params"
import { MDNS } from "./mdns"
import { lazy } from "@/util/lazy"
import {
  assertAuthenticatedNetworkBind,
  formatHostnameForUrl,
  isLoopbackHostname,
  normalizeLoopbackHostname,
  normalizeLoopbackHttpOrigin,
} from "./listen-security"
import { toErrorMessage } from "../util/error-message"
import { requestDirectory } from "./request-directory"
import { createRateLimitMiddleware, createRequestLoggingMiddleware } from "./middleware"
import { DEFAULT_SERVER_PORT } from "./constants"
import { ServerRuntimeAuth } from "./runtime-auth"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

function isSameLoopbackListenerOrigin(originRaw: string, requestRaw: string): boolean {
  try {
    const origin = new URL(originRaw)
    const request = new URL(requestRaw)
    return (
      (origin.protocol === "http:" || origin.protocol === "https:") &&
      origin.protocol === request.protocol &&
      origin.port === request.port &&
      isLoopbackHostname(origin.hostname) &&
      isLoopbackHostname(request.hostname)
    )
  } catch {
    return false
  }
}

export namespace Server {
  const log = Log.create({ service: "server" })
  const activeServerUrls = new Set<string>()

  export function currentUrl() {
    // The in-process client works without a listening socket. Only expose a
    // bound URL when there is a single unambiguous listener.
    if (activeServerUrls.size === 1) return new URL(activeServerUrls.values().next().value!)
    return new URL(`http://localhost:${DEFAULT_SERVER_PORT}`)
  }

  export const Default = lazy(() => createApp({ port: DEFAULT_SERVER_PORT }))

  async function invalidateProviderState(directory: string) {
    await Instance.provide({
      directory,
      init: InstanceBootstrap,
      fn: () => Provider.invalidate(),
    })
  }

  async function updateProviderAuth(
    c: Context,
    providerID: ProviderID,
    updater: (providerID: ProviderID) => Promise<void>,
  ) {
    const directory = requestDirectory(c)
    if (directory instanceof Response) return directory
    await updater(providerID)
    // Invalidate the per-directory provider cache so the next
    // `Provider.list()` re-reads auth and picks up this update
    // without requiring a process restart. See issue #13.
    await invalidateProviderState(directory)
    return c.json(true)
  }

  export function allowHttpDocs(opts: { hostname?: string }) {
    return isLoopbackHostname(opts.hostname ?? "127.0.0.1") || Flag.AX_CODE_ENABLE_HTTP_DOCS
  }

  export function validateListenPort(port: unknown): number {
    if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("Server listen port must be an integer between 0 and 65535")
    }
    return port
  }

  export const createApp = (opts: {
    port?: number
    hostname?: string
    cors?: string[]
    /** Require the process-local runtime token on every non-preflight route. */
    runtimeAuth?: boolean
  }): Hono => {
    const app = new Hono()
    const allowedCors = (opts.cors ?? [])
      .map(normalizeLoopbackHttpOrigin)
      .filter((origin): origin is string => origin !== null)
    const openApiHandler = openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "AX Code",
          version: "0.0.3",
          description: "AX Code API",
        },
        openapi: "3.1.1",
      },
    })
    return app
      .onError((err, c) => {
        const logRef = `err_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
        const envelope = appErrorEnvelope({ error: err, logRef })
        log.error("failed", {
          logRef,
          status: envelope.status,
          errorName: envelope.name,
          error: err,
        })
        return c.json(envelope, { status: envelope.status as ContentfulStatusCode })
      })
      .use(async (c, next) => {
        if (!opts.runtimeAuth || c.req.method === "OPTIONS") return next()
        return ServerRuntimeAuth.require(c) ?? next()
      })
      .use((c, next) => {
        // Allow CORS preflight requests to succeed without auth.
        // Browser clients sending Authorization headers will preflight with OPTIONS.
        if (c.req.method === "OPTIONS") return next()
        // The process-local bridge already passed the stronger unguessable
        // runtime-token middleware above. Do not also require a user-configured
        // server password that the private sidecar does not need to know.
        if (opts.runtimeAuth) return next()
        const password = Flag.AX_CODE_SERVER_PASSWORD
        if (!password) return next()
        const username = Flag.AX_CODE_SERVER_USERNAME ?? "ax-code"
        return basicAuth({ username, password })(c, next)
      })
      .use(async (c, next) => {
        if (c.req.method === "OPTIONS") return next()
        const origin = c.req.header("origin")
        const browserPrivilegedRequest =
          ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) ||
          c.req.header("upgrade")?.toLowerCase() === "websocket"
        if (origin && browserPrivilegedRequest) {
          if (!isSameLoopbackListenerOrigin(origin, c.req.url) && !allowedCors.includes(origin)) {
            return forbidden(c, { message: "Origin mismatch" })
          }
        }
        return next()
      })
      .use(createRateLimitMiddleware(log))
      .use(createRequestLoggingMiddleware(log))
      .use(
        cors({
          origin(input, c) {
            if (!input) return
            if (isSameLoopbackListenerOrigin(input, c.req.url)) return input
            if (allowedCors.includes(input)) return input

            return
          },
        }),
      )
      .route("/global", GlobalRoutes())
      .put(
        "/auth/:providerID",
        describeRoute({
          summary: "Set auth credentials",
          description: "Set authentication credentials",
          operationId: "auth.set",
          responses: {
            200: {
              description: "Successfully set authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator("param", PROVIDER_ID_PARAM),
        validator("json", Auth.Info.zod),
        withProviderID(async (providerID, c) => {
          const info = c.req.valid("json")
          return updateProviderAuth(c, providerID, (nextProviderID) => Auth.set(nextProviderID, info))
        }),
      )
      .delete(
        "/auth/:providerID",
        describeRoute({
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
          operationId: "auth.remove",
          responses: {
            200: {
              description: "Successfully removed authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator("param", PROVIDER_ID_PARAM),
        withProviderID(async (providerID, c) => {
          return updateProviderAuth(c, providerID, Auth.remove)
        }),
      )
      .use(async (c, next) => {
        if (c.req.path === "/log") return next()
        // Validate the directory before it becomes Instance.directory
        // — the containment root that every file tool measures
        // symlink escapes against. Without this, a request with
        // `?directory=/` or `?directory=/etc` would silently grant
        // the full filesystem (or a sensitive subtree) as the
        // project root, bypassing the per-tool sandbox. Reject
        // non-absolute paths, non-existent paths, and non-directory
        // paths with a 400. Defaulted `process.cwd()` values are
        // always trusted (no user input involved).
        const directory = requestDirectory(c)
        if (directory instanceof Response) return directory
        return Instance.provide({
          directory,
          init: InstanceBootstrap,
          async fn() {
            return next()
          },
        })
      })
      .get("/doc", async (c, next) => {
        if (!allowHttpDocs(opts)) {
          return c.json(
            {
              error:
                "HTTP API documentation is disabled for non-loopback server binds. Set AX_CODE_ENABLE_HTTP_DOCS=1 to enable it.",
            },
            403,
          )
        }
        return openApiHandler(c, next)
      })
      .use(
        validator(
          "query",
          z.object({
            directory: z.string().optional(),
          }),
        ),
      )
      .route("/project", ProjectRoutes())
      .route("/pty", PtyRoutes())
      .route("/config", ConfigRoutes())
      .route("/isolation", IsolationRoutes())
      .route("/autonomous", AutonomousRoutes())
      .route("/smart-llm", SmartLlmRoutes())
      .route("/super-long", SuperLongRoutes())
      .route("/prompt-history", PromptHistoryRoutes())
      .route("/task-queue", TaskQueueRoutes())
      .route("/scheduled-task", ScheduledTaskRoutes())
      .route("/workflow-runs", WorkflowRunRoutes())
      .route("/workflow-templates", WorkflowTemplateRoutes())
      .route("/workflow-routines", WorkflowRoutineRoutes())
      .route("/experimental", ExperimentalRoutes())
      .route("/session", SessionRoutes())
      .route("/permission", PermissionRoutes())
      .route("/audit", AuditRoutes())
      .route("/graph", GraphRoutes())
      .route("/dre-graph", DreGraphRoutes())
      .route("/question", QuestionRoutes())
      .route("/provider", ProviderRoutes())
      .route("/", FileRoutes())
      .route("/", EventRoutes())
      .route("/mcp", McpRoutes())
      .route("/tui", TuiRoutes())
      .route("/", AppRoutes())
      .route("/context", AppContextRoutes())
      .route("/skill", SkillRoutes())
      .route("/", RuntimeStatusRoutes())
  }

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(Default(), {
      documentation: {
        info: {
          title: "ax-code",
          version: "1.0.0",
          description: "ax-code api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export async function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
    app?: Hono
  }) {
    const port = validateListenPort(opts.port)
    const hostname = normalizeLoopbackHostname(opts.hostname)
    assertAuthenticatedNetworkBind(hostname)
    // Warn loudly when Basic Auth is sent over plaintext to a non-loopback
    // bind. Credentials can be sniffed/replayed on a LAN or by a MITM. The
    // safe default is loopback; for network mode we recommend TLS or a
    // reverse proxy. See #250.
    if (!isLoopbackHostname(hostname) && Flag.AX_CODE_SERVER_PASSWORD && !Flag.AX_CODE_ALLOW_INSECURE_NETWORK_AUTH) {
      log.warn(
        `Server is binding to non-loopback address ${hostname} using plaintext HTTP Basic Auth. ` +
          "Credentials can be intercepted on the network. Use TLS / a reverse proxy, or set AX_CODE_ALLOW_INSECURE_NETWORK_AUTH=1 to acknowledge and suppress this warning.",
      )
    }
    const app = opts.app ?? createApp({ ...opts, hostname })
    let server: ServerHandle
    if (port === 0) {
      try {
        server = await runtimeServe({ app, hostname, port: DEFAULT_SERVER_PORT, idleTimeout: 0 })
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
        if (code !== "EADDRINUSE") {
          throw new Error(`Failed to start server on port ${DEFAULT_SERVER_PORT}: ${toErrorMessage(error)}`)
        }
        log.warn("default server port is in use; falling back to an ephemeral port", {
          port: DEFAULT_SERVER_PORT,
          hostname,
        })
        server = await runtimeServe({ app, hostname, port: 0, idleTimeout: 0 })
      }
    } else {
      try {
        server = await runtimeServe({ app, hostname, port, idleTimeout: 0 })
      } catch (error) {
        throw new Error(`Failed to start server on port ${port}: ${toErrorMessage(error)}`)
      }
    }
    const serverUrl = new URL(`http://${formatHostnameForUrl(hostname)}:${server.port}`)
    activeServerUrls.add(serverUrl.toString())
    const shouldPublishMDNS = opts.mdns && server.port && !isLoopbackHostname(hostname)
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      try {
        await originalStop(closeActiveConnections)
      } finally {
        activeServerUrls.delete(serverUrl.toString())
      }
    }

    return server
  }
}
