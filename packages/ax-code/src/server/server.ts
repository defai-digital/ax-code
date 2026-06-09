import { Log } from "../util/log"
import { describeRoute, generateSpecs, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Provider } from "../provider/provider"
import { LSP } from "../lsp"
import { DebugEngine } from "../debug-engine"
import { CodeIntelligence } from "../code-intelligence"
import { AutoIndex } from "../code-intelligence/auto-index"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import {
  buildSkillDoctorReport,
  buildSkillTriggerReport,
  buildSkillValidationReport,
  createSkill,
  SkillCreateRequest,
  SkillCreateResult,
  SkillDoctorReport,
  SkillExistsError,
  SkillInputError,
  SkillPathError,
  SkillTriggerReport,
  SkillTriggerRequest,
  SkillValidationReport,
} from "../skill/authoring"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Capability } from "../capability"
import { Global } from "../global"
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
import { HTTPException } from "hono/http-exception"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
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
import { PROVIDER_ID_PARAM, withProviderID } from "./routes/route-params"
import { ToolRegistry } from "../tool/registry"
import { MDNS } from "./mdns"
import { lazy } from "@/util/lazy"
import { assertAuthenticatedNetworkBind, isLoopbackHostname } from "./listen-security"
import { toErrorMessage } from "../util/error-message"
import { requestDirectory } from "./request-directory"
import { createRateLimitMiddleware, createRequestLoggingMiddleware } from "./middleware"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

function clean(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()
}

const EXTRA_MAX_DEPTH = 5
const EXTRA_MAX_KEYS = 50

function cleanExtra(value: unknown, depth = 0): unknown {
  if (depth > EXTRA_MAX_DEPTH) return "[truncated]"
  if (typeof value === "string") return clean(value)
  if (Array.isArray(value)) return value.slice(0, EXTRA_MAX_KEYS).map((v) => cleanExtra(v, depth + 1))
  if (value && typeof value === "object") {
    const entries = Object.entries(value).slice(0, EXTRA_MAX_KEYS)
    return Object.fromEntries(entries.map(([key, item]) => [clean(key), cleanExtra(item, depth + 1)]))
  }
  return value
}

export namespace Server {
  const log = Log.create({ service: "server" })

  export const Default = lazy(() => createApp({ port: 4096 }))

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

