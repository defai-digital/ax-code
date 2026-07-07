import z from "zod"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { BooleanFeatureState, persistProjectConfigBooleanFeatureResponse, readProjectConfig } from "./project-config"
import { FeatureFlag } from "../../util/feature-flags"
import { ScopedFlag } from "../../flag/scoped"
import { Env } from "../../util/env"
import { SuperLongPolicy } from "../../session/super-long-policy"
import { SuperLongRuntime } from "../../session/super-long-runtime"
import type { Config } from "../../config/config"
import { errors, serviceUnavailable } from "../error"
import { SessionID } from "../../session/schema"
import { requireCurrentProjectSession } from "./session-lookup"

const log = Log.create({ service: "super-long" })
const SUPER_LONG_OVERRIDE = "AX_CODE_SUPER_LONG_SESSION_OVERRIDE"
const SUPER_LONG_BASE = "AX_CODE_SUPER_LONG"

const SuperLongState = BooleanFeatureState.meta({ ref: "SuperLongState" })

const SuperLongStatus = z
  .object({
    enabled: z.boolean(),
    source: z.enum(["scoped", "session-override", "env", "config", "model-default"]),
    durationMs: z.number().nullable(),
    startedAt: z.number().nullable(),
    elapsedMs: z.number().nullable(),
    remainingMs: z.number().nullable(),
  })
  .meta({ ref: "SuperLongStatus" })

const SuperLongStatusQuery = z.object({
  model: z.string().optional(),
  sessionID: SessionID.zod.optional(),
})

// Split the configured "provider/model" reference. The providerID matters:
// the capability-based model default (supportsLongAgent) has provider-filtered
// registry entries that never match when providerID is omitted, so dropping it
// made this route report a state the runtime readers could disagree with.
function configuredModel(config: Config.Info | undefined, explicitModel?: string) {
  const model = explicitModel ?? config?.model ?? ""
  if (!model.includes("/")) return { modelID: model, providerID: undefined }
  const [providerID, ...rest] = model.split("/")
  return { modelID: rest.join("/"), providerID: providerID || undefined }
}

function autonomousEnabled(config: Config.Info | undefined) {
  // Same precedence as the config-load reconciliation: an explicit env
  // value wins (with config `autonomous: false` still able to veto),
  // otherwise the project config decides with the default being on.
  // Reading the project config directly keeps this GET correct even when
  // the in-process env was last synced for a different project.
  const env = Env.parseBoolean(process.env["AX_CODE_AUTONOMOUS"])
  if (env !== undefined) return env && config?.autonomous !== false
  return config?.autonomous !== false
}

function superLongRuntimeState(config: Config.Info | undefined, explicitModel?: string) {
  // Delegate to the canonical runtime precedence (session override -> base env
  // -> config -> model default) instead of re-implementing it. Re-implementing
  // dropped the AX_CODE_SUPER_LONG base-env step, so an externally-set base env
  // made this GET report a state the runtime readers (LLM/prompt) did not use.
  // See the flag contract note at src/flag/flag.ts (defineBooleanFlagWithOverride
  // for AX_CODE_SUPER_LONG): the reported state must match runtime behavior.
  const { modelID, providerID } = configuredModel(config, explicitModel)
  return SuperLongPolicy.runtimeState({
    modelID,
    providerID,
    config: SuperLongPolicy.fromConfig(config?.super_long),
    scoped: ScopedFlag.superLong(),
  })
}

