import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { readProjectConfig, updateProjectConfig } from "./project-config"

const log = Log.create({ service: "smart-llm" })

const SmartLlmState = z
  .object({
    enabled: z.boolean(),
  })
  .meta({ ref: "SmartLlmState" })

/** Fast-model complexity routing defaults to ON. Explicit config beats env beats default. */
function resolveSmartLlmEnabled(configValue: boolean | undefined, envValue: string | undefined) {
  if (typeof configValue === "boolean") return configValue
  if (envValue === "true") return true
  if (envValue === "false") return false
  return true
}

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
        const enabled = resolveSmartLlmEnabled(config?.routing?.llm, process.env["AX_CODE_SMART_LLM"])
        process.env["AX_CODE_SMART_LLM"] = String(enabled)
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
        process.env["AX_CODE_SMART_LLM"] = String(enabled)
        let persisted = true
        await updateProjectConfig((config) => {
          config.routing ??= {}
          config.routing.llm = enabled
        }).catch((err) => {
          persisted = false
          log.warn("failed to persist smart-llm config", { error: err instanceof Error ? err.message : String(err) })
        })
        log.info("smart LLM routing changed", { enabled, persisted })
        if (!persisted) return c.json({ error: "Failed to persist configuration" }, 500)
        return c.json({ enabled })
      },
    ),
)
