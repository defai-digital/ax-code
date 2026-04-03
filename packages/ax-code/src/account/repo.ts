import { eq } from "drizzle-orm"
import { Effect, Layer, Option, Schema, ServiceMap } from "effect"

import { Database } from "@/storage/db"
import { encrypt, isEncrypted, decrypt, type EncryptedValue } from "@/auth/encryption"
import { AccountStateTable, AccountTable } from "./account.sql"
import { AccessToken, AccountID, AccountRepoError, Info, OrgID, RefreshToken } from "./schema"

function encryptToken(token: string): string {
  return JSON.stringify(encrypt(token))
}

function decryptToken<T extends string>(raw: string, make: (s: string) => T): T {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (isEncrypted(parsed)) return make(decrypt(parsed as EncryptedValue))
  } catch {
    // not JSON or not encrypted — treat as plaintext
  }
  return make(raw)
}

export type AccountRow = (typeof AccountTable)["$inferSelect"]

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never

const ACCOUNT_STATE_ID = 1

export namespace AccountRepo {
  export interface Service {
    readonly active: () => Effect.Effect<Option.Option<Info>, AccountRepoError>
    readonly list: () => Effect.Effect<Info[], AccountRepoError>
    readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountRepoError>
    readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountRepoError>
    readonly getRow: (accountID: AccountID) => Effect.Effect<Option.Option<AccountRow>, AccountRepoError>
    readonly persistToken: (input: {
      accountID: AccountID
      accessToken: AccessToken
      refreshToken: RefreshToken
      expiry: Option.Option<number>
    }) => Effect.Effect<void, AccountRepoError>
    readonly persistAccount: (input: {
      id: AccountID
      email: string
      url: string
      accessToken: AccessToken
      refreshToken: RefreshToken
      expiry: number
      orgID: Option.Option<OrgID>
    }) => Effect.Effect<void, AccountRepoError>
  }
}

export class AccountRepo extends ServiceMap.Service<AccountRepo, AccountRepo.Service>()("@ax-code/AccountRepo") {
  static readonly layer: Layer.Layer<AccountRepo> = Layer.effect(
    AccountRepo,
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownSync(Info)

      const query = <A>(f: (db: DbClient) => A) =>
        Effect.try({
          try: () => Database.use(f),
          catch: (cause) => new AccountRepoError({ message: "Database operation failed", cause }),
        })

      const tx = <A>(f: (db: DbClient) => A) =>
        Effect.try({
          try: () => Database.transaction(f),
          catch: (cause) => new AccountRepoError({ message: "Database operation failed", cause }),
        })

      const current = (db: DbClient) => {
        const state = db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()
        if (!state?.active_account_id) return
        const account = db.select().from(AccountTable).where(eq(AccountTable.id, state.active_account_id)).get()
        if (!account) return
        return { ...account, active_org_id: state.active_org_id ?? null }
      }

      const state = (db: DbClient, accountID: AccountID, orgID: Option.Option<OrgID>) => {
        const id = Option.getOrNull(orgID)
        return db
          .insert(AccountStateTable)
          .values({ id: ACCOUNT_STATE_ID, active_account_id: accountID, active_org_id: id })
          .onConflictDoUpdate({
            target: AccountStateTable.id,
            set: { active_account_id: accountID, active_org_id: id },
          })
          .run()
      }

      const active = Effect.fn("AccountRepo.active")(() =>
        query((db) => current(db)).pipe(Effect.map((row) => (row ? Option.some(decode(row)) : Option.none()))),
      )

      const list = Effect.fn("AccountRepo.list")(() =>
        query((db) =>
          db
            .select()
            .from(AccountTable)
            .all()
            .map((row: AccountRow) => decode({ ...row, active_org_id: null })),
        ),
      )

      const remove = Effect.fn("AccountRepo.remove")((accountID: AccountID) =>
        tx((db) => {
          db.update(AccountStateTable)
            .set({ active_account_id: null, active_org_id: null })
            .where(eq(AccountStateTable.active_account_id, accountID))
            .run()
          db.delete(AccountTable).where(eq(AccountTable.id, accountID)).run()
        }).pipe(Effect.asVoid),
      )

      const use = Effect.fn("AccountRepo.use")((accountID: AccountID, orgID: Option.Option<OrgID>) =>
        query((db) => state(db, accountID, orgID)).pipe(Effect.asVoid),
      )

      const decryptRow = (row: AccountRow): AccountRow => ({
        ...row,
        access_token: decryptToken(row.access_token, AccessToken.make),
        refresh_token: decryptToken(row.refresh_token, RefreshToken.make),
      })

      const getRow = Effect.fn("AccountRepo.getRow")((accountID: AccountID) =>
        query((db) => db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get()).pipe(
          Effect.map((row) => Option.fromNullishOr(row ? decryptRow(row) : row)),
        ),
      )

      const persistToken = Effect.fn("AccountRepo.persistToken")((input) =>
        query((db) =>
          db
            .update(AccountTable)
            .set({
              access_token: encryptToken(input.accessToken) as AccessToken,
              refresh_token: encryptToken(input.refreshToken) as RefreshToken,
              token_expiry: Option.getOrNull(input.expiry),
            })
            .where(eq(AccountTable.id, input.accountID))
            .run(),
        ).pipe(Effect.asVoid),
      )

      const persistAccount = Effect.fn("AccountRepo.persistAccount")((input) =>
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
        }).pipe(Effect.asVoid),
      )

      return AccountRepo.of({
        active,
        list,
        remove,
        use,
        getRow,
        persistToken,
        persistAccount,
      })
    }),
  )
}
