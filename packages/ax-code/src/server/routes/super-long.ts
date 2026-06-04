import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { isQwen37MaxModel } from "../../provider/qwen37-readiness"
import { BooleanFeatureState, readProjectConfig } from "./project-config"
import { FeatureFlag } from "../../util/feature-flags"
import { Flag } from "../../flag/flag"
import type { Config } from "../../config/config"

const log = Log.create({ service: "super-long" })
const SUPER_LONG_OVERRIDE = "AX_CODE_SUPER_LONG_SESSION_OVERRIDE"

const SuperLongState = BooleanFeatureState.meta({ ref: "SuperLongState" })

function readOverride() {
  const override = process.env[SUPER_LONG_OVERRIDE]
  if (override === "true") return true
  if (override === "false") return false
  return undefined
}

function configuredModelID(config: Config.Info | undefined, explicitModel?: string) {
  const model = explicitModel ?? config?.model ?? ""
  return model.includes("/") ? model.split("/").slice(1).join("/") : model
}

function autonomousEnabled(config: Config.Info | undefined) {
  return Flag.AX_CODE_AUTONOMOUS && config?.autonomous !== false
}

function superLongDesired(config: Config.Info | undefined, explicitModel?: string) {
  const override = readOverride()
  if (override !== undefined) return override
  if (config?.super_long !== undefined) return config.super_long
  return isQwen37MaxModel(configuredModelID(config, explicitModel))
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
        },
      }),
      validator("json", BooleanFeatureState),
      async (c) => {
        const { enabled } = c.req.valid("json")
        if (enabled) {
          const config = await readProjectConfig()
          if (!autonomousEnabled(config)) {
            return c.json({ error: "Super-Long requires autonomous mode or equivalent runtime guardrails." }, 409)
          }
        }
        FeatureFlag.set("AX_CODE_SUPER_LONG", enabled)
        FeatureFlag.set(SUPER_LONG_OVERRIDE, enabled)
        log.info("super-long mode changed for session", { enabled })
        return c.json({ enabled })
      },
    ),
)
