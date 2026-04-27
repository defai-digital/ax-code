import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

export const REDACTED = "[redacted]"

export function redactConfig(config: Config.Info): Config.Info {
  const maskRecord = (rec: Record<string, string> | undefined) =>
    rec ? Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v ? REDACTED : v])) : rec

  return {
    ...config,
    provider: config.provider
      ? Object.fromEntries(
          Object.entries(config.provider).map(([id, p]) => [
            id,
            { ...p, options: p.options ? { ...p.options, apiKey: p.options.apiKey ? REDACTED : p.options.apiKey } : p.options },
          ]),
        )
      : config.provider,
    mcp: config.mcp
      ? Object.fromEntries(
          Object.entries(config.mcp).map(([name, m]) => {
            if (!("type" in m)) return [name, m]
            if (m.type === "remote") {
              return [
                name,
                {
                  ...m,
                  headers: maskRecord(m.headers),
                  oauth: m.oauth && typeof m.oauth === "object" ? { ...m.oauth, clientSecret: m.oauth.clientSecret ? REDACTED : m.oauth.clientSecret } : m.oauth,
                },
              ]
            }
            // McpLocal
            return [name, { ...m, environment: maskRecord(m.environment) }]
          }),
        )
      : config.mcp,
  }
}

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current ax-code configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(redactConfig(await Config.get()))
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update ax-code configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        await Config.update(config)
        return c.json(config)
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    providers: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        using _ = log.time("providers")
        const providers = await Provider.list().then((x) => mapValues(x, ({ key: _key, ...rest }) => rest))
        return c.json({
          providers: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0]?.id ?? ""),
        })
      },
    ),
)
