import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../project/instance"
import { Filesystem } from "../../util/filesystem"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"

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
        const filepath = path.join(Instance.directory, "ax-code.json")
        const config = await Filesystem.readText(filepath)
          .then((t) => JSON.parse(t))
          .catch(() => ({}))
        const enabled = config?.routing?.llm === true || process.env["AX_CODE_SMART_LLM"] === "true"
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
        const filepath = path.join(Instance.directory, "ax-code.json")
        const existing = await Filesystem.readText(filepath)
          .then((t) => {
            const parsed = JSON.parse(t)
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              log.warn("ax-code.json contained non-object value, resetting to empty object")
              return {}
            }
            return parsed
          })
          .catch(() => ({}))
        if (!existing.routing) existing.routing = {}
        existing.routing.llm = enabled
        const tmp = filepath + ".tmp"
        await Filesystem.writeJson(tmp, existing)
          .then(() => fs.rename(tmp, filepath))
          .catch((err) => {
            log.warn("failed to persist smart-llm config", { error: err instanceof Error ? err.message : String(err) })
            fs.unlink(tmp).catch(() => {})
          })
        log.info("smart LLM routing changed", { enabled })
        return c.json({ enabled })
      },
    ),
)
