import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import {
  PROJECT_CONFIG_PERSIST_ERROR,
  createPersistErrorLogger,
  readProjectConfig,
  persistProjectConfig,
} from "./project-config"
import { FeatureFlag } from "../../util/feature-flags"

const log = Log.create({ service: "autonomous" })

const AutonomousState = z
  .object({
    enabled: z.boolean(),
  })
  .meta({ ref: "AutonomousState" })

export const AutonomousRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get autonomous mode state",
        description: "Returns whether autonomous mode is enabled.",
        operationId: "autonomous.get",
        responses: {
          200: {
            description: "Autonomous mode state",
            content: {
              "application/json": {
                schema: resolver(AutonomousState),
              },
            },
          },
        },
      }),
      async (c) => {
        // Always reconcile from persisted config so an external edit to
        // ax-code.json propagates without a server restart. The env var
        // is the runtime authority for in-process readers (Permission /
        // Session / Question), so keep it in sync — but never let a
        // stale env reading short-circuit the config read.
        const config = await readProjectConfig()
        const enabled = config?.autonomous !== false
        FeatureFlag.set("AX_CODE_AUTONOMOUS", enabled)
        return c.json({ enabled })
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Set autonomous mode",
        description: "Toggle autonomous mode on or off. Persists to ax-code.json.",
        operationId: "autonomous.set",
        responses: {
          200: {
            description: "Updated autonomous state",
            content: {
              "application/json": {
                schema: resolver(AutonomousState),
              },
            },
          },
        },
      }),
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => {
        const { enabled } = c.req.valid("json")
        // Persist first; only then update the in-process env. Writing
        // env before persistence created a window where in-process
        // readers (Permission, Session) saw a value the disk hadn't
        // committed, and a subsequent crash would silently revert.
        const persisted = await persistProjectConfig(
          (config) => {
            config.autonomous = enabled
          },
          {
            onError: createPersistErrorLogger(log, "autonomous config"),
          },
        )
        log.info("autonomous mode changed", { enabled, persisted })
        if (!persisted) return c.json({ error: PROJECT_CONFIG_PERSIST_ERROR }, 500)
        FeatureFlag.set("AX_CODE_AUTONOMOUS", enabled)
        return c.json({ enabled })
      },
    ),
)
