import { afterEach, test, expect, mock, spyOn } from "bun:test"
import { ShareNext } from "../../src/share/share-next"
import { AccessToken, Account, AccountID, OrgID } from "../../src/account"
import { Config } from "../../src/config/config"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { SessionShareTable } from "../../src/share/share.sql"
import path from "path"
import dns from "dns/promises"

const projectRoot = path.join(__dirname, "../..")

afterEach(() => {
  ShareNext.dispose()
})

test("ShareNext.request uses legacy share API without active org account", async () => {
  const originalActive = Account.active
  const originalConfigGet = Config.get

  Account.active = mock(async () => undefined)
  Config.get = mock(async () => ({ enterprise: { url: "https://legacy-share.example.com" } }))

  try {
    const req = await ShareNext.request()

    expect(req.api.create).toBe("/api/share")
    expect(req.api.sync("shr_123")).toBe("/api/share/shr_123/sync")
    expect(req.api.remove("shr_123")).toBe("/api/share/shr_123")
    expect(req.api.data("shr_123")).toBe("/api/share/shr_123/data")
    expect(req.baseUrl).toBe("https://legacy-share.example.com")
    expect(req.headers).toEqual({})
  } finally {
    Account.active = originalActive
    Config.get = originalConfigGet
  }
})

test("ShareNext.request uses org share API with auth headers when account is active", async () => {
  const originalActive = Account.active
  const originalToken = Account.token

  Account.active = mock(async () => ({
    id: AccountID.make("account-1"),
    email: "user@example.com",
    url: "https://control.example.com",
    active_org_id: OrgID.make("org-1"),
  }))
  Account.token = mock(async () => AccessToken.make("st_test_token"))

  try {
    const req = await ShareNext.request()

    expect(req.api.create).toBe("/api/shares")
    expect(req.api.sync("shr_123")).toBe("/api/shares/shr_123/sync")
    expect(req.api.remove("shr_123")).toBe("/api/shares/shr_123")
    expect(req.api.data("shr_123")).toBe("/api/shares/shr_123/data")
    expect(req.baseUrl).toBe("https://control.example.com")
    expect(req.headers).toEqual({
      authorization: "Bearer st_test_token",
      "x-org-id": "org-1",
    })
  } finally {
    Account.active = originalActive
    Account.token = originalToken
  }
})

test("ShareNext.request fails when org account has no token", async () => {
  const originalActive = Account.active
  const originalToken = Account.token

  Account.active = mock(async () => ({
    id: AccountID.make("account-1"),
    email: "user@example.com",
    url: "https://control.example.com",
    active_org_id: OrgID.make("org-1"),
  }))
  Account.token = mock(async () => undefined)

  try {
    await expect(ShareNext.request()).rejects.toThrow("No active account token available for sharing")
  } finally {
    Account.active = originalActive
    Account.token = originalToken
  }
})

test("ShareNext stops retrying after the max retry count", async () => {
  const originalFetch = globalThis.fetch
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const lookupSpy = spyOn(dns, "lookup").mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }] as any)
  let calls = 0

  globalThis.fetch = ((async () => {
    calls++
    return new Response("fail", { status: 500 })
  }) as unknown) as typeof fetch
  globalThis.setTimeout = ((fn: (...args: any[]) => void, _ms?: number, ...args: any[]) =>
    originalSetTimeout(() => fn(...args), 0)) as typeof setTimeout
  globalThis.clearTimeout = ((id: Timer) => originalClearTimeout(id)) as typeof clearTimeout

  try {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        ShareNext.dispose()
        await ShareNext.init()

        const session = await Session.create({})
        Database.use((db) =>
          db
            .insert(SessionShareTable)
            .values({ session_id: session.id, id: "shr_retry", secret: "sec_retry", url: "https://example.com/retry" })
            .run(),
        )

        await Bus.publish(Session.Event.Updated, { info: { ...session, share: { url: "https://example.com/retry" } } })
        await new Promise((resolve) => originalSetTimeout(resolve, 50))
        expect(calls).toBe(11)

        await new Promise((resolve) => originalSetTimeout(resolve, 20))
        expect(calls).toBe(11)

        await Session.remove(session.id).catch(() => {})
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    lookupSpy.mockRestore()
  }
})
