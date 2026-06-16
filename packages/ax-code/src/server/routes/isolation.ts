import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import z from "zod"
import { Config } from "../../config/config"
import { Isolation } from "../../isolation"
import { Instance } from "../../project/instance"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { persistProjectConfigFeatureResponse } from "./project-config"
import { FeatureFlag } from "@/util/feature-flags"

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
      validator("json", z.object({ mode: IsolationMode, network: z.boolean().optional() })),
      async (c) => {
        const { mode } = c.req.valid("json")
        // Network access is only meaningful for write-capable modes
        // (workspace-write / full-access); read-only always implies no network.
        // Accept an explicit network flag from the client instead of forcing it
        // to false for workspace-write. See #240.
        const requestedNetwork = c.req.valid("json").network
        const network = mode === "read-only" ? false : (requestedNetwork ?? mode === "full-access")
        const state = Isolation.resolve({ mode, network }, Instance.directory, Instance.worktree)
        const persistedState = await persistProjectConfigFeatureResponse({
          log,
          context: "isolation mode",
          featureFlag: "AX_CODE_ISOLATION_MODE",
          featureValue: mode,
          responseState: { mode: state.mode, network: state.network },
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
