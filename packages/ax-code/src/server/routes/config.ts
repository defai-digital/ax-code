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

// A redaction sentinel anywhere inside an array makes the whole array
// unrepresentable as a patch: `mergeDeep` replaces arrays wholesale
// (see mergeConfigConcatArrays), so returning a partially stripped array would
// overwrite the stored one and lose every value dropped from it. The parent
// drops such a key instead and the stored array stands — the same outcome an
// omitted object key gets.
function holdsRedactedSecret(value: unknown, depth: number): boolean {
  if (depth >= MAX_REDACT_DEPTH) return false
  if (Array.isArray(value)) return value.some((item) => holdsRedactedSecret(item, depth + 1))
  if (!isRecord(value)) return false
  for (const [key, item] of Object.entries(value)) {
    if (item === REDACTED && SECRET_OPTION_PATTERN.test(key)) return true
    if (holdsRedactedSecret(item, depth + 1)) return true
  }
  return false
}

function stripRedactedProviderOptionsDeep(value: unknown, depth: number): unknown {
  if (depth >= MAX_REDACT_DEPTH) return value
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
    if (Array.isArray(item)) {
      if (holdsRedactedSecret(item, depth + 1)) {
        changed = true
        continue
      }
      entries.push([key, item])
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

function maskRecord(rec: Record<string, string> | undefined) {
  return rec ? Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v ? REDACTED : v])) : rec
}

type RedactableModel = { headers?: Record<string, string>; options?: Record<string, unknown> }

// A config-declared provider model can carry credentials the provider-level
// `options` redaction never reaches: per-model auth `headers` (Authorization,
// x-api-key) and a per-model `options` bag. The read redaction and the PATCH
// strip must both walk them, or GET /config and GET /provider return the secret
// and a later PATCH persists the "[redacted]" sentinel in its place.
function redactProviderModels<T extends RedactableModel>(
  models: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (!models) return models
  return Object.fromEntries(
    Object.entries(models).map(([id, model]) => {
      const next = {
        ...model,
        headers: model.headers ? maskRecord(model.headers) : model.headers,
        options: model.options ? redactProviderOptions(model.options) : model.options,
      } as T
      return [id, next]
    }),
  )
}

function stripRedactedProviderModels<T extends RedactableModel>(
  models: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (!models) return models
  return Object.fromEntries(
    Object.entries(models).map(([id, model]) => {
      const next = {
        ...model,
        headers: stripRedactedRecord(model.headers),
        options: stripRedactedProviderOptions(model.options) as T["options"],
      } as T
      return [id, next]
    }),
  )
}

// A remote MCP URL can carry credentials as userinfo (user:token@host).
// The redacted form still parses as a URL so a GET body passes PATCH
// validation, and PATCH drops it so the stored URL is kept.
function redactUrlUserinfo(value: string): string {
  try {
    const url = new URL(value)
    if (!url.username && !url.password) return value
    return `${url.protocol}//${REDACTED}@${url.host}${url.pathname}${url.search}${url.hash}`
  } catch {
    return value
  }
}

function hasRedactedUserinfo(value: string): boolean {
  return value.includes(`//${REDACTED}@`) || value.includes(`//${encodeURIComponent(REDACTED)}@`)
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
          models: stripRedactedProviderModels(p.models),
        },
      ]),
    )
  }
  if (config.mcp) {
    result.mcp = Object.fromEntries(
      Object.entries(config.mcp).map(([name, m]) => {
        if (!("type" in m)) return [name, m]
        if (m.type === "remote") {
          const { url, ...rest } = m
          return [
            name,
            {
              ...rest,
              ...(hasRedactedUserinfo(url) ? {} : { url }),
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
  if (config.image_generation) {
    result.image_generation = {
      ...config.image_generation,
      options: stripRedactedProviderOptions(config.image_generation.options),
    }
  }
  return result
}

export function redactConfig(config: Config.Info): Config.Info {
  return {
    ...config,
    provider: config.provider
      ? Object.fromEntries(
          Object.entries(config.provider).map(([id, p]) => [
            id,
            {
              ...p,
              options: p.options ? redactProviderOptions(p.options) : p.options,
              models: redactProviderModels(p.models),
            },
          ]),
        )
      : config.provider,
    image_generation: config.image_generation
      ? {
          ...config.image_generation,
          options: config.image_generation.options
            ? redactProviderOptions(config.image_generation.options)
            : config.image_generation.options,
        }
      : config.image_generation,
    mcp: config.mcp
      ? Object.fromEntries(
          Object.entries(config.mcp).map(([name, m]) => {
            if (!("type" in m)) return [name, m]
            if (m.type === "remote") {
              return [
                name,
                {
                  ...m,
                  url: redactUrlUserinfo(m.url),
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

// Provider `options` and per-model `headers`/`options` are opaque bags that
// config and auth loaders fill with credentials (apiKey, OAuth/access tokens,
// client secrets, Authorization headers). The providers list/discovery
// endpoints must not leak these, so drop the top-level `key` and redact any
// secret-looking value — mirroring the redactConfig contract used by the
// /config endpoints. Non-secret values (e.g. baseURL) are preserved.
export function redactProviderInfo(info: Provider.Info): Provider.Info {
  const { key: _key, ...rest } = info
  return {
    ...rest,
    options: rest.options ? redactProviderOptions(rest.options) : rest.options,
    models: redactProviderModels(rest.models) ?? rest.models,
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
