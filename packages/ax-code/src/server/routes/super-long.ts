import z from "zod"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { BooleanFeatureState, readProjectConfig } from "./project-config"
import { FeatureFlag } from "../../util/feature-flags"
import { Flag } from "../../flag/flag"
import { SuperLongPolicy } from "../../session/super-long-policy"
import { SuperLongRuntime } from "../../session/super-long-runtime"
import type { Config } from "../../config/config"
import { errors, serviceUnavailable } from "../error"

const log = Log.create({ service: "super-long" })
const SUPER_LONG_OVERRIDE = "AX_CODE_SUPER_LONG_SESSION_OVERRIDE"

const SuperLongState = BooleanFeatureState.meta({ ref: "SuperLongState" })

const SuperLongStatus = z
  .object({
    enabled: z.boolean(),
    source: z.enum(["session-override", "env", "config", "model-default"]),
    durationMs: z.number().nullable(),
    startedAt: z.number().nullable(),
    elapsedMs: z.number().nullable(),
    remainingMs: z.number().nullable(),
  })
  .meta({ ref: "SuperLongStatus" })

function configuredModelID(config: Config.Info | undefined, explicitModel?: string) {
  const model = explicitModel ?? config?.model ?? ""
  return model.includes("/") ? model.split("/").slice(1).join("/") : model
}

function autonomousEnabled(config: Config.Info | undefined) {
  return Flag.AX_CODE_AUTONOMOUS && config?.autonomous !== false
}

function superLongRuntimeState(config: Config.Info | undefined, explicitModel?: string) {
  // Delegate to the canonical runtime precedence (session override -> base env
  // -> config -> model default) instead of re-implementing it. Re-implementing
  // dropped the AX_CODE_SUPER_LONG base-env step, so an externally-set base env
  // made this GET report a state the runtime readers (LLM/prompt) did not use.
  // See the flag contract note at src/flag/flag.ts (defineBooleanFlagWithOverride
  // for AX_CODE_SUPER_LONG): the reported state must match runtime behavior.
  return SuperLongPolicy.runtimeState({
    modelID: configuredModelID(config, explicitModel),
    config: SuperLongPolicy.fromConfig(config?.super_long),
  })
}

function superLongDesired(config: Config.Info | undefined, explicitModel?: string) {
  return superLongRuntimeState(config, explicitModel).enabled
}

export const SuperLongRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get Super-Long mode state",
        description: "Returns whether Super-Long mode is enabled.",
        operationId: "superLong.get",
        responses: {
          200: {
            description: "Super-Long mode state",
            content: {
              "application/json": {
                schema: resolver(SuperLongState),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await readProjectConfig()
        const desired = superLongDesired(config, c.req.query("model"))
        return c.json({ enabled: autonomousEnabled(config) && desired })
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get Super-Long run status",
        description:
          "Returns the resolved Super-Long state plus run timing: durable run start, elapsed time, and time remaining before the runtime ceiling. Pass sessionID to include per-session timing.",
        operationId: "superLong.status",
        responses: {
          200: {
            description: "Super-Long run status",
            content: {
              "application/json": {
                schema: resolver(SuperLongStatus),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await readProjectConfig()
        const state = superLongRuntimeState(config, c.req.query("model"))
        const enabled = autonomousEnabled(config) && state.enabled
        const runtimeConfig = SuperLongPolicy.fromConfig(config?.super_long)
        const durationDecision = SuperLongPolicy.duration(runtimeConfig.requestedDurationMs)
        const durationMs = durationDecision.ok ? durationDecision.durationMs : null
        const sessionID = c.req.query("sessionID")
        const startedAt = sessionID
          ? await SuperLongRuntime.peekSessionStartedAt(sessionID).catch(() => undefined)
          : undefined
        const now = Date.now()
        const elapsedMs = startedAt === undefined ? null : Math.max(0, now - startedAt)
        return c.json({
          enabled,
          source: state.source,
          durationMs,
          startedAt: startedAt ?? null,
          elapsedMs,
          remainingMs: elapsedMs === null || durationMs === null ? null : Math.max(0, durationMs - elapsedMs),
        })
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Set Super-Long mode",
        description: "Toggle Super-Long mode on or off for the current runtime session.",
        operationId: "superLong.set",
        responses: {
          200: {
            description: "Updated Super-Long state",
            content: {
              "application/json": {
                schema: resolver(SuperLongState),
              },
            },
          },
          ...errors(409),
        },
      }),
      validator("json", BooleanFeatureState),
      async (c) => {
        const { enabled } = c.req.valid("json")
        if (enabled) {
          const config = await readProjectConfig()
          if (!autonomousEnabled(config)) {
            return serviceUnavailable(c, {
              message: "Super-Long requires autonomous mode or equivalent runtime guardrails.",
              details: { resource: "superLong" },
            })
          }
        }
        FeatureFlag.set("AX_CODE_SUPER_LONG", enabled)
        FeatureFlag.set(SUPER_LONG_OVERRIDE, enabled)
        log.info("super-long mode changed for session", { enabled })
        return c.json({ enabled })
      },
    ),
)
