import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { isRecord } from "../../util/record"

const log = Log.create({ service: "server" })

export const REDACTED = "[redacted]"

const SECRET_OPTION_PATTERN = /key|secret|token|password|credential|auth/i

function stripRedactedRecord(record: Record<string, string> | undefined) {
  if (!record) return record
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== REDACTED))
}

// Credential-bearing options can sit below the top level
// (options.headers.Authorization, options.fetchOptions.headers["x-api-key"],
// arrays of option objects), so both the redaction pass and the PATCH strip
// pass recurse over plain objects and arrays with a shared depth bound.
// Copy-on-write: subtrees with nothing to change are returned by reference.
const MAX_REDACT_DEPTH = 8

function redactProviderOptionsDeep(value: unknown, depth: number): unknown {
  if (depth >= MAX_REDACT_DEPTH) return value
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const redacted = redactProviderOptionsDeep(item, depth + 1)
      if (redacted !== item) changed = true
      return redacted
    })
    return changed ? next : value
  }
  if (!isRecord(value)) return value
  let changed = false
  const entries: [string, unknown][] = []
  for (const [key, item] of Object.entries(value)) {
    // A secret-looking key with a non-null value is masked whole, exactly as
    // the previous top-level-only pass did — never recursed into.
    if (item != null && SECRET_OPTION_PATTERN.test(key)) {
      if (item !== REDACTED) changed = true
      entries.push([key, REDACTED])
      continue
    }
    const redacted = redactProviderOptionsDeep(item, depth + 1)
    if (redacted !== item) changed = true
    entries.push([key, redacted])
  }
  return changed ? Object.fromEntries(entries) : value
}

function redactProviderOptions(options: Record<string, unknown>) {
  return redactProviderOptionsDeep(options, 0) as Record<string, unknown>
}

function stripRedactedProviderOptionsDeep(value: unknown, depth: number): unknown {
  if (depth >= MAX_REDACT_DEPTH) return value
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const stripped = stripRedactedProviderOptionsDeep(item, depth + 1)
      if (stripped !== item) changed = true
      return stripped
    })
    return changed ? next : value
  }
  if (!isRecord(value)) return value
  let changed = false
  const entries: [string, unknown][] = []
  for (const [key, item] of Object.entries(value)) {
    // Drop a redaction sentinel only when it sits on a secret-looking key: a
    // literal "[redacted]" value on a public key is user data, not an echo.
    if (item === REDACTED && SECRET_OPTION_PATTERN.test(key)) {
      changed = true
      continue
    }
    const stripped = stripRedactedProviderOptionsDeep(item, depth + 1)
    if (stripped !== item) changed = true
    entries.push([key, stripped])
  }
  return changed ? Object.fromEntries(entries) : value
}

function stripRedactedProviderOptions(options: Record<string, unknown> | undefined) {
  if (!options) return options
  return stripRedactedProviderOptionsDeep(options, 0) as Record<string, unknown>
}

export function stripRedactedConfig(config: Config.Info): Config.Info {
  const result: Config.Info = { ...config }
  // Only rewrite provider/mcp when the caller actually sent them. Setting
  // these keys to an explicit `undefined` is NOT a no-op: patchJsonc treats a
  // `undefined` patch value as "delete this key" (jsonc-parser modify
  // semantics), so a partial update like `{ disabled_providers: [...] }`
  // would wipe every configured provider — managed custom API providers
  // included — and every MCP server from the config file.
  if (config.provider) {
    result.provider = Object.fromEntries(
      Object.entries(config.provider).map(([id, p]) => [
        id,
        {
          ...p,
          options: stripRedactedProviderOptions(p.options),
        },
      ]),
    )
  }
  if (config.mcp) {
    result.mcp = Object.fromEntries(
      Object.entries(config.mcp).map(([name, m]) => {
        if (!("type" in m)) return [name, m]
        if (m.type === "remote") {
          return [
            name,
            {
              ...m,
              headers: stripRedactedRecord(m.headers),
              oauth:
                m.oauth && typeof m.oauth === "object" && m.oauth.clientSecret === REDACTED
                  ? Object.fromEntries(Object.entries(m.oauth).filter(([key]) => key !== "clientSecret"))
                  : m.oauth,
            },
          ]
        }
        return [name, { ...m, environment: stripRedactedRecord(m.environment) }]
      }),
    )
  }
  return result
}

export function redactConfig(config: Config.Info): Config.Info {
  const maskRecord = (rec: Record<string, string> | undefined) =>
    rec ? Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v ? REDACTED : v])) : rec

  return {
    ...config,
    provider: config.provider
      ? Object.fromEntries(
          Object.entries(config.provider).map(([id, p]) => [
            id,
            {
              ...p,
              options: p.options ? redactProviderOptions(p.options) : p.options,
            },
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
                  oauth:
                    m.oauth && typeof m.oauth === "object"
                      ? { ...m.oauth, clientSecret: m.oauth.clientSecret ? REDACTED : m.oauth.clientSecret }
                      : m.oauth,
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

// Provider `options` is an opaque bag that config and auth loaders fill with
// credentials (apiKey, OAuth/access tokens, client secrets). The providers
// list/discovery endpoints must not leak these, so drop the top-level `key`
// and redact any secret-looking option value — mirroring the redactConfig
// contract used by the /config endpoints. Non-secret options (e.g. baseURL)
// are preserved.
export function redactProviderInfo(info: Provider.Info): Provider.Info {
  const { key: _key, ...rest } = info
  if (!rest.options) return rest
  return {
    ...rest,
    options: redactProviderOptions(rest.options),
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
        const config = stripRedactedConfig(c.req.valid("json"))
        await Config.update(config)
        return c.json(redactConfig(await Config.get()))
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
        const providers = await Provider.list().then((x) => mapValues(x, redactProviderInfo))
        return c.json({
          providers: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0]?.id ?? ""),
        })
      },
    ),
)
