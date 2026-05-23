import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { isQwen37MaxModel } from "../../provider/qwen37-readiness"
import {
  BooleanFeatureState,
  persistProjectConfigBooleanFeatureResponse,
  readProjectConfigFeatureState,
} from "./project-config"

const log = Log.create({ service: "super-long" })

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
        },
      }),
      validator("json", BooleanFeatureState),
      async (c) => {
        const { enabled } = c.req.valid("json")
        const state = await persistProjectConfigBooleanFeatureResponse({
          log,
          context: "super-long config",
          featureFlag: "AX_CODE_SUPER_LONG",
          enabled,
          update: (config) => {
            config.super_long = enabled
          },
        })
        if ("error" in state) return c.json(state, 500)
        log.info("super-long mode changed", { enabled })
        return c.json(state)
      },
    ),
)
