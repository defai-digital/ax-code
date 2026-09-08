import type { AuthOAuthResult, Hooks } from "@ax-code/plugin"
import { NamedError } from "@ax-code/util/error"
import { Auth } from "@/auth"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Plugin } from "../plugin"
import { ProviderID } from "./schema"
import { isRetiredProviderID } from "./retired-providers"
import z from "zod"

export namespace ProviderAuth {
  const log = Log.create({ service: "provider.auth" })

  /**
   * A pending flow is only valid for a short window. Without an expiry a
   * flow abandoned by the user (closed tab, cancelled redirect) could be
   * completed arbitrarily later, and the per-instance map would never
   * shrink; without supersession logging a double-initiated authorize
   * silently dropped the first flow's callback closure.
   */
  const PENDING_FLOW_TTL_MS = 10 * 60 * 1000

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
      prompts: z
        .array(
          z.union([
            z.object({
              type: z.literal("text"),
              key: z.string(),
              message: z.string(),
              placeholder: z.string().optional(),
              when: z
                .object({
                  key: z.string(),
                  op: z.union([z.literal("eq"), z.literal("neq")]),
                  value: z.string(),
                })
                .optional(),
            }),
            z.object({
              type: z.literal("select"),
              key: z.string(),
              message: z.string(),
              options: z.array(
                z.object({
                  label: z.string(),
                  value: z.string(),
                  hint: z.string().optional(),
                }),
              ),
              when: z
                .object({
                  key: z.string(),
                  op: z.union([z.literal("eq"), z.literal("neq")]),
                  value: z.string(),
                })
                .optional(),
            }),
          ]),
        )
        .optional(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const OauthMissing = NamedError.create("ProviderAuthOauthMissing", z.object({ providerID: ProviderID.zod }))

  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({ providerID: ProviderID.zod }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))

  export const ValidationFailed = NamedError.create(
    "ProviderAuthValidationFailed",
    z.object({
      field: z.string(),
      message: z.string(),
    }),
  )

  export type Error =
    | Auth.AuthError
    | InstanceType<typeof OauthMissing>
    | InstanceType<typeof OauthCodeMissing>
    | InstanceType<typeof OauthCallbackFailed>
    | InstanceType<typeof ValidationFailed>

  type Hook = NonNullable<Hooks["auth"]>

  interface State {
    hooks: Record<ProviderID, Hook>
    pending: Map<ProviderID, { flow: AuthOAuthResult; expiresAt: number }>
  }

  const state = Instance.state(async (): Promise<State> => {
    const plugins = await Plugin.list()
    return {
      hooks: Object.fromEntries(
        plugins
          .filter((plugin) => plugin.auth?.provider !== undefined && !isRetiredProviderID(plugin.auth.provider))
          .map((plugin) => [ProviderID.make(plugin.auth!.provider), plugin.auth!] as const),
      ) as Record<ProviderID, Hook>,
      pending: new Map<ProviderID, { flow: AuthOAuthResult; expiresAt: number }>(),
    }
  })

  export async function methods() {
    const hooks = (await state()).hooks
    return Object.fromEntries(
      Object.entries(hooks).map(([providerID, item]) => [
        providerID,
        item.methods.map(
          (method): Method => ({
            type: method.type,
            label: method.label,
            prompts: method.prompts?.map((prompt) => {
              if (prompt.type === "select") {
                return {
                  type: "select" as const,
                  key: prompt.key,
                  message: prompt.message,
                  options: prompt.options,
                  when: prompt.when,
                }
              }
              return {
                type: "text" as const,
                key: prompt.key,
                message: prompt.message,
                placeholder: prompt.placeholder,
                when: prompt.when,
              }
            }),
          }),
        ),
      ]),
    ) as Record<ProviderID, Method[]>
  }

  export async function authorize(input: {
    providerID: ProviderID
    method: number
    inputs?: Record<string, string>
  }): Promise<Authorization | undefined> {
    const { hooks, pending } = await state()
    // Bounds-check both `providerID` and `method` before chaining
    // property accesses. Previously an invalid providerID or
    // out-of-range method index crashed the Effect service with a
    // raw TypeError, taking down the whole auth flow for every
    // provider until the service restarted. Reuse the existing
    // `OauthMissing` typed error so the failure flows through the
    // service's declared error channel.
    const provider = hooks[input.providerID]
    if (!provider) {
      throw new OauthMissing({ providerID: input.providerID })
    }
    const method = provider.methods[input.method]
    if (!method) {
      throw new OauthMissing({ providerID: input.providerID })
    }
    if (method.type !== "oauth") return

    if (method.prompts && input.inputs) {
      for (const prompt of method.prompts) {
        if (prompt.type === "text" && prompt.validate && input.inputs[prompt.key] !== undefined) {
          const error = prompt.validate(input.inputs[prompt.key])
          if (error) throw new ValidationFailed({ field: prompt.key, message: error })
        }
      }
    }

    const result = await method.authorize(input.inputs)
    const previous = pending.get(input.providerID)
    if (previous && Date.now() < previous.expiresAt) {
      log.warn("superseding an unexpired pending oauth flow", { providerID: input.providerID })
    }
    pending.set(input.providerID, { flow: result, expiresAt: Date.now() + PENDING_FLOW_TTL_MS })
    return {
      url: result.url,
      method: result.method,
      instructions: result.instructions,
    }
  }

  export async function callback(input: {
    providerID: ProviderID
    method: number
    code?: string
    signal?: AbortSignal
  }) {
    const pending = (await state()).pending
    const entry = pending.get(input.providerID)
    if (!entry) throw new OauthMissing({ providerID: input.providerID })
    // A flow older than the TTL is treated as abandoned: the callback
    // closure is dropped instead of completing an exchange the user gave up
    // on minutes ago.
    if (Date.now() > entry.expiresAt) {
      pending.delete(input.providerID)
      throw new OauthMissing({ providerID: input.providerID })
    }
    const match = entry.flow
    if (match.method === "code" && !input.code) {
      throw new OauthCodeMissing({ providerID: input.providerID })
    }

    let result: Awaited<ReturnType<typeof match.callback>>
    try {
      result = match.method === "code" ? await match.callback(input.code!) : await match.callback(input.signal)
    } finally {
      pending.delete(input.providerID)
    }
    if (!result || result.type !== "success") throw new OauthCallbackFailed({})

    // Exclusive branches: a result with both `key` and `refresh` must not
    // silently overwrite API credentials with OAuth (or vice versa). Prefer
    // the oauth shape when a non-empty refresh token is present.
    if ("refresh" in result && typeof result.refresh === "string" && result.refresh.length > 0) {
      await Auth.set(input.providerID, {
        type: "oauth",
        access: result.access,
        refresh: result.refresh,
        expires: result.expires,
        ...(result.accountId ? { accountId: result.accountId } : {}),
      })
    } else if ("key" in result) {
      await Auth.set(input.providerID, {
        type: "api",
        key: result.key,
      })
    } else if ("refresh" in result) {
      // Access token without a usable refresh token — still persist oauth so
      // the access token can be used until expiry. The Auth schema requires
      // `refresh`, so an empty string is the explicit "no refresh token"
      // marker rather than an omission.
      await Auth.set(input.providerID, {
        type: "oauth",
        access: result.access,
        refresh: result.refresh || "",
        expires: result.expires,
        ...(result.accountId ? { accountId: result.accountId } : {}),
      })
    } else {
      // A success result carrying no credential shape at all must not
      // report success with nothing persisted — that silently lied to the
      // user about the provider being connected.
      throw new OauthCallbackFailed({})
    }
  }
}
