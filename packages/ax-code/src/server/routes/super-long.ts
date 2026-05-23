import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { isQwen37MaxModel } from "../../provider/qwen37-readiness"
import { BooleanFeatureState, readProjectConfigFeatureState } from "./project-config"
import { FeatureFlag } from "../../util/feature-flags"

const log = Log.create({ service: "super-long" })
const SUPER_LONG_OVERRIDE = "AX_CODE_SUPER_LONG_SESSION_OVERRIDE"

const SuperLongState = BooleanFeatureState.meta({ ref: "SuperLongState" })

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
        const state = await readProjectConfigFeatureState({
          featureFlag: "AX_CODE_SUPER_LONG",
          read: (config) => {
            const override = process.env[SUPER_LONG_OVERRIDE]
            if (override === "true") return true
            if (override === "false") return false
            if (config?.super_long !== undefined) return config.super_long
            // Default on when the configured model is Qwen3.7-Max
            const model = config?.model ?? ""
            const modelId = model.includes("/") ? model.split("/").slice(1).join("/") : model
            return isQwen37MaxModel(modelId)
          },
        })
        return c.json(state)
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
        FeatureFlag.set("AX_CODE_SUPER_LONG", enabled)
        FeatureFlag.set(SUPER_LONG_OVERRIDE, enabled)
        log.info("super-long mode changed for session", { enabled })
        return c.json({ enabled })
      },
    ),
)
