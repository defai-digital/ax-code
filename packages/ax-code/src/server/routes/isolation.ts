import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Config } from "../../config/config"
import { Isolation } from "../../isolation"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "isolation" })

const IsolationMode = z.enum(["read-only", "workspace-write", "full-access"])

const IsolationState = z
  .object({
    mode: IsolationMode,
    network: z.boolean(),
  })
  .meta({ ref: "IsolationState" })

export const IsolationRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get resolved isolation state",
        description:
          "Returns the effective isolation mode after resolving CLI flags, environment variables, and config file settings.",
        operationId: "isolation.get",
        responses: {
          200: {
            description: "Resolved isolation state",
            content: {
              "application/json": {
                schema: resolver(IsolationState),
              },
            },
          },
        },
      }),
      async (c) => {
        const cfg = await Config.get()
        const state = Isolation.resolve(cfg.isolation, Instance.directory)
        return c.json({ mode: state.mode, network: state.network })
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Set isolation mode",
        description: "Update the runtime isolation mode. Sets the environment variable so it takes effect immediately.",
        operationId: "isolation.set",
        responses: {
          200: {
            description: "Updated isolation state",
            content: {
              "application/json": {
                schema: resolver(IsolationState),
              },
            },
          },
        },
      }),
      validator("json", z.object({ mode: IsolationMode })),
      async (c) => {
        const { mode } = c.req.valid("json")
        process.env["AX_CODE_ISOLATION_MODE"] = mode
        const network = mode === "full-access"
        // Write to config file directly (no Instance.dispose) for persistence across restarts
        const filepath = path.join(Instance.directory, "ax-code.json")
        const existing = await Filesystem.readText(filepath).then((t) => {
          const parsed = JSON.parse(t)
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
        }).catch(() => ({}))
        existing.isolation = { mode, network }
        const tmp = filepath + ".tmp"
        let persisted = true
        await Filesystem.writeJson(tmp, existing)
          .then(() => fs.rename(tmp, filepath))
          .catch((err) => {
            persisted = false
            log.warn("failed to persist isolation config", { error: err instanceof Error ? err.message : String(err) })
            fs.unlink(tmp).catch(() => {})
          })
        if (!persisted) return c.json({ error: "Failed to persist configuration" }, 500)
        const state = Isolation.resolve({ mode, network }, Instance.directory)
        return c.json({ mode: state.mode, network: state.network })
      },
    ),
)
