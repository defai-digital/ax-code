import path from "path"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { encryptField, decryptField } from "../auth/encryption"

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

  const locks = new Map<string, Promise<void>>()
  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve()
    let result: T
    const next = prev.then(async () => { result = await fn() })
    // Store a promise that always resolves so the chain continues after errors
    locks.set(key, next.then(() => {}, () => {}))
    await next
    return result!
  }

  function decryptEntry(raw: Record<string, unknown>): Entry {
    const entry = { ...raw } as Record<string, unknown>
    if (entry.tokens && typeof entry.tokens === "object") {
      entry.tokens = decryptField(decryptField({ ...(entry.tokens as Record<string, unknown>) }, "accessToken"), "refreshToken")
    }
    if (entry.clientInfo && typeof entry.clientInfo === "object") {
      entry.clientInfo = decryptField({ ...(entry.clientInfo as Record<string, unknown>) }, "clientSecret")
    }
    return decryptField(entry, "codeVerifier") as unknown as Entry
  }

  function encryptEntry(entry: Entry): Record<string, unknown> {
    const out = { ...entry } as Record<string, unknown>
    if (entry.tokens) {
      out.tokens = encryptField(encryptField({ ...entry.tokens } as Record<string, unknown>, "accessToken"), "refreshToken")
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
    const raw = await Filesystem.readJson<Record<string, Record<string, unknown>>>(filepath).catch(() => ({}))
    const result: Record<string, Entry> = {}
    for (const [key, val] of Object.entries(raw)) {
      result[key] = decryptEntry(val)
    }
    return result
  }

  // All set/remove/update operations serialize on the same shared lock
  // key (`filepath`) so concurrent OAuth completions for different MCP
  // servers cannot race on the read-modify-write of mcp-auth.json.
  // Previously only updateXxx() used the lock; set()/remove() read and
  // wrote the file independently, so two parallel set() calls could
  // drop an entry by last-write-wins.
  export async function set(mcpName: string, entry: Entry, serverUrl?: string): Promise<void> {
    return withLock(filepath, async () => {
      const raw: Record<string, unknown> = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(
        () => ({}),
      )
      if (serverUrl) {
        entry.serverUrl = serverUrl
      }
      raw[mcpName] = encryptEntry(entry)
      await Filesystem.writeJson(filepath, raw, 0o600)
    })
  }

  export async function remove(mcpName: string): Promise<void> {
    return withLock(filepath, async () => {
      const raw: Record<string, unknown> = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(
        () => ({}),
      )
      delete raw[mcpName]
      await Filesystem.writeJson(filepath, raw, 0o600)
    })
  }

  export async function updateTokens(mcpName: string, tokens: Tokens, serverUrl?: string): Promise<void> {
    await withLock(mcpName, async () => {
      const entry = (await get(mcpName)) ?? {}
      entry.tokens = tokens
      await set(mcpName, entry, serverUrl)
    })
  }

  export async function updateClientInfo(mcpName: string, clientInfo: ClientInfo, serverUrl?: string): Promise<void> {
    await withLock(mcpName, async () => {
      const entry = (await get(mcpName)) ?? {}
      entry.clientInfo = clientInfo
      await set(mcpName, entry, serverUrl)
    })
  }

  export async function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void> {
    await withLock(mcpName, async () => {
      const entry = (await get(mcpName)) ?? {}
      entry.codeVerifier = codeVerifier
      await set(mcpName, entry)
    })
  }

  export async function clearCodeVerifier(mcpName: string): Promise<void> {
    await withLock(mcpName, async () => {
      const entry = await get(mcpName)
      if (entry) {
        delete entry.codeVerifier
        await set(mcpName, entry)
      }
    })
  }

  export async function updateOAuthState(mcpName: string, oauthState: string): Promise<void> {
    await withLock(mcpName, async () => {
      const entry = (await get(mcpName)) ?? {}
      entry.oauthState = oauthState
      await set(mcpName, entry)
    })
  }

  export async function getOAuthState(mcpName: string): Promise<string | undefined> {
    const entry = await get(mcpName)
    return entry?.oauthState
  }

  export async function clearOAuthState(mcpName: string): Promise<void> {
    await withLock(mcpName, async () => {
      const entry = await get(mcpName)
      if (entry) {
        delete entry.oauthState
        await set(mcpName, entry)
      }
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
