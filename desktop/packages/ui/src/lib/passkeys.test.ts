import { afterEach, describe, expect, test, vi } from "vitest"

import { fetchPasskeyStatus } from "./passkeys"

describe("passkey API routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("uses the Desktop UI-auth passkey status route", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ enabled: true, hasPasskeys: true, passkeyCount: 1 })))
    vi.stubGlobal("fetch", fetch)

    await expect(fetchPasskeyStatus()).resolves.toMatchObject({ enabled: true, hasPasskeys: true, passkeyCount: 1 })
    expect(fetch).toHaveBeenCalledWith(
      "/auth/passkey/status",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    )
  })
})
