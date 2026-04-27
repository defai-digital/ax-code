import path from "path"
import fsPromises from "fs/promises"
import { randomUUID } from "crypto"
import { Effect, Layer, Record, Result, Schema, ServiceMap } from "effect"
import { makeRunPromise } from "@/effect/run-service"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { encryptField, decryptField, createCanary, verifyCanary } from "./encryption"
import { Lock } from "../util/lock"
import { Log } from "../util/log"

const log = Log.create({ service: "auth" })

export const OAUTH_DUMMY_KEY = "ax-code-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")
const lockFile = `${file}.lock`
const LOCK_TIMEOUT_MS = 5_000
const LOCK_POLL_MS = 20
const LOCK_STALE_MS = 60 * 60 * 1000

type AuthLockBody = {
  host: string
  pid: number
  startedAt: number
  token: string
}

// Cross-process advisory lock using exclusive file creation.
// Prevents two concurrent ax-code processes (e.g. CLI + desktop app)
// from racing on auth.json. Falls back to in-process Lock.write("auth")
// for same-process mutual exclusion.
async function acquireFileLock(): Promise<() => void> {
  const body: AuthLockBody = {
    host: process.env.HOSTNAME ?? "",
    pid: process.pid,
    startedAt: Date.now(),
    token: randomUUID(),
  }

  async function tryCreate() {
    const fd = await fsPromises.open(lockFile, "wx")
    try {
      await fd.writeFile(JSON.stringify(body))
      return true
    } finally {
      await fd.close()
    }
  }

  async function readBody() {
    const text = await fsPromises.readFile(lockFile, "utf-8").catch(() => undefined)
    if (!text) return undefined
    try {
      const parsed = JSON.parse(text) as Partial<AuthLockBody>
      if (
        typeof parsed.pid !== "number" ||
        typeof parsed.startedAt !== "number" ||
        typeof parsed.host !== "string" ||
        typeof parsed.token !== "string"
      ) {
        return undefined
      }
      return parsed as AuthLockBody
    } catch {
      return undefined
    }
  }

  async function maybeSteal() {
    const holder = await readBody()
    if (!holder) {
      await fsPromises.unlink(lockFile).catch(() => {})
      return true
    }

    const sameHost = holder.host === body.host
    if (sameHost && holder.pid !== process.pid) {
      let alive = true
      try {
        process.kill(holder.pid, 0)
      } catch (error) {
        alive = (error as NodeJS.ErrnoException)?.code !== "ESRCH"
      }
      if (!alive) {
        await fsPromises.unlink(lockFile).catch(() => {})
        return true
      }
      return false
    }

    if (!sameHost && Date.now() - holder.startedAt > LOCK_STALE_MS) {
      await fsPromises.unlink(lockFile).catch(() => {})
      return true
    }

    return false
  }

  const deadline = Date.now() + LOCK_TIMEOUT_MS
  while (true) {
    try {
      if (await tryCreate()) {
        return async () => {
          const current = await readBody()
          if (!current || current.token !== body.token) return
          await fsPromises.unlink(lockFile).catch(() => {})
        }
      }
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e
    }

    if (await maybeSteal()) continue
    if (Date.now() >= deadline) {
      throw new Error("Failed to acquire auth lock: timed out waiting for active holder")
    }
    await new Promise<void>((r) => {
      const timer = setTimeout(r, LOCK_POLL_MS)
      if (typeof timer === "object" && "unref" in timer) timer.unref()
    })
  }
}

const fail = (message: string) => (cause: unknown) => new Auth.AuthError({ message, cause })

export namespace Auth {
  export class Oauth extends Schema.Class<Oauth>("OAuth")({
    type: Schema.Literal("oauth"),
    refresh: Schema.String,
    access: Schema.String,
    expires: Schema.Number,
    accountId: Schema.optional(Schema.String),
    enterpriseUrl: Schema.optional(Schema.String),
  }) {}

  export class Api extends Schema.Class<Api>("ApiAuth")({
    type: Schema.Literal("api"),
    key: Schema.String,
  }) {}