function superLongConfigState(config: Config.Info | undefined, explicitModel?: string) {
  // Compute the super-long state from config + model default only,
  // ignoring env vars. This is the source of truth for the UI:
  // what the user persisted to ax-code.json (or the model default
  // when no explicit setting exists). Env vars are reconciled to
  // match this value after the GET returns.
  const { modelID, providerID } = configuredModel(config, explicitModel)
  return SuperLongPolicy.state({
    modelID,
    providerID,
    config: SuperLongPolicy.fromConfig(config?.super_long),
  })
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
        // Compute from config + model default (ignoring env) so the
        // UI always reflects the persisted configuration. The env
        // is then reconciled to match.
        const state = superLongConfigState(config, c.req.query("model"))
        const desired = autonomousEnabled(config) && state.enabled
        // Reconcile from persisted config so an external edit to
        // ax-code.json propagates without a server restart.
        //
        // The session override (AX_CODE_SUPER_LONG_SESSION_OVERRIDE) is
        // cleared here so it never shadows the config on subsequent
        // GETs — otherwise a PUT-set override would persist even after
        // the config was externally edited.
        //
        // The base env (AX_CODE_SUPER_LONG) is set to the resolved
        // value so in-process readers (Flag.AX_CODE_SUPER_LONG,
        // prompt assembly, control-plane) see the same state the UI
        // does. Without this, a stale base env from the shell could
        // make runtime readers disagree with the UI.
        delete process.env[SUPER_LONG_OVERRIDE]
        process.env[SUPER_LONG_BASE] = String(desired)
        ScopedFlag.recordCurrent("AX_CODE_SUPER_LONG", desired)
        return c.json({ enabled: desired })
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
      validator("query", SuperLongStatusQuery),
      async (c) => {
        const query = c.req.valid("query")
        const config = await readProjectConfig()
        // Capture runtime state BEFORE reconciliation so the source
        // field reflects the original runtime precedence (config,
        // env, session override, or model default).
        const runtimeState = superLongRuntimeState(config, query.model)
        // Compute from config + model default (ignoring env), same
        // as GET /, so the status endpoint is consistent.
        const configState = superLongConfigState(config, query.model)
        const enabled = autonomousEnabled(config) && configState.enabled
        // Reconcile: clear the session override and align the base
        // env so in-process readers see the config-derived state,
        // same as GET /.
        delete process.env[SUPER_LONG_OVERRIDE]
        process.env[SUPER_LONG_BASE] = String(enabled)
        const runtimeConfig = SuperLongPolicy.fromConfig(config?.super_long)
        const durationDecision = SuperLongPolicy.duration(runtimeConfig.requestedDurationMs)
        const durationMs = durationDecision.ok ? durationDecision.durationMs : null
        const sessionID = query.sessionID
        if (sessionID) await requireCurrentProjectSession(sessionID)
        const startedAt = sessionID
          ? await SuperLongRuntime.peekSessionStartedAt(sessionID).catch(() => undefined)
          : undefined
        const now = Date.now()
        const elapsedMs = startedAt === undefined ? null : Math.max(0, now - startedAt)
        return c.json({
          enabled,
          source: runtimeState.source,
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
        description: "Toggle Super-Long mode on or off. Persists to ax-code.json.",
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
              // Retrying cannot succeed until autonomous is enabled first.
              retryable: false,
            })
          }
        }
        // Persist first; only then update the in-process env. Writing
        // env before persistence created a window where in-process
        // readers saw a value the disk hadn't committed, and a
        // subsequent crash would silently revert.
        const state = await persistProjectConfigBooleanFeatureResponse({
          log,
          context: "super-long config",
          featureFlag: "AX_CODE_SUPER_LONG",
          enabled,
          update: (config) => {
            // Normalize the super_long field: when enabling, ensure the
            // object form is used so we can set `enabled`. When
            // disabling, just flip the boolean (or object) to false.
            if (typeof config.super_long === "object" && config.super_long !== null) {
              config.super_long = { ...config.super_long, enabled }
            } else {
              config.super_long = enabled
            }
          },
        })
        if ("error" in state) return c.json(state, 500)
        // Keep the session override in sync for the current process so
        // runtimeState() picks up the change immediately without a
        // restart.
        FeatureFlag.set(SUPER_LONG_OVERRIDE, enabled)
        // Also keep the base env aligned so readers that check
        // AX_CODE_SUPER_LONG (without the session override prefix)
        // see the correct value. Without this, a stale base env
        // from the shell could shadow the PUT until the next GET
        // reconciliation.
        FeatureFlag.set(SUPER_LONG_BASE, enabled)
        // Note: the persist helper above already recorded the scoped value.
        log.info("super-long mode changed", { enabled })
        return c.json(state)
      },
    ),
)
