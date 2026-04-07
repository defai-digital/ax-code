import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import path from "path"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"

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
        // Check env var first (runtime override), then fall back to persisted config
        if (process.env["AX_CODE_AUTONOMOUS"] !== undefined) {
          return c.json({ enabled: process.env["AX_CODE_AUTONOMOUS"] === "true" })
        }
        const filepath = path.join(Instance.directory, "ax-code.json")
        const config = await Filesystem.readText(filepath)
          .then((t) => JSON.parse(t))
          .catch(() => ({}))
        const enabled = config?.autonomous !== false
        // Cache in env var for subsequent reads and processor access
        process.env["AX_CODE_AUTONOMOUS"] = String(enabled)
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
        process.env["AX_CODE_AUTONOMOUS"] = String(enabled)
        // Persist to ax-code.json so the setting survives restarts
        const filepath = path.join(Instance.directory, "ax-code.json")
        const existing = await Filesystem.readText(filepath)
          .then((t) => {
            const parsed = JSON.parse(t)
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              log.warn("ax-code.json contained non-object value, resetting to empty object")
              return {}
            }
            return parsed
          })
          .catch(() => ({}))
        existing.autonomous = enabled
        await Filesystem.writeJson(filepath, existing).catch((err) => {
          log.warn("failed to persist autonomous config", { error: err instanceof Error ? err.message : String(err) })
        })
        log.info("autonomous mode changed", { enabled })
        return c.json({ enabled })
      },
    ),
)
