import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import {
  PROJECT_CONFIG_PERSIST_ERROR,
  createPersistErrorLogger,
  readProjectConfig,
  persistProjectConfig,
} from "./project-config"
import { FeatureFlag } from "../../util/feature-flags"
import { Flag } from "../../flag/flag"

const log = Log.create({ service: "smart-llm" })

const SmartLlmState = z
  .object({
    enabled: z.boolean(),
  })
  .meta({ ref: "SmartLlmState" })

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
        const config = await readProjectConfig()
        const enabled = config?.routing?.llm ?? Flag.AX_CODE_SMART_LLM
        FeatureFlag.set("AX_CODE_SMART_LLM", enabled)
        return c.json({ enabled })
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
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => {
        const { enabled } = c.req.valid("json")
        const persisted = await persistProjectConfig(
          (config) => {
            config.routing ??= {}
            config.routing.llm = enabled
          },
          {
            onError: createPersistErrorLogger(log, "smart LLM config"),
          },
        )
        log.info("smart LLM routing changed", { enabled, persisted })
        if (!persisted) return c.json({ error: PROJECT_CONFIG_PERSIST_ERROR }, 500)
        FeatureFlag.set("AX_CODE_SMART_LLM", enabled)
        return c.json({ enabled })
      },
    ),
)
