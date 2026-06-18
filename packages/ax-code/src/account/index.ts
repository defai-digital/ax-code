import z from "zod"

import { Log } from "@/util/log"
import { toErrorMessage } from "@/util/error-message"
import { AccountRepo, type AccountRow } from "./repo"
import {
  type AccountError,
  AccountRepoError,
  AccessToken,
  type AccessToken as AccessTokenType,
  AccountID,
  type AccountID as AccountIDType,
  DeviceCode,
  type Info,
  RefreshToken,
  AccountServiceError,
  Login,
  type Org,
  OrgID,
  type OrgID as OrgIDType,
  PollDenied,
  PollError,
  PollExpired,
  PollPending,
  type PollResult,
  PollSlow,
  PollSuccess,
  UserCode,
} from "./schema"

export {
  AccountID,
  type AccountError,
  AccountRepoError,
  AccountServiceError,
  AccessToken,
  RefreshToken,
  DeviceCode,
  UserCode,
  type Info,
  type Org,
  OrgID,
  Login,
  PollSuccess,
  PollPending,
  PollSlow,
  PollExpired,
  PollDenied,
  PollError,
  type PollResult,
} from "./schema"

export type AccountOrgs = {
  account: Info
  orgs: readonly Org[]
}

type Fetcher = typeof fetch

const log = Log.create({ service: "account" })
const clientId = "ax-code-cli"

const JsonRecord = z.record(z.string(), z.unknown())
const DurationFromSeconds = z.number().transform((seconds) => seconds * 1000)
const AccessTokenSchema = z.string().transform(AccessToken.make)
const RefreshTokenSchema = z.string().transform(RefreshToken.make)
const AccountIDSchema = z.string().transform(AccountID.make)
const OrgIDSchema = z.string().transform(OrgID.make)
const DeviceCodeSchema = z.string().transform(DeviceCode.make)
const UserCodeSchema = z.string().transform(UserCode.make)

const RemoteConfig = z.object({
  config: JsonRecord,
})

const TokenRefresh = z.object({
  access_token: AccessTokenSchema,
  refresh_token: RefreshTokenSchema,
  expires_in: DurationFromSeconds,
})

const DeviceAuth = z.object({
  device_code: DeviceCodeSchema,
  user_code: UserCodeSchema,
  verification_uri_complete: z.string(),
  expires_in: DurationFromSeconds,
  interval: DurationFromSeconds,
})

const DeviceTokenSuccess = z.object({
  access_token: AccessTokenSchema,
  refresh_token: RefreshTokenSchema,
  token_type: z.literal("Bearer"),
  expires_in: DurationFromSeconds,
})

const DeviceTokenError = z.object({
  error: z.string(),
  error_description: z.string(),
})

const DeviceToken = z.union([DeviceTokenSuccess, DeviceTokenError])

const User = z.object({
  id: AccountIDSchema,
  email: z.string(),
})

const OrgList = z.array(
  z.object({
    id: OrgIDSchema,
    name: z.string(),
  }),
)

function accountServiceError(message: string, cause: unknown): AccountServiceError {
  return cause instanceof AccountServiceError ? cause : new AccountServiceError({ message, cause })
}

function accountRepoError(cause: unknown): AccountRepoError {
  return cause instanceof AccountRepoError
    ? cause
    : new AccountRepoError({ message: "Database operation failed", cause })
}

function toPollResult(input: z.output<typeof DeviceTokenError>): PollResult {
  if (input.error === "authorization_pending") return new PollPending()
  if (input.error === "slow_down") return new PollSlow()
  if (input.error === "expired_token") return new PollExpired()
  if (input.error === "access_denied") return new PollDenied()
  return new PollError({ cause: input.error })
}

function shouldRetry(response: Response) {
  return response.status === 408 || response.status === 429 || response.status >= 500
}

