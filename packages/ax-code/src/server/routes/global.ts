import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import { streamSSE } from "hono/streaming"
import z from "zod"
import semver from "semver"
import { Bus } from "../../bus"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { AsyncQueue } from "@/util/queue"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Config } from "../../config/config"
import { redactConfig, stripRedactedConfig } from "./config"
import { errors, invalidRequest } from "../error"
import { pushSseFrame } from "../sse-queue"
import { Event } from "../event"
import { ServiceManager } from "@/runtime/service-manager"
import { Filesystem } from "@/util/filesystem"

const log = Log.create({ service: "server" })
const SERVER_STARTED_AT = Date.now()

const HealthServiceInfo = z.object({
  name: z.string(),
  state: ServiceManager.ServiceState,
  pendingTasks: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().optional(),
  stoppedAt: z.number().int().nonnegative().optional(),
  lastError: z.string().optional(),
})

const GlobalHealthInfo = z.object({
  healthy: z.literal(true),
  version: z.string(),
  startup: z.object({
    startedAt: z.number().int().nonnegative(),
    uptimeMs: z.number().int().nonnegative(),
    checkedAt: z.number().int().nonnegative(),
  }),
  readiness: z.object({
    processAlive: z.literal(true),
    apiReady: z.literal(true),
    providersReady: z.enum(["ready", "degraded", "unknown"]),
    indexReady: z.enum(["ready", "degraded", "unknown"]),
  }),
  runtime: z.object({
    directory: z.string(),
    services: z.array(HealthServiceInfo),
    taskSummary: z.object({
      queued: z.number().int().nonnegative(),
      running: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      aborted: z.number().int().nonnegative(),
    }),
  }),
})

const GlobalCapabilitiesInfo = z.object({
  schemaVersion: z.literal(1),
  product: z.literal("ax-code"),
  version: z.string(),
  compatibility: z.object({
    minDesktopVersion: z.string().nullable(),
    sdkHeadless: z.object({
      schemaVersion: z.literal(1),
      supportsManagedLifecycle: z.literal(true),
      supportsExplicitBinary: z.literal(true),
      supportsExplicitArgs: z.literal(true),
      supportsStructuredDiagnostics: z.literal(true),
      authSchemes: z.array(z.literal("basic")),
      defaultTransport: z.literal("http-sse"),
    }),
  }),
  endpoints: z.object({
    health: z.literal("/global/health"),
    events: z.literal("/global/event"),
    config: z.literal("/global/config"),
    capabilityCatalog: z.literal("/capability"),
    fileSearch: z.literal("/find/file"),
    sessions: z.literal("/session"),
    providers: z.literal("/config/providers"),
    agents: z.literal("/agent"),
  }),
  features: z.object({
    sessions: z.literal(true),
    asyncPrompt: z.literal(true),
    globalEvents: z.literal(true),
    fileSearch: z.literal(true),
    skills: z.literal(true),
    plugins: z.literal(true),
    mcp: z.literal(true),
    worktrees: z.literal(true),
    providerManagement: z.literal(true),
    usage: z.literal(true),
  }),
  events: z.object({
    heartbeat: z.literal("server.heartbeat"),
    connected: z.literal("server.connected"),
    sessionCreated: z.literal("session.created"),
    sessionStatus: z.literal("session.status"),
    sessionError: z.literal("session.error"),
    permission: z.literal("permission"),
    question: z.literal("question"),
  }),
})

function getRuntimeHealthInfo(rawDirectory?: string): z.infer<typeof GlobalHealthInfo>["runtime"] {
  const directory = Filesystem.resolve(rawDirectory || process.cwd())
  const snapshot = ServiceManager.peek(directory)?.snapshot() ?? ServiceManager.createSnapshot()
  const taskSummary = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    aborted: 0,
  }
  for (const task of snapshot.tasks) {
    taskSummary[task.state]++
  }
  return {
    directory,
    services: snapshot.services.map((service) => ({
      name: service.name,
      state: service.state,
      pendingTasks: service.pendingTasks,
      startedAt: service.startedAt,
      stoppedAt: service.stoppedAt,
      lastError: service.lastError,
    })),
    taskSummary,
  }
}

function readinessFromServices(runtime: z.infer<typeof GlobalHealthInfo>["runtime"], serviceNames: string[]) {
  const names = new Set(serviceNames)
  const services = runtime.services.filter((service) => names.has(service.name))
  const tasks =
    ServiceManager.peek(runtime.directory)
      ?.snapshot()
      .tasks.filter((task) => names.has(task.service)) ?? []
  if (
    services.some((service) => service.state === "failed" || service.lastError) ||
    tasks.some((task) => task.state === "failed")
  ) {
    return "degraded" as const
  }
  if (tasks.some((task) => task.state === "queued" || task.state === "running")) {
    return "unknown" as const
  }
  if (tasks.some((task) => task.state === "completed") || services.some((service) => service.state === "running")) {
    return "ready" as const
  }
  return "unknown" as const
}

