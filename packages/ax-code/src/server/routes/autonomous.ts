import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { FeatureFlag } from "../../util/feature-flags"
import {
  BooleanFeatureState,
  persistProjectConfigBooleanFeatureResponse,
  readProjectConfigFeatureState,
} from "./project-config"

const log = Log.create({ service: "autonomous" })
const SUPER_LONG_OVERRIDE = "AX_CODE_SUPER_LONG_SESSION_OVERRIDE"
const SUPER_LONG_BASE = "AX_CODE_SUPER_LONG"

const AutonomousState = BooleanFeatureState.meta({ ref: "AutonomousState" })

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
        const state = await readProjectConfigFeatureState({
          featureFlag: "AX_CODE_AUTONOMOUS",
          read: (config) => config?.autonomous !== false,
        })
        return c.json(state)
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
      validator("json", BooleanFeatureState),
      async (c) => {
        const { enabled } = c.req.valid("json")
        // Persist first; only then update the in-process env. Writing
        // env before persistence created a window where in-process
        // readers (Permission, Session) saw a value the disk hadn't
        // committed, and a subsequent crash would silently revert.
        const state = await persistProjectConfigBooleanFeatureResponse({
          log,
          context: "autonomous config",
          featureFlag: "AX_CODE_AUTONOMOUS",
          enabled,
          update: (config) => {
            config.autonomous = enabled
            // When autonomous is disabled, super-long must also come off —
            // and PERSISTED off, not just env-suppressed. Leaving
            // `super_long: true` in ax-code.json meant a later re-enable of
            // autonomous silently resurrected Super-Long the user never
            // re-selected (the TUI pairs an explicit /super-long PUT, but
            // direct API consumers hit this route alone).
            if (!enabled && config.super_long !== undefined) {
              // Preserve a configured duration_hours; only flip enablement.
              config.super_long =
                typeof config.super_long === "object" ? { ...config.super_long, enabled: false } : false
            }
          },
        })
        if ("error" in state) return c.json(state, 500)
        if (!enabled) {
          // When autonomous is disabled, super-long must also be
          // suppressed. Clear both the session override AND the
          // base env so a previously-reconciled base env doesn't
          // shadow the config on subsequent super-long GETs.
          FeatureFlag.set(SUPER_LONG_OVERRIDE, false)
          process.env[SUPER_LONG_BASE] = "false"
        }
        log.info("autonomous mode changed", { enabled })
        return c.json(state)
      },
    ),
)