// Exponential backoff with jitter, matching the previous Effect client
// (Schedule.exponential(200).jittered): wait before each retry so a
// transient 429/5xx isn't immediately hammered with back-to-back requests.
async function backoff(attempt: number): Promise<void> {
  const base = 200 * 2 ** attempt
  const jittered = base * (0.5 + Math.random())
  await new Promise((resolve) => setTimeout(resolve, jittered))
}

async function fetchWithReadRetry(fetcher: Fetcher, input: string, init: RequestInit): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(input, init)
      if (attempt < 2 && shouldRetry(response)) {
        await backoff(attempt)
        continue
      }
      return response
    } catch (error) {
      lastError = error
      if (attempt === 2) break
      await backoff(attempt)
    }
  }
  throw accountServiceError("HTTP request failed", lastError)
}

async function request(fetcher: Fetcher, input: string, init: RequestInit = {}, retryRead = false): Promise<Response> {
  try {
    return retryRead ? await fetchWithReadRetry(fetcher, input, init) : await fetcher(input, init)
  } catch (cause) {
    throw accountServiceError("HTTP request failed", cause)
  }
}

async function jsonBody<T>(
  response: Response,
  schema: z.ZodType<T>,
  message = "Failed to decode response",
): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    throw accountServiceError(message, cause)
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) throw accountServiceError(message, parsed.error)
  return parsed.data
}

function ok(response: Response): Response {
  if (!response.ok) {
    throw new AccountServiceError({
      message: "HTTP request failed",
      cause: `HTTP ${response.status}`,
    })
  }
  return response
}

function jsonPost(body: unknown, headers: HeadersInit = {}): RequestInit {
  return {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  }
}

function jsonGet(headers: HeadersInit = {}): RequestInit {
  return {
    method: "GET",
    headers: {
      accept: "application/json",
      ...headers,
    },
  }
}

function bearer(accessToken: AccessTokenType): HeadersInit {
  return { authorization: `Bearer ${accessToken}` }
}

async function repo<A>(operation: () => Promise<A>): Promise<A> {
  try {
    return await operation()
  } catch (cause) {
    throw accountRepoError(cause)
  }
}

export namespace Account {
  export interface Interface {
    readonly active: () => Promise<Info | undefined>
    readonly list: () => Promise<Info[]>
    readonly orgsByAccount: () => Promise<readonly AccountOrgs[]>
    readonly remove: (accountID: AccountIDType) => Promise<void>
    readonly use: (accountID: AccountIDType, orgID?: OrgIDType) => Promise<void>
    readonly orgs: (accountID: AccountIDType) => Promise<readonly Org[]>
    readonly config: (accountID: AccountIDType, orgID: OrgIDType) => Promise<Record<string, unknown> | undefined>
    readonly token: (accountID: AccountIDType) => Promise<AccessTokenType | undefined>
    readonly login: (url: string) => Promise<Login>
    readonly poll: (input: Login) => Promise<PollResult>
  }

  export interface Options {
    readonly fetch?: Fetcher
    readonly now?: () => number
  }

