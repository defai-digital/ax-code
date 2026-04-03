import path from "path"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { encrypt, decrypt, isEncrypted } from "../auth/encryption"

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

  function decryptField(val: unknown): string | unknown {
    if (isEncrypted(val)) {
      try {
        return decrypt(val)
      } catch {
        return val // preserve original encrypted value if decryption fails
      }
    }
    return val as string
  }

  function decryptEntry(raw: Record<string, unknown>): Entry {
    const entry = { ...raw } as Record<string, unknown>
    if (entry.tokens && typeof entry.tokens === "object") {
      const tok = { ...(entry.tokens as Record<string, unknown>) }
      if (tok.accessToken) tok.accessToken = decryptField(tok.accessToken)
      if (tok.refreshToken) tok.refreshToken = decryptField(tok.refreshToken)
      entry.tokens = tok
    }
    if (entry.clientInfo && typeof entry.clientInfo === "object") {
      const ci = { ...(entry.clientInfo as Record<string, unknown>) }
      if (ci.clientSecret) ci.clientSecret = decryptField(ci.clientSecret)
      entry.clientInfo = ci
    }
    if (entry.codeVerifier) entry.codeVerifier = decryptField(entry.codeVerifier)
    return entry as unknown as Entry
  }

  function encryptEntry(entry: Entry): Record<string, unknown> {
    const out = { ...entry } as Record<string, unknown>
    if (entry.tokens) {
      const tok = { ...entry.tokens } as Record<string, unknown>
      // Skip fields that are already encrypted (failed to decrypt on read)
      if (typeof tok.accessToken === "string" && tok.accessToken) tok.accessToken = encrypt(tok.accessToken)
      if (typeof tok.refreshToken === "string" && tok.refreshToken) tok.refreshToken = encrypt(tok.refreshToken)
      out.tokens = tok
    }
    if (entry.clientInfo) {
      const ci = { ...entry.clientInfo } as Record<string, unknown>
      if (typeof ci.clientSecret === "string" && ci.clientSecret) ci.clientSecret = encrypt(ci.clientSecret)
      out.clientInfo = ci
    }
    if (typeof entry.codeVerifier === "string" && entry.codeVerifier) out.codeVerifier = encrypt(entry.codeVerifier)
    return out
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

  export async function set(mcpName: string, entry: Entry, serverUrl?: string): Promise<void> {
    const raw: Record<string, unknown> = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(() => ({}))
    if (serverUrl) {
      entry.serverUrl = serverUrl
    }
    raw[mcpName] = encryptEntry(entry)
    await Filesystem.writeJson(filepath, raw, 0o600)
  }

  export async function remove(mcpName: string): Promise<void> {
    const raw: Record<string, unknown> = await Filesystem.readJson<Record<string, unknown>>(filepath).catch(() => ({}))
    delete raw[mcpName]
    await Filesystem.writeJson(filepath, raw, 0o600)
  }

  export async function updateTokens(mcpName: string, tokens: Tokens, serverUrl?: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.tokens = tokens
    await set(mcpName, entry, serverUrl)
  }

  export async function updateClientInfo(mcpName: string, clientInfo: ClientInfo, serverUrl?: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.clientInfo = clientInfo
    await set(mcpName, entry, serverUrl)
  }

  export async function updateCodeVerifier(mcpName: string, codeVerifier: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.codeVerifier = codeVerifier
    await set(mcpName, entry)
  }

  export async function clearCodeVerifier(mcpName: string): Promise<void> {
    const entry = await get(mcpName)
    if (entry) {
      delete entry.codeVerifier
      await set(mcpName, entry)
    }
  }

  export async function updateOAuthState(mcpName: string, oauthState: string): Promise<void> {
    const entry = (await get(mcpName)) ?? {}
    entry.oauthState = oauthState
    await set(mcpName, entry)
  }

  export async function getOAuthState(mcpName: string): Promise<string | undefined> {
    const entry = await get(mcpName)
    return entry?.oauthState
  }

  export async function clearOAuthState(mcpName: string): Promise<void> {
    const entry = await get(mcpName)
    if (entry) {
      delete entry.oauthState
      await set(mcpName, entry)
    }
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
