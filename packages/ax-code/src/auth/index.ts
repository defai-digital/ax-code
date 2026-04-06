import path from "path"
import { Effect, Layer, Record, Result, Schema, ServiceMap } from "effect"
import { makeRunPromise } from "@/effect/run-service"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { encryptField, decryptField } from "./encryption"

export const OAUTH_DUMMY_KEY = "ax-code-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

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
            let migrate = false
            const entries = Record.filterMap(data, (value) => {
              const decrypted = decryptEntry(value)
              if (needsReEncrypt(decrypted)) migrate = true
              return Result.fromOption(decode(decrypted), () => undefined)
            })
            if (migrate) {
              // Re-encrypt legacy entries with proper 32-byte salt
              const updated = { ...data }
              for (const [key, info] of Object.entries(entries)) {
                updated[key] = encryptEntry(info)
              }
              return Effect.tryPromise({
                try: () => Filesystem.writeJson(file, updated, 0o600),
                catch: fail("Failed to migrate legacy auth entries"),
              }).pipe(Effect.map(() => entries))
            }
            return Effect.succeed(entries)
          }),
        ),
      )

      const get = Effect.fn("Auth.get")(function* (providerID: string) {
        return (yield* all())[providerID]
      })

      const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
        const norm = key.replace(/[^\w\-.:/]/g, "").replace(/\/+$/, "")
        if (!norm || norm.includes("..")) return yield* new AuthError({ message: "Invalid provider ID" })
        const data = yield* readRaw()
        if (norm !== key) delete data[key]
        delete data[norm + "/"]

        yield* Effect.tryPromise({
          try: () => Filesystem.writeJson(file, { ...data, [norm]: encryptEntry(info) }, 0o600),
          catch: fail("Failed to write auth data"),
        })
      })

      const remove = Effect.fn("Auth.remove")(function* (key: string) {
        const norm = key.replace(/[^\w\-.:/]/g, "").replace(/\/+$/, "")
        const data = yield* readRaw()
        delete data[key]
        delete data[norm]
        delete data[norm + "/"]
        yield* Effect.tryPromise({
          try: () => Filesystem.writeJson(file, data, 0o600),
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
