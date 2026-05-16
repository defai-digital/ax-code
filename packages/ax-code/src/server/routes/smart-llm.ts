import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import {
  BooleanFeatureState,
  persistProjectConfigBooleanFeatureResponse,
  readProjectConfigFeatureState,
} from "./project-config"
import { Flag } from "../../flag/flag"

const log = Log.create({ service: "smart-llm" })
const SmartLlmState = BooleanFeatureState.meta({ ref: "SmartLlmState" })

export const SmartLlmRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get smart LLM routing state",
        description: "Returns whether LLM-based agent routing is enabled.",
        operationId: "smartLlm.get",
        responses: {
          200: {
            description: "Smart LLM routing state",
            content: {
              "application/json": {
                schema: resolver(SmartLlmState),
              },
            },
          },
        },
      }),
      async (c) => {
        const state = await readProjectConfigFeatureState({
          featureFlag: "AX_CODE_SMART_LLM",
          read: (config) => config?.routing?.llm ?? Flag.AX_CODE_SMART_LLM,
        })
        return c.json(state)
      },
    )
    .put(
      "/",
      describeRoute({
        summary: "Set smart LLM routing",
        description: "Toggle LLM-based agent routing on or off. Persists to ax-code.json.",
        operationId: "smartLlm.set",
        responses: {
          200: {
            description: "Updated smart LLM routing state",
            content: {
              "application/json": {
                schema: resolver(SmartLlmState),
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
          context: "smart LLM config",
          featureFlag: "AX_CODE_SMART_LLM",
          enabled,
          update: (config) => {
            config.routing ??= {}
            config.routing.llm = enabled
          },
        })
        if ("error" in state) return c.json(state, 500)
        log.info("smart LLM routing changed", { enabled })
        return c.json(state)
      },
    ),
)
