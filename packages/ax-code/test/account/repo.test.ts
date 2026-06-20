import { beforeEach, expect, test } from "vitest"

import { AccountRepo } from "../../src/account/repo"
import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { Database } from "../../src/storage/db"

beforeEach(() => {
  const db = Database.Client()
  db.run(/*sql*/ `DELETE FROM account_state`)
  db.run(/*sql*/ `DELETE FROM account`)
})

test("list returns empty when no accounts exist", async () => {
  const accounts = await AccountRepo.list()
  expect(accounts).toEqual([])
})

test("active returns none when no accounts exist", async () => {
  const active = await AccountRepo.active()
  expect(active).toBeUndefined()
})

test("persistAccount inserts and getRow retrieves", async () => {
  const id = AccountID.make("user-1")
  await AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_123"),
    refreshToken: RefreshToken.make("rt_456"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-1"),
  })

  const row = await AccountRepo.getRow(id)
  expect(row).toBeDefined()
  const value = row!
  expect(value.id).toBe(AccountID.make("user-1"))
  expect(value.email).toBe("test@example.com")

  const active = await AccountRepo.active()
  expect(active!.active_org_id).toBe(OrgID.make("org-1"))
})

test("persistAccount sets the active account and org", async () => {
  const id1 = AccountID.make("user-1")
  const id2 = AccountID.make("user-2")

  await AccountRepo.persistAccount({
    id: id1,
    email: "first@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-1"),
  })

  await AccountRepo.persistAccount({
    id: id2,
    email: "second@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_2"),
    refreshToken: RefreshToken.make("rt_2"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-2"),
  })

  // Last persisted account is active with its org
  const active = await AccountRepo.active()
  expect(active).toBeDefined()
  expect(active!.id).toBe(AccountID.make("user-2"))
  expect(active!.active_org_id).toBe(OrgID.make("org-2"))
})

test("list returns all accounts", async () => {
  const id1 = AccountID.make("user-1")
  const id2 = AccountID.make("user-2")

  await AccountRepo.persistAccount({
    id: id1,
    email: "a@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: undefined,
  })

  await AccountRepo.persistAccount({
    id: id2,
    email: "b@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_2"),
    refreshToken: RefreshToken.make("rt_2"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-1"),
  })

  const accounts = await AccountRepo.list()
  expect(accounts.length).toBe(2)
  expect(accounts.map((a) => a.email).sort()).toEqual(["a@example.com", "b@example.com"])
})

test("remove deletes an account", async () => {
  const id = AccountID.make("user-1")

  await AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: undefined,
  })

  await AccountRepo.remove(id)

  const row = await AccountRepo.getRow(id)
  expect(row).toBeUndefined()
})

test("use stores the selected org and marks the account active", async () => {
  const id1 = AccountID.make("user-1")
  const id2 = AccountID.make("user-2")

  await AccountRepo.persistAccount({
    id: id1,
    email: "first@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: undefined,
  })

  await AccountRepo.persistAccount({
    id: id2,
    email: "second@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_2"),
    refreshToken: RefreshToken.make("rt_2"),
    expiry: Date.now() + 3600_000,
    orgID: undefined,
  })

  await AccountRepo.use(id1, OrgID.make("org-99"))
  const active1 = await AccountRepo.active()
  expect(active1!.id).toBe(id1)
  expect(active1!.active_org_id).toBe(OrgID.make("org-99"))

  await AccountRepo.use(id1)
  const active2 = await AccountRepo.active()
  expect(active2!.active_org_id).toBeNull()
})

test("persistToken updates token fields", async () => {
  const id = AccountID.make("user-1")

  await AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("old_token"),
    refreshToken: RefreshToken.make("old_refresh"),
    expiry: 1000,
    orgID: undefined,
  })

  const expiry = Date.now() + 7200_000
  await AccountRepo.persistToken({
    accountID: id,
    accessToken: AccessToken.make("new_token"),
    refreshToken: RefreshToken.make("new_refresh"),
    expiry: expiry,
  })

  const row = await AccountRepo.getRow(id)
  const value = row!
  expect(value.access_token).toBe(AccessToken.make("new_token"))
  expect(value.refresh_token).toBe(RefreshToken.make("new_refresh"))
  expect(value.token_expiry).toBe(expiry)
})

test("persistToken with no expiry sets token_expiry to null", async () => {
  const id = AccountID.make("user-1")

  await AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("old_token"),
    refreshToken: RefreshToken.make("old_refresh"),
    expiry: 1000,
    orgID: undefined,
  })

  await AccountRepo.persistToken({
    accountID: id,
    accessToken: AccessToken.make("new_token"),
    refreshToken: RefreshToken.make("new_refresh"),
    expiry: undefined,
  })

  const row = await AccountRepo.getRow(id)
  expect(row!.token_expiry).toBeNull()
})

test("persistAccount upserts on conflict", async () => {
  const id = AccountID.make("user-1")

  await AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_v1"),
    refreshToken: RefreshToken.make("rt_v1"),
    expiry: 1000,
    orgID: OrgID.make("org-1"),
  })

  await AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_v2"),
    refreshToken: RefreshToken.make("rt_v2"),
    expiry: 2000,
    orgID: OrgID.make("org-2"),
  })

  const accounts = await AccountRepo.list()
  expect(accounts.length).toBe(1)

  const row = await AccountRepo.getRow(id)
  const value = row!
  expect(value.access_token).toBe(AccessToken.make("at_v2"))

  const active = await AccountRepo.active()
  expect(active!.active_org_id).toBe(OrgID.make("org-2"))
})

test("remove clears active state when deleting the active account", async () => {
  const id = AccountID.make("user-1")

  await AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-1"),
  })

  await AccountRepo.remove(id)

  const active = await AccountRepo.active()
  expect(active).toBeUndefined()
})

test("getRow returns none for nonexistent account", async () => {
  const row = await AccountRepo.getRow(AccountID.make("nope"))
  expect(row).toBeUndefined()
})

test("list skips malformed account rows", async () => {
  const id1 = AccountID.make("user-1")
  const id2 = AccountID.make("user-2")

  await AccountRepo.persistAccount({
    id: id1,
    email: "first@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: undefined,
  })

  await AccountRepo.persistAccount({
    id: id2,
    email: "second@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_2"),
    refreshToken: RefreshToken.make("rt_2"),
    expiry: Date.now() + 3600_000,
    orgID: undefined,
  })

  Database.Client().run(`UPDATE account SET url = CAST(x'0011' AS BLOB) WHERE id = '${id2}'`)

  const accounts = await AccountRepo.list()
  expect(accounts.map((item) => item.id)).toEqual([id1])
})

test("active returns none for malformed active account rows", async () => {
  const id = AccountID.make("user-1")

  await AccountRepo.persistAccount({
    id,
    email: "test@example.com",
    url: "https://control.example.com",
    accessToken: AccessToken.make("at_1"),
    refreshToken: RefreshToken.make("rt_1"),
    expiry: Date.now() + 3600_000,
    orgID: OrgID.make("org-1"),
  })

  Database.Client().run(`UPDATE account SET url = CAST(x'0011' AS BLOB) WHERE id = '${id}'`)
  Database.Client().run(`UPDATE account_state SET active_account_id = '${id}' WHERE id = 1`)

  const active = await AccountRepo.active()
  expect(active).toBeUndefined()
})
