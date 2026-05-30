import { createHash } from "crypto"
import path from "path"
import z from "zod/v4"
import { Config } from "../config/config"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Lock } from "../util/lock"

export namespace McpTrust {
  const TRUST_FILE_VERSION = 1
  const fingerprintVersion = 1
  const filepath = path.join(Global.Path.data, "mcp-trust.json")

  const Source = z.object({
    kind: z.string(),
    trustedByDefault: z.boolean(),
    path: z.string().optional(),
    url: z.string().optional(),
  })

  const TrustRecord = z.object({
    name: z.string(),
    scope: z.string(),
    fingerprint: z.string(),
    source: Source,
    timeCreated: z.number(),
    timeUpdated: z.number(),
  })

  const Store = z.object({
    version: z.literal(TRUST_FILE_VERSION),
    records: z.record(z.string(), TrustRecord),
  })

  type Store = z.infer<typeof Store>

  export type Decision = {
    trusted: boolean
    fingerprint: string
    source: Config.McpSource
  }

  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, canonical(val)]),
    )
  }

  function sha256(value: unknown): string {
    return createHash("sha256")
      .update(JSON.stringify(canonical(value)))
      .digest("hex")
  }

  function secretRecordHash(record: Record<string, string> | undefined) {
    if (!record) return undefined
    return Object.fromEntries(
      Object.entries(record)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, sha256(value)]),
    )
  }

  function normalizedRemoteUrl(url: string) {
    try {
      return new URL(url).toString()
    } catch {
      return url
    }
  }

  export function fingerprint(name: string, config: Config.Mcp): string {
    if (config.type === "local") {
      return sha256({
        version: fingerprintVersion,
        name,
        type: config.type,
        command: config.command,
        environment: secretRecordHash(config.environment),
      })
    }

    return sha256({
      version: fingerprintVersion,
      name,
      type: config.type,
      url: normalizedRemoteUrl(config.url),
      headers: secretRecordHash(config.headers),
      oauth:
        config.oauth === false
          ? false
          : {
              enabled: true,
              clientId: typeof config.oauth === "object" ? config.oauth.clientId : undefined,
              hasClientSecret: typeof config.oauth === "object" ? !!config.oauth.clientSecret : false,
              scope: typeof config.oauth === "object" ? config.oauth.scope : undefined,
            },
    })
  }

  function scope() {
    return `project:${Instance.project.id}`
  }

  function key(input: { name: string; scope: string; fingerprint: string }) {
    return `${input.scope}:${input.name}:${input.fingerprint}`
  }

  async function read(): Promise<Store> {
    const raw = await Filesystem.readJson<unknown>(filepath).catch(() => undefined)
    const parsed = Store.safeParse(raw)
    if (parsed.success) return parsed.data
    return { version: TRUST_FILE_VERSION, records: {} }
  }

  async function write(store: Store) {
    await Filesystem.writeJson(filepath, store, 0o600)
  }

  export async function decision(name: string, config: Config.Mcp, source: Config.McpSource): Promise<Decision> {
    const fp = fingerprint(name, config)
    if (source.trustedByDefault) return { trusted: true, fingerprint: fp, source }
    const currentScope = scope()
    const store = await read()
    return {
      trusted: !!store.records[key({ name, scope: currentScope, fingerprint: fp })],
      fingerprint: fp,
      source,
    }
  }

  export async function trust(name: string, config: Config.Mcp, source: Config.McpSource): Promise<Decision> {
    const fp = fingerprint(name, config)
    const currentScope = scope()
    const now = Date.now()
    using _lock = await Lock.write(filepath)
    const store = await read()
    store.records[key({ name, scope: currentScope, fingerprint: fp })] = {
      name,
      scope: currentScope,
      fingerprint: fp,
      source,
      timeCreated: now,
      timeUpdated: now,
    }
    await write(store)
    return { trusted: true, fingerprint: fp, source }
  }

  export async function untrust(name: string, config: Config.Mcp): Promise<Decision> {
    const entry = await Config.mcpEntry(name)
    const source = entry?.source ?? Config.trustedMcpSource("runtime")
    const fp = fingerprint(name, config)
    const currentScope = scope()
    using _lock = await Lock.write(filepath)
    const store = await read()
    delete store.records[key({ name, scope: currentScope, fingerprint: fp })]
    await write(store)
    return { trusted: false, fingerprint: fp, source }
  }
}
