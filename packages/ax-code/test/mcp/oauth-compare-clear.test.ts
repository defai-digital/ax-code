import { afterEach, beforeEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import type { OAuthTokens } from "@modelcontextprotocol/client"
import { Global } from "../../src/global"
import { McpAuth } from "../../src/mcp/auth"
import { McpOAuthProvider } from "../../src/mcp/oauth-provider"

const authFile = path.join(Global.Path.data, "mcp-auth.json")

async function resetAuthFile() {
  await fs.rm(authFile, { force: true }).catch(() => undefined)
}

beforeEach(resetAuthFile)
afterEach(resetAuthFile)

const SERVER_URL = "https://mcp.example.com"

// Two provider instances sharing one auth file stand in for the TUI and a
// headless `run` process racing on the same MCP server credentials.
function provider(mcpName = "server") {
  return new McpOAuthProvider(
    mcpName,
    SERVER_URL,
    {},
    {
      onRedirect: async () => {},
    },
  )
}

async function seedTokens(accessToken: string, refreshToken?: string) {
  await McpAuth.set("server", { tokens: { accessToken, refreshToken } }, SERVER_URL)
}

function sdkTokens(accessToken: string, refreshToken?: string): OAuthTokens {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    refresh_token: refreshToken,
  }
}

describe("McpOAuthProvider invalidateCredentials compare-and-clear (ADR-221)", () => {
  test("clears the stored tokens when they are unchanged since the failed request", async () => {
    await seedTokens("access-1", "refresh-1")
    const failed = provider()

    const issued = await failed.tokens()
    expect(issued?.access_token).toBe("access-1")

    await failed.invalidateCredentials("tokens")

    const entry = await McpAuth.get("server")
    expect(entry?.tokens).toBeUndefined()
  })

  test("a peer re-login survives a stale invalidation", async () => {
    await seedTokens("access-1", "refresh-1")
    const stale = provider()
    await stale.tokens()

    // Between the stale instance's failed request and its invalidation, a
    // peer process completes a fresh login and stores new tokens.
    const peer = provider()
    await peer.saveTokens(sdkTokens("access-2", "refresh-2"))

    await stale.invalidateCredentials("tokens")

    const entry = await McpAuth.get("server")
    expect(entry?.tokens).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" })
  })

  test("a rotated refresh token alone also counts as changed and blocks the clear", async () => {
    await seedTokens("access-1", "refresh-1")
    const stale = provider()
    await stale.tokens()

    // Peer refresh kept the access token but rotated the refresh token.
    const peer = provider()
    await peer.saveTokens(sdkTokens("access-1", "refresh-2"))

    await stale.invalidateCredentials("tokens")

    const entry = await McpAuth.get("server")
    expect(entry?.tokens).toMatchObject({ accessToken: "access-1", refreshToken: "refresh-2" })
  })

  test("an instance that never issued tokens still clears unconditionally", async () => {
    await seedTokens("access-1")
    const fresh = provider()

    await fresh.invalidateCredentials("tokens")

    const entry = await McpAuth.get("server")
    expect(entry?.tokens).toBeUndefined()
  })

  test("an instance that itself saved tokens compares against the saved pair", async () => {
    await seedTokens("access-1", "refresh-1")
    const self = provider()
    await self.tokens()
    // The SDK refreshed through this same instance; the fingerprint must
    // follow the saved credential so a later rejection still clears.
    await self.saveTokens(sdkTokens("access-2", "refresh-2"))

    await self.invalidateCredentials("tokens")

    const entry = await McpAuth.get("server")
    expect(entry?.tokens).toBeUndefined()
  })
})

describe("McpAuth.refreshTokens serialization (ADR-221)", () => {
  test("concurrent refreshes serialize; the second sees the first's result", async () => {
    await seedTokens("access-1", "refresh-1")

    const seen: string[] = []
    let releaseFirst!: () => void
    let firstStarted!: () => void
    const started = new Promise<void>((resolve) => (firstStarted = resolve))

    const first = McpAuth.refreshTokens("server", async (tokens) => {
      seen.push(`first:${tokens.accessToken}`)
      firstStarted()
      await new Promise<void>((resolve) => (releaseFirst = resolve))
      return { accessToken: "access-2", refreshToken: "refresh-2" }
    })

    const second = McpAuth.refreshTokens("server", async (tokens) => {
      seen.push(`second:${tokens.accessToken}`)
      return { accessToken: "access-3", refreshToken: "refresh-3" }
    })

    await started
    expect(seen).toEqual(["first:access-1"])
    releaseFirst()
    await Promise.all([first, second])

    // The second refresh read the store AFTER the first one stored its
    // result, so it refreshes the fresh credential instead of the stale one.
    expect(seen).toEqual(["first:access-1", "second:access-2"])
    const entry = await McpAuth.get("server")
    expect(entry?.tokens).toMatchObject({ accessToken: "access-3", refreshToken: "refresh-3" })
  })

  test("returns undefined without running the refresh when no tokens are stored", async () => {
    let ran = false
    const result = await McpAuth.refreshTokens("server", async (tokens) => {
      ran = true
      return tokens
    })
    expect(result).toBeUndefined()
    expect(ran).toBe(false)
  })
})

describe("McpAuth.clearTokensIfMatches (ADR-221)", () => {
  test("no clear when the stored access token differs", async () => {
    await seedTokens("access-2", "refresh-1")
    const cleared = await McpAuth.clearTokensIfMatches("server", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
    })
    expect(cleared).toBe(false)
    expect((await McpAuth.get("server"))?.tokens).toBeDefined()
  })

  test("no clear when only the refresh token matches", async () => {
    await seedTokens("access-1", "refresh-2")
    const cleared = await McpAuth.clearTokensIfMatches("server", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
    })
    expect(cleared).toBe(false)
    expect((await McpAuth.get("server"))?.tokens).toBeDefined()
  })

  test("undefined and absent refresh tokens compare equal", async () => {
    await seedTokens("access-1")
    const cleared = await McpAuth.clearTokensIfMatches("server", { accessToken: "access-1" })
    expect(cleared).toBe(true)
    expect((await McpAuth.get("server"))?.tokens).toBeUndefined()
  })

  test("no clear when nothing is stored", async () => {
    await McpAuth.set("server", {}, SERVER_URL)
    const cleared = await McpAuth.clearTokensIfMatches("server", { accessToken: "access-1" })
    expect(cleared).toBe(false)
  })
})