  export const createApp = (opts: { port?: number; hostname?: string; cors?: string[] }): Hono => {
    const app = new Hono()
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
      .use((c, next) => {
        // Allow CORS preflight requests to succeed without auth.
        // Browser clients sending Authorization headers will preflight with OPTIONS.
        if (c.req.method === "OPTIONS") return next()
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
          const request = new URL(c.req.url).origin
          if (origin !== request && !opts?.cors?.includes(origin)) {
            return forbidden(c, { message: "Origin mismatch" })
          }
        }
        return next()
      })
      .use(createRateLimitMiddleware(log))
      .use(createRequestLoggingMiddleware(log))
      .use(
        cors({
          origin(input) {
            if (!input) return

            const boundPort = Number(url?.port ?? "")
            const serverPort =
              Number.isFinite(boundPort) && boundPort > 0
                ? boundPort
                : opts?.port && opts.port > 0
                  ? opts.port
                  : undefined
            if (serverPort === undefined) return
            const serverOrigins = [`http://localhost:${serverPort}`, `http://127.0.0.1:${serverPort}`]
            if (serverOrigins.includes(input)) return input
            if (opts?.cors?.includes(input)) return input

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
      .post(
        "/instance/dispose",
        describeRoute({
          summary: "Dispose instance",
          description: "Clean up and dispose the current ax-code instance, releasing all resources.",
          operationId: "instance.dispose",
          responses: {
            200: {
              description: "Instance disposed",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await Instance.dispose()
          return c.json(true)
        },
      )
      .post(
        "/instance/restart",
        describeRoute({
          summary: "Restart instance",
          description: "Dispose and reinitialize the ax-code instance, reloading all configuration and provider data.",
          operationId: "instance.restart",
          responses: {
            200: {
              description: "Instance restarted",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await Instance.reload({
            directory: Instance.directory,
            init: InstanceBootstrap,
          })
          return c.json(true)
        },
      )
      .get(
        "/path",
        describeRoute({
          summary: "Get paths",
          description: "Retrieve the current working directory and related path information for the ax-code instance.",
          operationId: "path.get",
          responses: {
            200: {
              description: "Path",
              content: {
                "application/json": {
                  schema: resolver(
                    z
                      .object({
                        home: z.string(),
                        state: z.string(),
                        config: z.string(),
                        worktree: z.string(),
                        directory: z.string(),
                      })
                      .meta({
                        ref: "Path",
                      }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json({
            home: Global.Path.home,
            state: Global.Path.state,
            config: Global.Path.config,
            worktree: Instance.worktree,
            directory: Instance.directory,
          })
        },
      )
      .get(
        "/vcs",
        describeRoute({
          summary: "Get VCS info",
          description: "Retrieve version control system (VCS) information for the current project, such as git branch.",
          operationId: "vcs.get",
          responses: {
            200: {
              description: "VCS info",
              content: {
                "application/json": {
                  schema: resolver(Vcs.Info),
                },
              },
            },
          },
        }),
        async (c) => {
          const branch = await Vcs.branch()
          return c.json({
            branch,
          })
        },
      )
      .get(
        "/command",
        describeRoute({
          summary: "List commands",
          description: "Get a list of all available commands in the ax-code system.",
          operationId: "command.list",
          responses: {
            200: {
              description: "List of commands",
              content: {
                "application/json": {
                  schema: resolver(Command.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const commands = await Command.list()
          return c.json(commands)
        },
      )
      .get(
        "/capability",
        describeRoute({
          summary: "List capabilities",
          description: "Get a unified catalog of reusable commands, skills, agents, and workflow templates.",
          operationId: "capability.list",
          responses: {
            200: {
              description: "List of capabilities",
              content: {
                "application/json": {
                  schema: resolver(Capability.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const capabilities = await Capability.list()
          return c.json(capabilities)
        },
      )
      .post(
        "/log",
        describeRoute({
          summary: "Write log",
          description: "Write a log entry to the server logs with specified level and metadata.",
          operationId: "app.log",
          responses: {
            200: {
              description: "Log entry written successfully",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "json",
          z.object({
            service: z
              .string()
              .max(64)
              .regex(/^[a-zA-Z0-9._-]+$/)
              .meta({ description: "Service name for the log entry" }),
            level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
            message: z.string().max(10000).meta({ description: "Log message" }),
            extra: z
              .record(z.string(), z.any())
              .optional()
              .meta({ description: "Additional metadata for the log entry" }),
          }),
        ),
        async (c) => {
          const { service, level, message, extra } = c.req.valid("json")
          const logger = Log.create({ service })
          const text = clean(message)
          const metadata = {
            source: "client",
            ...(extra ? { extra: cleanExtra(extra) } : {}),
          }

          switch (level) {
            case "debug":
              logger.debug(text, metadata)
              break
            case "info":
              logger.info(text, metadata)
              break
            case "error":
              logger.error(text, metadata)
              break
            case "warn":
              logger.warn(text, metadata)
              break
          }

          return c.json(true)
        },
      )
      .route("/context", AppContextRoutes())
      .get(
        "/agent",
        describeRoute({
          summary: "List agents",
          description: "Get a list of all available AI agents in the ax-code system.",
          operationId: "app.agents",
          responses: {
            200: {
              description: "List of agents",
              content: {
                "application/json": {
                  schema: resolver(Agent.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const modes = await Agent.list()
          return c.json(modes)
        },
      )
      .get(
        "/skill",
        describeRoute({
          summary: "List skills",
          description: "Get a list of all available skills in the ax-code system.",
          operationId: "app.skills",
          responses: {
            200: {
              description: "List of skills",
              content: {
                "application/json": {
                  schema: resolver(Skill.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const skills = await Skill.all()
          return c.json(skills)
        },
      )
      .get(
        "/skill/validate",
        describeRoute({
          summary: "Validate skills",
          description: "Validate discovered skills against the Agent Skills standard.",
          operationId: "skill.validate",
          responses: {
            200: {
              description: "Skill validation report",
              content: {
                "application/json": {
                  schema: resolver(SkillValidationReport),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(buildSkillValidationReport(await Skill.all()))
        },
      )
      .get(
        "/skill/doctor",
        describeRoute({
          summary: "Diagnose skills",
          description: "Diagnose discovered skills, source breakdown, and compatibility metadata.",
          operationId: "skill.doctor",
          responses: {
            200: {
              description: "Skill doctor report",
              content: {
                "application/json": {
                  schema: resolver(SkillDoctorReport),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(buildSkillDoctorReport(await Skill.all()))
        },
      )
      .post(
        "/skill/test-trigger",
        describeRoute({
          summary: "Test skill triggers",
          description: "Show which skills would be recommended for the given file paths.",
          operationId: "skill.testTrigger",
          responses: {
            200: {
              description: "Skill trigger report",
              content: {
                "application/json": {
                  schema: resolver(SkillTriggerReport),
                },
              },
            },
          },
        }),
        validator("json", SkillTriggerRequest),
        async (c) => {
          const { files } = c.req.valid("json")
          return c.json(buildSkillTriggerReport(await Skill.all(), files.filter(Boolean)))
        },
      )
      .post(
        "/skill",
        describeRoute({
          summary: "Create skill",
          description: "Create a local Agent Skill skeleton in the current worktree.",
          operationId: "skill.create",
          responses: {
            200: {
              description: "Created skill",
              content: {
                "application/json": {
                  schema: resolver(SkillCreateResult),
                },
              },
            },
            ...errors(400, 409),
          },
        }),
        validator("json", SkillCreateRequest),
        async (c) => {
          try {
            return c.json(await createSkill(c.req.valid("json")))
          } catch (error) {
            if (error instanceof SkillExistsError) throw new HTTPException(409, { message: error.message })
            if (error instanceof SkillPathError || error instanceof SkillInputError) {
              throw new HTTPException(400, { message: error.message })
            }
            throw error
          }
        },
      )
      .get(
        "/lsp",
        describeRoute({
          summary: "Get LSP status",
          description: "Get LSP server status",
          operationId: "lsp.status",
          responses: {
            200: {
              description: "LSP server status",
              content: {
                "application/json": {
                  schema: resolver(LSP.Status.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(await LSP.status())
        },
      )
      .get(
        "/debug-engine/pending-plans",
        describeRoute({
          summary: "DRE status and pending refactor plans",
          description:
            "Return the current project's pending refactor plans plus DRE health information (graph node count, last-indexed timestamp, registered tool count). The TUI footer uses the plans count for its chip; the TUI sidebar uses the graph and tool fields to render the DRE section empty state so users can tell at a glance whether DRE is ready to use. Fields default to zero / null when the experimental DRE flag is off, so callers can poll unconditionally. The `graph` and `toolCount` fields were added in v2.3.6 — older clients ignore unknown fields and continue to work against the original `{ count, plans }` shape.",
          operationId: "debugEngine.pendingPlans",
          responses: {
            200: {
              description: "DRE status + pending refactor plans",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      count: z.number(),
                      plans: z.array(
                        z.object({
                          planId: z.string(),
                          kind: z.string(),
                          risk: z.string(),
                          summary: z.string(),
                          affectedFileCount: z.number(),
                          affectedSymbolCount: z.number(),
                          timeCreated: z.number(),
                        }),
                      ),
                      // v2.3.6 additions — surface DRE readiness in the TUI sidebar.
                      toolCount: z.number(),
                      graph: z.object({
                        nodeCount: z.number(),
                        edgeCount: z.number(),
                        lastIndexedAt: z.number().nullable(),
                        // v2.3.13 additions — surface in-progress and failed
                        // auto-index runs so the sidebar can distinguish
                        // "not indexed, about to start" from "indexing"
                        // from "indexing failed, here's why".
                        state: z.union([z.literal("idle"), z.literal("indexing"), z.literal("failed")]),
                        completed: z.number(),
                        total: z.number(),
                        error: z.string().nullable(),
                      }),
                    }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          // Silent no-op when the flag is off so the TUI can poll
          // unconditionally without branching on flag state. The v2.3.6
          // fields (`toolCount`, `graph`) default to zero / null so the
          // sidebar renders a coherent "DRE disabled" empty state
          // without any flag branching on the client.
          if (!Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE) {
            return c.json({
              count: 0,
              plans: [],
              toolCount: 0,
              graph: {
                nodeCount: 0,
                edgeCount: 0,
                lastIndexedAt: null,
                state: "idle" as const,
                completed: 0,
                total: 0,
                error: null,
              },
            })
          }
          const projectID = Instance.project.id
          const plans = DebugEngine.listPlans(projectID, { status: "pending", limit: 25 })
          const DRE_TOOL_COUNT = ToolRegistry.debugEngineToolCount()
          const graph = CodeIntelligence.status(projectID)
          if (graph.nodeCount === 0) {
            try {
              AutoIndex.maybeStart(projectID)
            } catch {
              // Best-effort only: the status endpoint must never fail
              // just because background indexing could not be scheduled.
            }
          }
          const indexState = AutoIndex.getState(projectID)
          return c.json({
            count: plans.length,
            plans: plans.map((p) => ({
              planId: p.planId as unknown as string,
              kind: p.kind,
              risk: p.risk,
              // Trim the markdown summary for list display — the full
              // summary is still available via getPlan if a caller wants it.
              summary: p.summary.split("\n").slice(0, 2).join("\n"),
              affectedFileCount: p.affectedFiles.length,
              affectedSymbolCount: p.affectedSymbols.length,
              timeCreated: p.explain.indexedAt,
            })),
            toolCount: DRE_TOOL_COUNT,
            graph: {
              nodeCount: graph.nodeCount,
              edgeCount: graph.edgeCount,
              lastIndexedAt: graph.lastUpdated,
              state: indexState.state,
              completed: indexState.completed,
              total: indexState.total,
              error: indexState.error,
            },
          })
        },
      )
      .get(
        "/formatter",
        describeRoute({
          summary: "Get formatter status",
          description: "Get formatter status",
          operationId: "formatter.status",
          responses: {
            200: {
              description: "Formatter status",
              content: {
                "application/json": {
                  schema: resolver(Format.Status.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(await Format.status())
        },
      )
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

  /** @deprecated do not use this dumb shit */
  export let url: URL

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }) {
    assertAuthenticatedNetworkBind(opts.hostname)
    const app = createApp(opts)
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
      websocket: websocket,
    } as const
    let lastServeError: unknown
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch (e) {
        lastServeError = e
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) {
      const reason = toErrorMessage(lastServeError)
      throw new Error(`Failed to start server on port ${opts.port}: ${reason}`)
    }
    url = new URL(`http://${opts.hostname}:${server.port}`)

    const shouldPublishMDNS = opts.mdns && server.port && !isLoopbackHostname(opts.hostname)
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
