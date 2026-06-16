import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import z from "zod"
import { Isolation } from "../../isolation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { persistProjectConfigFeatureResponse, readProjectConfig } from "./project-config"
import { FeatureFlag } from "@/util/feature-flags"
import type { Config } from "../../config/config"

const log = Log.create({ service: "isolation" })

const IsolationMode = z.enum(["read-only", "workspace-write", "full-access"])

const IsolationState = z
  .object({
    mode: IsolationMode,
    network: z.boolean(),
  })
  .meta({ ref: "IsolationState" })

function isolationConfigState(config: Config.Info | undefined) {
  // Compute isolation state from config + default only, ignoring env vars.
  // This is the source of truth for the UI: what the user persisted to
  // ax-code.json (or the default when no explicit setting exists).
  const mode = config?.isolation?.mode ?? Isolation.DEFAULT_MODE
  const network = mode === "full-access" ? true : (config?.isolation?.network ?? false)
  return { mode, network }
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
        // Always reconcile from persisted config so an external edit to
        // ax-code.json propagates without a server restart. The env vars
        // are the runtime authority for in-process readers (Permission /
        // prompt-tools / runtime-policy), so keep them in sync — but
        // never let a stale env reading short-circuit the config read.
        const config = await readProjectConfig()
        const state = isolationConfigState(config)
        // Reconcile env vars so in-process readers see the same value
        // the UI does.
        FeatureFlag.set("AX_CODE_ISOLATION_MODE", state.mode)
        FeatureFlag.set("AX_CODE_ISOLATION_NETWORK", state.network)
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
      validator("json", z.object({ mode: IsolationMode, network: z.boolean().optional() })),
      async (c) => {
        const { mode } = c.req.valid("json")
        // Network access is only meaningful for write-capable modes
        // (workspace-write / full-access); read-only always implies no network.
        // Accept an explicit network flag from the client instead of forcing it
        // to false for workspace-write. See #240.
        const requestedNetwork = c.req.valid("json").network
        const network = mode === "read-only" ? false : (requestedNetwork ?? mode === "full-access")
        // Use the explicitly requested mode and computed network for the
        // response. Isolation.resolve() reads Flag.AX_CODE_ISOLATION_MODE
        // (env var) first, which has the OLD value at this point — the
        // env is only updated by persistProjectConfigFeatureResponse below.
        // Using resolve()'s state.mode for the response would report the
        // stale env value to the client, making the desktop UI show the
        // wrong toggle state until the next GET reconciliation.
        const persistedState = await persistProjectConfigFeatureResponse({
          log,
          context: "isolation mode",
          featureFlag: "AX_CODE_ISOLATION_MODE",
          featureValue: mode,
          responseState: { mode, network },
          update: (config) => {
            config.isolation = { mode, network }
          },
        })
        if ("error" in persistedState) return c.json(persistedState, 500)
        FeatureFlag.set("AX_CODE_ISOLATION_NETWORK", network)
        return c.json(persistedState)
      },
    ),
)