  export function create(options: Options = {}): Interface {
    const fetcher = options.fetch ?? fetch
    const now = options.now ?? Date.now

    const resolveToken = async (row: AccountRow): Promise<AccessTokenType> => {
      const currentTime = now()
      if (row.token_expiry && row.token_expiry > currentTime) return row.access_token

      const response = ok(
        await request(
          fetcher,
          `${row.url}/auth/device/token`,
          jsonPost({
            grant_type: "refresh_token",
            refresh_token: row.refresh_token,
            client_id: clientId,
          }),
        ),
      )

      const parsed = await jsonBody(response, TokenRefresh)
      await repo(() =>
        AccountRepo.persistToken({
          accountID: row.id,
          accessToken: parsed.access_token,
          refreshToken: parsed.refresh_token,
          expiry: currentTime + parsed.expires_in,
        }),
      )

      return parsed.access_token
    }

    const resolveAccess = async (accountID: AccountIDType) => {
      const account = await repo(() => AccountRepo.getRow(accountID))
      if (!account) return
      return { account, accessToken: await resolveToken(account) }
    }

    const fetchOrgs = async (url: string, accessToken: AccessTokenType): Promise<readonly Org[]> => {
      const response = ok(await request(fetcher, `${url}/api/orgs`, jsonGet(bearer(accessToken)), true))
      return jsonBody(response, OrgList)
    }

    const fetchUser = async (url: string, accessToken: AccessTokenType) => {
      const response = ok(await request(fetcher, `${url}/api/user`, jsonGet(bearer(accessToken)), true))
      return jsonBody(response, User)
    }

    const service: Interface = {
      active: () => repo(() => AccountRepo.active()),
      list: () => repo(() => AccountRepo.list()),
      async orgsByAccount() {
        const accounts = await repo(() => AccountRepo.list())
        const results = await Promise.allSettled(
          accounts.map(async (account) => ({ account, orgs: await service.orgs(account.id) })),
        )
        return results.flatMap((result) => {
          if (result.status === "fulfilled") return [result.value]
          log.warn("failed to fetch orgs for account", { error: toErrorMessage(result.reason) })
          return []
        })
      },
      remove: (accountID) => repo(() => AccountRepo.remove(accountID)),
      use: (accountID, orgID) => repo(() => AccountRepo.use(accountID, orgID)),
      async orgs(accountID) {
        const resolved = await resolveAccess(accountID)
        if (!resolved) return []
        return fetchOrgs(resolved.account.url, resolved.accessToken)
      },
      async config(accountID, orgID) {
        const resolved = await resolveAccess(accountID)
        if (!resolved) return

        const response = await request(
          fetcher,
          `${resolved.account.url}/api/config`,
          jsonGet({
            ...bearer(resolved.accessToken),
            "x-org-id": orgID,
          }),
          true,
        )

        if (response.status === 404) return
        const parsed = await jsonBody(ok(response), RemoteConfig)
        return parsed.config
      },
      async token(accountID) {
        const resolved = await resolveAccess(accountID)
        return resolved?.accessToken
      },
      async login(server) {
        const response = ok(
          await request(
            fetcher,
            `${server}/auth/device/code`,
            jsonPost({
              client_id: clientId,
            }),
          ),
        )

        const parsed = await jsonBody(response, DeviceAuth)
        return new Login({
          code: parsed.device_code,
          user: parsed.user_code,
          url: `${server}${parsed.verification_uri_complete}`,
          server,
          expiry: parsed.expires_in,
          interval: parsed.interval,
        })
      },
      async poll(input) {
        const response = await request(
          fetcher,
          `${input.server}/auth/device/token`,
          jsonPost({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: input.code,
            client_id: clientId,
          }),
        )

        const parsed = await jsonBody(response, DeviceToken)
        if ("error" in parsed) return toPollResult(parsed)

        const accessToken = parsed.access_token
        const [account, remoteOrgs] = await Promise.all([
          fetchUser(input.server, accessToken),
          fetchOrgs(input.server, accessToken),
        ])
        const firstOrgID = remoteOrgs[0]?.id

        await repo(() =>
          AccountRepo.persistAccount({
            id: account.id,
            email: account.email,
            url: input.server,
            accessToken,
            refreshToken: parsed.refresh_token,
            expiry: now() + parsed.expires_in,
            orgID: firstOrgID,
          }),
        )

        return new PollSuccess({ email: account.email })
      },
    }

    return service
  }

  const defaultService = create()

  export let active = defaultService.active
  export let list = defaultService.list
  export let orgsByAccount = defaultService.orgsByAccount
  export let remove = defaultService.remove
  export let use = defaultService.use
  export let orgs = defaultService.orgs
  export let config = defaultService.config
  export let token = defaultService.token
  export let login = defaultService.login
  export let poll = defaultService.poll

  export function durationToMillis(duration: Login["interval"]): number {
    return duration
  }
}
