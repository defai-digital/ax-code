import path from "path"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { encryptField, decryptField } from "../auth/encryption"
import { Lock } from "../util/lock"

export namespace McpAuth {
  export const Tokens = z.object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    scope: z.string().optional(),
  })
  export type Tokens = z.infer<typeof Tokens>

  export const ClientInfo = z.object({
    clientId: z.string(),
    clientSecret: z.string().optional(),
    clientIdIssuedAt: z.number().optional(),
    clientSecretExpiresAt: z.number().optional(),
  })
  export type ClientInfo = z.infer<typeof ClientInfo>

  export const Entry = z.object({
    tokens: Tokens.optional(),
    clientInfo: ClientInfo.optional(),
    codeVerifier: z.string().optional(),
    oauthState: z.string().optional(),
    serverUrl: z.string().optional(), // Track the URL these credentials are for
  })
  export type Entry = z.infer<typeof Entry>

  const filepath = path.join(Global.Path.data, "mcp-auth.json")

  function isEnoent(error: unknown): error is { code: "ENOENT" } {
    return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }

  async function readRawFile(): Promise<Record<string, unknown>> {
    const raw = await Filesystem.readJson<unknown>(filepath).catch((error) => {
      if (isEnoent(error)) return {}
      throw error
    })
    if (!isRecord(raw)) throw new Error(`Invalid MCP auth store in ${filepath}: expected object`)
    return raw
  }

  export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    using _lock = await Lock.write(key)
    return await fn()
  }

  function decryptEntry(raw: Record<string, unknown>): Entry {
    const entry = { ...raw } as Record<string, unknown>
    if (entry.tokens && typeof entry.tokens === "object") {
      entry.tokens = decryptField(
        decryptField({ ...(entry.tokens as Record<string, unknown>) }, "accessToken"),
        "refreshToken",
      )
    }
    if (entry.clientInfo && typeof entry.clientInfo === "object") {
      entry.clientInfo = decryptField({ ...(entry.clientInfo as Record<string, unknown>) }, "clientSecret")
    }
    return decryptField(entry, "codeVerifier") as unknown as Entry
  }

  function parseStoredEntry(value: unknown): Entry | undefined {
    if (!isRecord(value)) return undefined
    const parsed = Entry.safeParse(decryptEntry(value))
    return parsed.success ? parsed.data : undefined
  }

  function encryptEntry(entry: Entry): Record<string, unknown> {
    const out = { ...entry } as Record<string, unknown>
    if (entry.tokens) {
      out.tokens = encryptField(
        encryptField({ ...entry.tokens } as Record<string, unknown>, "accessToken"),
        "refreshToken",
      )
    }
    if (entry.clientInfo) {
      out.clientInfo = encryptField({ ...entry.clientInfo } as Record<string, unknown>, "clientSecret")
    }
    return encryptField(out, "codeVerifier")
  }

  export async function get(mcpName: string): Promise<Entry | undefined> {
    const data = await all()
    return data[mcpName]
  }

  /**
   * Get auth entry and validate it's for the correct URL.
   * Returns undefined if URL has changed (credentials are invalid).
   */
  export async function getForUrl(mcpName: string, serverUrl: string): Promise<Entry | undefined> {
    const entry = await get(mcpName)
    if (!entry) return undefined

    // If no serverUrl is stored, this is from an old version - consider it invalid
    if (!entry.serverUrl) return undefined

    // If URL has changed, credentials are invalid
    if (entry.serverUrl !== serverUrl) return undefined

    return entry
  }

  export async function all(): Promise<Record<string, Entry>> {
    const raw = await readRawFile()
    const result: Record<string, Entry> = {}
    for (const [key, val] of Object.entries(raw)) {
      const entry = parseStoredEntry(val)
      if (entry) result[key] = entry
    }
    return result
  }

  async function withFileEntryLock<T>(mcpName: string, fn: (entry: Entry) => Promise<T> | T): Promise<T> {
    return withLock(filepath, async () => {
      const raw = await readRawFile()
      const entry = parseStoredEntry(raw[mcpName]) ?? {}
      const result = await fn(entry)
      raw[mcpName] = encryptEntry(entry)
      await Filesystem.writeJson(filepath, raw, 0o600)
      return result
    })
  }

  // All set/remove/update operations serialize on the same shared lock
  // key (`filepath`) so concurrent OAuth completions for different MCP
  // servers cannot race on the read-modify-write of mcp-auth.json.
  // Previously only updateXxx() used the lock; set()/remove() read and
  // wrote the file independently, so two parallel set() calls could
  // drop an entry by last-write-wins.
  export async function set(mcpName: string, entry: Entry, serverUrl?: string): Promise<void> {
    return withLock(filepath, async () => {
      const raw = await readRawFile()
      if (serverUrl) {
        entry.serverUrl = serverUrl
      }
      raw[mcpName] = encryptEntry(entry)
      await Filesystem.writeJson(filepath, raw, 0o600)
    })
  }

  export async function remove(mcpName: string): Promise<void> {
    return withLock(filepath, async () => {
      const raw = await readRawFile()
      delete raw[mcpName]
      await Filesystem.writeJson(filepath, raw, 0o600)
    })
  }

  export async function updateTokens(mcpName: string, tokens: Tokens, serverUrl?: string): Promise<void> {
    await withFileEntryLock(mcpName, (entry) => {
      entry.tokens = tokens
      if (serverUrl) {
        entry.serverUrl = serverUrl
      }
    })
  }

  export async function updateClientInfo(mcpName: string, clientInfo: ClientInfo, serverUrl?: string): Promise<void> {
    await withFileEntryLock(mcpName, (entry) => {
      entry.clientInfo = clientInfo
      if (serverUrl) {
        entry.serverUrl = serverUrl
      }
    })
  }

  export async function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void> {
    await withFileEntryLock(mcpName, (entry) => {
      entry.codeVerifier = codeVerifier
    })
  }

  export async function clearCodeVerifier(mcpName: string): Promise<void> {
    await withFileEntryLock(mcpName, (entry) => {
      if (!entry.codeVerifier) return
      delete entry.codeVerifier
    })
  }

  export async function updateOAuthState(mcpName: string, oauthState: string): Promise<void> {
    await withFileEntryLock(mcpName, (entry) => {
      entry.oauthState = oauthState
    })
  }

  export async function getOAuthState(mcpName: string): Promise<string | undefined> {
    const entry = await get(mcpName)
    return entry?.oauthState
  }

  export async function clearOAuthState(mcpName: string): Promise<void> {
    await withFileEntryLock(mcpName, (entry) => {
      if (!entry.oauthState) return
      delete entry.oauthState
    })
  }

  export async function clearOAuthStateIfMatches(mcpName: string, oauthState: string): Promise<boolean> {
    let cleared = false
    await withFileEntryLock(mcpName, (entry) => {
      if (entry.oauthState !== oauthState) return
      delete entry.oauthState
      cleared = true
    })
    return cleared
  }

  // Atomic field clears used by `oauth-provider.invalidateCredentials`.
  // They exist as their own helpers so callers don't have to do a manual
  // `get → mutate → set` sequence under a separate lock —
  // `withFileEntryLock` serializes on `filepath`, the same key that
  // `set()` and `remove()` use, so concurrent writes to mcp-auth.json
  // never lose updates. The previous `invalidateCredentials`
  // implementation acquired a lock on `mcpName`, then called `set()`
  // which acquires a lock on `filepath`. Those are different lock
  // instances, so a parallel `updateTokens()` for the same server could
  // resurrect a token we just tried to drop.
  export async function clearClientInfo(mcpName: string): Promise<void> {
    await withFileEntryLock(mcpName, (entry) => {
      if (!entry.clientInfo) return
      delete entry.clientInfo
    })
  }

  export async function clearTokens(mcpName: string): Promise<void> {
    await withFileEntryLock(mcpName, (entry) => {
      if (!entry.tokens) return
      delete entry.tokens
    })
  }

  /**
   * Check if stored tokens are expired.
   * Returns null if no tokens exist, false if no expiry or not expired, true if expired.
   */
  export async function isTokenExpired(mcpName: string): Promise<boolean | null> {
    const entry = await get(mcpName)
    if (!entry?.tokens) return null
    if (!entry.tokens.expiresAt) return false
    return entry.tokens.expiresAt < Date.now() / 1000
  }
}
