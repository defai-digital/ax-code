import { eq } from "drizzle-orm"

import { Database } from "@/storage/db"
import { encrypt, isEncrypted, decrypt, type EncryptedValue } from "@/auth/encryption"
import { AccountStateTable, AccountTable } from "./account.sql"
import { AccessToken, AccountID, AccountRepoError, OrgID, RefreshToken, type Info } from "./schema"
import { toErrorMessage } from "@/util/error-message"
import { Log } from "@/util/log"
import { parseJsonRecord } from "@/util/json-record"

function encryptToken(token: string): string {
  return JSON.stringify(encrypt(token))
}

export function parseEncryptedToken(raw: string): EncryptedValue | undefined {
  const parsed = parseJsonRecord(raw)
  return decodeEncryptedTokenValue(parsed)
}

export function decodeEncryptedTokenValue(value: unknown): EncryptedValue | undefined {
  return isEncrypted(value) ? value : undefined
}

function decryptToken<T extends string>(raw: string, make: (s: string) => T): T {
  const encrypted = parseEncryptedToken(raw)
  if (!encrypted) return make(raw)

  try {
    return make(decrypt(encrypted))
  } catch (error) {
    log.warn("failed to decrypt token", {
      error: toErrorMessage(error),
      tokenLength: raw.length,
    })
    throw new Error("Failed to decrypt token: token may be corrupted or encrypted with a different key", {
      cause: error,
    })
  }
}

export type AccountRow = (typeof AccountTable)["$inferSelect"]

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never

const ACCOUNT_STATE_ID = 1
const log = Log.create({ service: "account.repo" })

function safe(row: unknown): Info | undefined {
  if (!row || typeof row !== "object") return
  const candidate = row as Record<string, unknown>
  if (typeof candidate.id !== "string" || typeof candidate.email !== "string" || typeof candidate.url !== "string") {
    log.warn("invalid account row", { accountID: candidate.id })
    return
  }
  if (candidate.active_org_id !== null && typeof candidate.active_org_id !== "string") {
    log.warn("invalid account row", { accountID: candidate.id })
    return
  }
  return {
    id: AccountID.make(candidate.id),
    email: candidate.email,
    url: candidate.url,
    active_org_id: candidate.active_org_id === null ? null : OrgID.make(candidate.active_org_id),
  } as Info
}

function query<A>(f: (db: DbClient) => A): A {
  try {
    return Database.use(f)
  } catch (cause) {
    throw new AccountRepoError({ message: "Database operation failed", cause })
  }
}

function tx<A>(f: (db: DbClient) => A): A {
  try {
    return Database.transaction(f) as A
  } catch (cause) {
    throw new AccountRepoError({ message: "Database operation failed", cause })
  }
}

function current(db: DbClient) {
  const state = db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()
  if (!state?.active_account_id) return
  const account = db.select().from(AccountTable).where(eq(AccountTable.id, state.active_account_id)).get()
  if (!account) return
  return { ...account, active_org_id: state.active_org_id ?? null }
}

function state(db: DbClient, accountID: AccountID, orgID?: OrgID) {
  return db
    .insert(AccountStateTable)
    .values({ id: ACCOUNT_STATE_ID, active_account_id: accountID, active_org_id: orgID ?? null })
    .onConflictDoUpdate({
      target: AccountStateTable.id,
      set: { active_account_id: accountID, active_org_id: orgID ?? null },
    })
    .run()
}

function decryptRow(row: AccountRow): AccountRow {
  return {
    ...row,
    access_token: decryptToken(row.access_token, AccessToken.make),
    refresh_token: decryptToken(row.refresh_token, RefreshToken.make),
  }
}

export namespace AccountRepo {
  export async function active(): Promise<Info | undefined> {
    return query((db) => {
      const row = current(db)
      return row ? safe(row) : undefined
    })
  }

  export async function list(): Promise<Info[]> {
    return query((db) =>
      db
        .select()
        .from(AccountTable)
        .all()
        .flatMap((row: AccountRow) => {
          const next = safe({ ...row, active_org_id: null })
          return next ? [next] : []
        }),
    )
  }

  export async function remove(accountID: AccountID): Promise<void> {
    tx((db) => {
      db.update(AccountStateTable)
        .set({ active_account_id: null, active_org_id: null })
        .where(eq(AccountStateTable.active_account_id, accountID))
        .run()
      db.delete(AccountTable).where(eq(AccountTable.id, accountID)).run()
    })
  }

  export async function use(accountID: AccountID, orgID?: OrgID): Promise<void> {
    query((db) => state(db, accountID, orgID))
  }

  export async function getRow(accountID: AccountID): Promise<AccountRow | undefined> {
    return query((db) => {
      const row = db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get()
      return row ? decryptRow(row) : undefined
    })
  }

  export async function persistToken(input: {
    accountID: AccountID
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry?: number
  }): Promise<void> {
    query((db) =>
      db
        .update(AccountTable)
        .set({
          access_token: encryptToken(input.accessToken) as AccessToken,
          refresh_token: encryptToken(input.refreshToken) as RefreshToken,
          token_expiry: input.expiry ?? null,
        })
        .where(eq(AccountTable.id, input.accountID))
        .run(),
    )
  }

  export async function persistAccount(input: {
    id: AccountID
    email: string
    url: string
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry: number
    orgID?: OrgID
  }): Promise<void> {
    tx((db) => {
      const encAccess = encryptToken(input.accessToken) as AccessToken
      const encRefresh = encryptToken(input.refreshToken) as RefreshToken
      db.insert(AccountTable)
        .values({
          id: input.id,
          email: input.email,
          url: input.url,
          access_token: encAccess,
          refresh_token: encRefresh,
          token_expiry: input.expiry,
        })
        .onConflictDoUpdate({
          target: AccountTable.id,
          set: {
            email: input.email,
            url: input.url,
            access_token: encAccess,
            refresh_token: encRefresh,
            token_expiry: input.expiry,
          },
        })
        .run()
      void state(db, input.id, input.orgID)
    })
  }
}