  export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
    type: Schema.Literal("wellknown"),
    key: Schema.String,
    token: Schema.String,
  }) {}

  const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
  export const Info = Object.assign(_Info, { zod: zod(_Info) })
  export type Info = Schema.Schema.Type<typeof _Info>

  export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

  export interface Interface {
    readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
    readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
    readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
    readonly remove: (key: string) => Effect.Effect<void, AuthError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/Auth") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownOption(Info)

      const readRaw = () =>
        Effect.tryPromise({
          try: () => Filesystem.readJson<Record<string, unknown>>(file).catch(() => ({}) as Record<string, unknown>),
          catch: fail("Failed to read auth data"),
        })

      function decryptEntry(value: unknown) {
        if (value && typeof value === "object" && "type" in value) {
          const v = value as Record<string, unknown>
          if (v.type === "api") return decryptField(v, "key")
          if (v.type === "wellknown") return decryptField(decryptField(v, "key"), "token")
          if (v.type === "oauth") return decryptField(decryptField(v, "access"), "refresh")
        }
        return value
      }

      function needsReEncrypt(entry: unknown): boolean {
        return !!(entry && typeof entry === "object" && "__needsReEncrypt" in entry)
      }

      function encryptEntry(info: Info): unknown {
        const raw = { ...info } as Record<string, unknown>
        if (info.type === "api") return encryptField(raw, "key")
        if (info.type === "wellknown") return encryptField(encryptField(raw, "key"), "token")
        if (info.type === "oauth") return encryptField(encryptField(raw, "access"), "refresh")
        return info
      }

      const all = Effect.fn("Auth.all")(() =>
        readRaw().pipe(
          Effect.flatMap((data) => {
            // Fast-path: if a canary exists and fails verification, the crypto
            // runtime changed (e.g. compiled binary ↔ bun source upgrade).
            // All encrypted keys are unrecoverable — skip per-key decryption
            // attempts and tell the user which providers need re-entry.
            if (data.__canary && !verifyCanary(data.__canary)) {
              const stale = Object.keys(data).filter((k) => k !== "__canary")
              if (stale.length) {
                log.warn(
                  `encryption runtime changed — ${stale.length} provider key(s) need re-entry: ${stale.join(", ")}. ` +
                    `Run "ax-code providers" to reconnect.`,
                )
              }
              return Effect.succeed({} as Record<string, Info>)
            }

            let migrate = false
            let canaryMissing = !data.__canary
            const { __canary: _, ...providerData } = data
            const entries = Record.filterMap(providerData, (value) => {
              const decrypted = decryptEntry(value)
              if (needsReEncrypt(decrypted)) migrate = true
              return Result.fromOption(decode(decrypted), () => undefined)
            })

            // Identify providers whose keys failed decryption (field set to undefined)
            const failed: string[] = []
            for (const [key, value] of Object.entries(providerData)) {
              const decrypted = decryptEntry(value)
              if (decrypted && typeof decrypted === "object" && "type" in decrypted) {
                const d = decrypted as Record<string, unknown>
                const sensitive =
                  d.type === "api"
                    ? ["key"]
                    : d.type === "wellknown"
                      ? ["key", "token"]
                      : d.type === "oauth"
                        ? ["access", "refresh"]
                        : []
                if (sensitive.some((f) => d[f] === undefined) && !(key in entries)) {
                  failed.push(key)
                }
              }
            }
            if (failed.length) {
              log.warn(
                `${failed.length} provider key(s) could not be decrypted: ${failed.join(", ")}. ` +
                  `Run "ax-code providers" to re-enter credentials.`,
              )
            }

            if (migrate || canaryMissing) {
              // Re-encrypt legacy entries with proper 32-byte salt,
              // and write a canary so future upgrades can detect
              // crypto runtime changes without attempting decryption.
              const updated: Record<string, unknown> = { __canary: createCanary() }
              for (const [key, info] of Object.entries(entries)) {
                updated[key] = encryptEntry(info as Info)
              }
              return Effect.tryPromise({
                try: async () => {
                  const releaseFileLock = await acquireFileLock()
                  try {
                    using _ = await Lock.write("auth")
                    await Filesystem.writeJson(file, updated, 0o600)
                  } finally {
                    releaseFileLock()
                  }
                },
                catch: fail("Failed to migrate auth entries"),
              }).pipe(Effect.map(() => entries as Record<string, Info>))
            }
            return Effect.succeed(entries as Record<string, Info>)
          }),
        ),
      )

      const get = Effect.fn("Auth.get")(function* (providerID: string) {
        return (yield* all())[providerID]
      })

      const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
        const norm = key.replace(/[^\w\-.:/]/g, "").replace(/\/+$/, "")
        if (!norm || norm.includes("..")) return yield* new AuthError({ message: "Invalid provider ID" })
        yield* Effect.tryPromise({
          try: async () => {
            const releaseFileLock = await acquireFileLock()
            try {
              using _ = await Lock.write("auth")
              const data = await Filesystem.readJson<Record<string, any>>(file).catch(() => ({}) as Record<string, any>)
              if (norm !== key) delete data[key]
              delete data[norm + "/"]
              if (!data.__canary || !verifyCanary(data.__canary)) data.__canary = createCanary()
              await Filesystem.writeJson(file, { ...data, [norm]: encryptEntry(info) }, 0o600)
            } finally {
              releaseFileLock()
            }
          },
          catch: fail("Failed to write auth data"),
        })
      })

      const remove = Effect.fn("Auth.remove")(function* (key: string) {
        const norm = key.replace(/[^\w\-.:/]/g, "").replace(/\/+$/, "")
        yield* Effect.tryPromise({
          try: async () => {
            const releaseFileLock = await acquireFileLock()
            try {
              using _ = await Lock.write("auth")
              const data = await Filesystem.readJson<Record<string, any>>(file).catch(() => ({}) as Record<string, any>)
              delete data[key]
              delete data[norm]
              delete data[norm + "/"]
              await Filesystem.writeJson(file, data, 0o600)
            } finally {
              releaseFileLock()
            }
          },
          catch: fail("Failed to write auth data"),
        })
      })

      return Service.of({ get, all, set, remove })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function get(providerID: string) {
    return runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((service) => service.remove(key))
  }
}
