import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import z from "zod"
import { Isolation } from "../../isolation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { persistProjectConfigResponse } from "./project-config"
import { Config } from "../../config/config"
import { Instance } from "@/project/instance"
import { JsonBoolean } from "./query"
import { errors } from "../error"

const log = Log.create({ service: "isolation" })

const IsolationMode = z.enum(["read-only", "workspace-write", "full-access"])

const IsolationState = z
  .object({
    mode: IsolationMode,
    network: z.boolean(),
  })
  .meta({ ref: "IsolationState" })

function effectiveIsolationState(config: Config.Info | undefined) {
  const state = Isolation.resolve(config?.isolation, Instance.directory, Instance.worktree)
  return { mode: state.mode, network: state.network }
}

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
        // Re-read the merged config so external edits take effect without a
        // server restart. Isolation.resolve preserves the documented
        // CLI/env > config > default precedence; this route must never turn an
        // explicit restricted CLI mode back into the less restrictive default.
        const state = effectiveIsolationState(await Config.getFresh())
        return c.json({ mode: state.mode, network: state.network })
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Set isolation mode",
        description:
          "Persist the project isolation mode and return the effective state. An existing CLI or environment override remains authoritative.",
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
          ...errors(500),
        },
      }),
      validator("json", z.object({ mode: IsolationMode, network: JsonBoolean.optional() })),
      async (c) => {
        const { mode } = c.req.valid("json")
        // Network access is only meaningful for write-capable modes
        // (workspace-write / full-access); read-only always implies no network.
        // Accept an explicit network flag from the client instead of forcing it
        // to false for workspace-write. See #240.
        const requestedNetwork = c.req.valid("json").network
        // Without an explicit flag, a write-capable mode keeps the configured
        // network policy: full-access is networked regardless, and writing the
        // derived boolean back clobbered `network: true` or an allowed_domains
        // allowlist whenever the TUI toggled the sandbox off and on again.
        const network = mode === "read-only" ? false : requestedNetwork
        await persistProjectConfigResponse({
          log,
          context: "isolation mode",
          update: (config) => {
            // Preserve backend / protected / other isolation fields. Replacing
            // the whole object with { mode, network } dropped OS sandbox
            // backend and custom protected paths on every UI mode toggle.
            const prev = config.isolation && typeof config.isolation === "object" ? { ...config.isolation } : {}
            config.isolation = network === undefined ? { ...prev, mode } : { ...prev, mode, network }
          },
        })
        // Refresh the per-directory config cache so tool execution observes
        // the persisted setting immediately. Report the effective state: an
        // explicit CLI/env override remains authoritative until restart.
        const state = effectiveIsolationState(await Config.getFresh())
        return c.json(state)
      },
    ),
)