function getGlobalHealthInfo(rawDirectory?: string): z.infer<typeof GlobalHealthInfo> {
  const checkedAt = Date.now()
  const runtime = getRuntimeHealthInfo(rawDirectory)
  return {
    healthy: true,
    version: Installation.VERSION,
    startup: {
      startedAt: SERVER_STARTED_AT,
      uptimeMs: Math.max(0, checkedAt - SERVER_STARTED_AT),
      checkedAt,
    },
    readiness: {
      processAlive: true,
      apiReady: true,
      providersReady: readinessFromServices(runtime, ["Provider.warmup"]),
      indexReady: readinessFromServices(runtime, ["LSP.init", "LSP.prewarmWorkspace"]),
    },
    runtime,
  }
}

function getGlobalCapabilitiesInfo(): z.infer<typeof GlobalCapabilitiesInfo> {
  return {
    schemaVersion: 1,
    product: "ax-code",
    version: Installation.VERSION,
    compatibility: {
      minDesktopVersion: null,
      sdkHeadless: {
        schemaVersion: 1,
        supportsManagedLifecycle: true,
        supportsExplicitBinary: true,
        supportsExplicitArgs: true,
        supportsStructuredDiagnostics: true,
        authSchemes: ["basic"],
        defaultTransport: "http-sse",
      },
    },
    endpoints: {
      health: "/global/health",
      events: "/global/event",
      config: "/global/config",
      capabilityCatalog: "/capability",
      fileSearch: "/find/file",
      sessions: "/session",
      providers: "/config/providers",
      agents: "/agent",
    },
    features: {
      sessions: true,
      asyncPrompt: true,
      globalEvents: true,
      fileSearch: true,
      skills: true,
      plugins: true,
      mcp: true,
      worktrees: true,
      providerManagement: true,
      usage: true,
    },
    events: {
      heartbeat: "server.heartbeat",
      connected: "server.connected",
      sessionCreated: "session.created",
      sessionStatus: "session.status",
      sessionError: "session.error",
      permission: "permission",
      question: "question",
    },
  }
}

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the ax-code server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(GlobalHealthInfo),
              },
            },
          },
        },
      }),
      async (c) => {
        const directory = c.req.query("directory")
        if (directory?.includes("\0")) {
          return invalidRequest(c, { message: "Directory contains null byte", details: { resource: "directory" } })
        }
        return c.json(getGlobalHealthInfo(directory))
      },
    )
    .get(
      "/capabilities",
      describeRoute({
        summary: "Get runtime capabilities",
        description:
          "Get stable runtime capability metadata for desktop and app integrations. This endpoint describes supported API contracts; use /capability for user-facing commands, skills, agents, and workflows.",
        operationId: "global.capabilities",
        responses: {
          200: {
            description: "Runtime capability metadata",
            content: {
              "application/json": {
                schema: resolver(GlobalCapabilitiesInfo),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(getGlobalCapabilitiesInfo())
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the ax-code system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      payload: BusEvent.payloads(),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          const q = new AsyncQueue<string | null>()
          let done = false
          let heartbeat: ReturnType<typeof setInterval> | undefined

          const stop = () => {
            if (done) return
            done = true
            if (heartbeat) clearInterval(heartbeat)
            try {
              GlobalBus.off("event", handler)
            } finally {
              q.push(null)
            }
            log.info("global event disconnected")
          }

          const push = (event: any) => {
            if (done) return
            if (pushSseFrame(q, event) === "overflow") stop()
          }

          // Control frames (server.connected, server.heartbeat) bypass the
          // data-frame overflow limit so a near-cap burst of real events
          // can't tear down the connection on an otherwise-fine heartbeat.
          const CONTROL_FRAME_QUEUE_LIMIT = 256
          const pushControl = (payload: unknown) => {
            if (q.size >= CONTROL_FRAME_QUEUE_LIMIT) return
            q.push(JSON.stringify(payload))
          }

          pushControl({
            payload: {
              type: Event.Connected.type,
              properties: {},
            },
          })

          // Send heartbeat every 10s to prevent stalled proxy streams.
          heartbeat = setInterval(() => {
            pushControl({
              payload: {
                type: "server.heartbeat",
                properties: {},
              },
            })
          }, 10_000)
          heartbeat.unref?.()

          function handler(event: any) {
            push(event)
          }
          GlobalBus.on("event", handler)

          stream.onAbort(stop)

          try {
            for await (const data of q) {
              if (data === null) return
              await stream.writeSSE({ data })
            }
          } finally {
            stop()
          }
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global ax-code configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(redactConfig(await Config.getGlobal()))
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global ax-code configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = stripRedactedConfig(c.req.valid("json"))
        const next = await Config.updateGlobal(config)
        return c.json(redactConfig(next))
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all ax-code instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: Event.Disposed.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    )
    .post(
      "/upgrade",
      describeRoute({
        summary: "Upgrade ax-code",
        description: "Upgrade ax-code to the specified version or latest if not specified.",
        operationId: "global.upgrade",
        responses: {
          200: {
            description: "Upgrade result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.literal(true),
                    version: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 500),
        },
      }),
      validator(
        "json",
        z.object({
          target: z.string().optional(),
        }),
      ),
      async (c) => {
        const method = await Installation.method()
        const rawTarget = c.req.valid("json").target || (await Installation.latest(method))
        const target = semver.valid(semver.coerce(rawTarget))
        if (!target) {
          return invalidRequest(c, { message: "Invalid version string", details: { resource: "version" } })
        }
        await Installation.upgrade(method, target)
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: Installation.Event.Updated.type,
            properties: { version: target },
          },
        })
        return c.json({ success: true as const, version: target })
      },
    ),
)
