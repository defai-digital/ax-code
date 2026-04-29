import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Isolation } from "../../isolation"
import { Instance } from "../../project/instance"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { updateProjectConfig } from "./project-config"

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
        const state = Isolation.resolve(cfg.isolation, Instance.directory, Instance.worktree)
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
        const network = mode === "full-access"
        try {
          await updateProjectConfig((config) => {
            config.isolation = { mode, network }
          })
        } catch (err) {
          log.warn("failed to persist isolation config", { error: err instanceof Error ? err.message : String(err) })
          return c.json({ error: "Failed to persist configuration" }, 500)
        }
        process.env["AX_CODE_ISOLATION_MODE"] = mode
        const state = Isolation.resolve({ mode, network }, Instance.directory, Instance.worktree)
        return c.json({ mode: state.mode, network: state.network })
      },
    ),
)
