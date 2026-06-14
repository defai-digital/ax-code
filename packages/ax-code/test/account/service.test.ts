import { beforeEach, expect, test } from "bun:test"

import { AccountRepo } from "../../src/account/repo"
import { Account } from "../../src/account"
import { AccessToken, AccountID, DeviceCode, Login, OrgID, RefreshToken, UserCode } from "../../src/account/schema"
import { Database } from "../../src/storage/db"

beforeEach(() => {
  const db = Database.Client()
  db.run(/*sql*/ `DELETE FROM account_state`)
  db.run(/*sql*/ `DELETE FROM account`)
})

const fetchClient = (handler: (req: Request) => Response | Promise<Response>): typeof fetch =>
  ((input, init) => handler(new Request(input, init))) as typeof fetch

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const org = (id: string, name: string) => ({ id, name })

const login = () =>
  new Login({
    code: DeviceCode.make("device-code"),
    user: UserCode.make("user-code"),
    url: "https://one.example.com/verify",
    server: "https://one.example.com",
    expiry: 600_000,
    interval: 5_000,
  })

const deviceTokenClient = (body: unknown, status = 400) =>
  fetchClient((req) => (req.url === "https://one.example.com/auth/device/token" ? json(body, status) : json({}, 404)))

const poll = (body: unknown, status = 400) => Account.create({ fetch: deviceTokenClient(body, status) }).poll(login())

test("orgsByAccount groups orgs per account", async () => {
  await AccountRepo.persistAccount({
    id: AccountID.make("user-1"),
    email: "one@example.com",
    url: "https://one.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 60_000,
    orgID: undefined,
  })

  await AccountRepo.persistAccount({
    id: AccountID.make("user-2"),
    email: "two@example.com",
    url: "https://two.example.com",
    accessToken: AccessToken.make("at_2"),
    refreshToken: RefreshToken.make("rt_2"),
    expiry: Date.now() + 60_000,
    orgID: undefined,
  })

  const seen: Array<string> = []
  const client = fetchClient((req) => {
    seen.push(`${req.method} ${req.url}`)

    if (req.url === "https://one.example.com/api/orgs") {
      return json([org("org-1", "One")])
    }

    if (req.url === "https://two.example.com/api/orgs") {
      return json([org("org-2", "Two A"), org("org-3", "Two B")])
    }

    return json([], 404)
  })

  const rows = await Account.create({ fetch: client }).orgsByAccount()

  expect(rows.map((row) => [row.account.id, row.orgs.map((org) => org.id)]).map(([id, orgs]) => [id, orgs])).toEqual([
    [AccountID.make("user-1"), [OrgID.make("org-1")]],
    [AccountID.make("user-2"), [OrgID.make("org-2"), OrgID.make("org-3")]],
  ])
  expect(seen).toEqual(["GET https://one.example.com/api/orgs", "GET https://two.example.com/api/orgs"])
})

test("token refresh persists the new token", async () => {
  const id = AccountID.make("user-1")

  await AccountRepo.persistAccount({
    id,
    email: "user@example.com",
    url: "https://one.example.com",
    accessToken: AccessToken.make("at_old"),
    refreshToken: RefreshToken.make("rt_old"),
    expiry: Date.now() - 1_000,
    orgID: undefined,
  })

  const client = fetchClient((req) =>
    req.url === "https://one.example.com/auth/device/token"
      ? json({
          access_token: "at_new",
          refresh_token: "rt_new",
          expires_in: 60,
        })
      : json({}, 404),
  )

  const token = await Account.create({ fetch: client }).token(id)

  expect(token).toBeDefined()
  expect(String(token!)).toBe("at_new")

  const row = await AccountRepo.getRow(id)
  const value = row!
  expect(value.access_token).toBe(AccessToken.make("at_new"))
  expect(value.refresh_token).toBe(RefreshToken.make("rt_new"))
  expect(value.token_expiry).toBeGreaterThan(Date.now())
})

test("config sends the selected org header", async () => {
  const id = AccountID.make("user-1")

  await AccountRepo.persistAccount({
    id,
    email: "user@example.com",
    url: "https://one.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 60_000,
    orgID: undefined,
  })

  const seen: { auth?: string | null; org?: string | null } = {}
  const client = fetchClient((req) => {
    seen.auth = req.headers.get("authorization")
    seen.org = req.headers.get("x-org-id")

    if (req.url === "https://one.example.com/api/config") {
      return json({ config: { theme: "light", seats: 5 } })
    }

    return json({}, 404)
  })

  const cfg = await Account.create({ fetch: client }).config(id, OrgID.make("org-9"))

  expect(cfg).toEqual({ theme: "light", seats: 5 })
  expect(seen).toEqual({
    auth: "Bearer at_1",
    org: "org-9",
  })
})

test("poll stores the account and first org on success", async () => {
  const client = fetchClient((req) =>
    req.url === "https://one.example.com/auth/device/token"
      ? json({
          access_token: "at_1",
          refresh_token: "rt_1",
          token_type: "Bearer",
          expires_in: 60,
        })
      : req.url === "https://one.example.com/api/user"
        ? json({ id: "user-1", email: "user@example.com" })
        : req.url === "https://one.example.com/api/orgs"
          ? json([org("org-1", "One")])
          : json({}, 404),
  )

  const res = await Account.create({ fetch: client }).poll(login())

  expect(res._tag).toBe("PollSuccess")
  if (res._tag === "PollSuccess") {
    expect(res.email).toBe("user@example.com")
  }

  const active = await AccountRepo.active()
  expect(active!).toEqual(
    expect.objectContaining({
      id: "user-1",
      email: "user@example.com",
      active_org_id: "org-1",
    }),
  )
})

for (const [name, body, expectedTag] of [
  [
    "pending",
    {
      error: "authorization_pending",
      error_description: "The authorization request is still pending",
    },
    "PollPending",
  ],
  [
    "slow",
    {
      error: "slow_down",
      error_description: "Polling too frequently, please slow down",
    },
    "PollSlow",
  ],
  [
    "denied",
    {
      error: "access_denied",
      error_description: "The authorization request was denied",
    },
    "PollDenied",
  ],
  [
    "expired",
    {
      error: "expired_token",
      error_description: "The device code has expired",
    },
    "PollExpired",
  ],
] as const) {
  test(`poll returns ${name} for ${body.error}`, async () => {
    const result = await poll(body)
    expect(result._tag).toBe(expectedTag)
  })
}

test("poll returns poll error for other OAuth errors", async () => {
  const result = await poll({
    error: "server_error",
    error_description: "An unexpected error occurred",
  })

  expect(result._tag).toBe("PollError")
  if (result._tag === "PollError") {
    expect(result.cause).toBe("server_error")
  }
})
