import { describe, expect, it } from "vitest"

import { createRequestSecurityRuntime } from "./request-security.js"

const createRuntime = (settings = {}) =>
  createRequestSecurityRuntime({
    readSettingsFromDiskMigrated: async () => settings,
  })

const createRequest = ({ host, origin, protocol = "http" }) => ({
  headers: {
    host,
    origin,
    ...(protocol ? { "x-forwarded-proto": protocol } : {}),
  },
  socket: {
    encrypted: protocol === "https",
  },
})

describe("request security origin checks", () => {
  it("normalizes host casing before comparing origins", async () => {
    const runtime = createRuntime()

    await expect(
      runtime.isRequestOriginAllowed(
        createRequest({
          host: "LOCALHOST:3000",
          origin: "http://localhost:3000",
        }),
      ),
    ).resolves.toBe(true)
  })

  it("treats IPv6 loopback host headers as localhost equivalents", async () => {
    const runtime = createRuntime()

    await expect(
      runtime.isRequestOriginAllowed(
        createRequest({
          host: "[::1]:3000",
          origin: "http://localhost:3000",
        }),
      ),
    ).resolves.toBe(true)
  })

  it("keeps non-loopback origins rejected", async () => {
    const runtime = createRuntime()

    await expect(
      runtime.isRequestOriginAllowed(
        createRequest({
          host: "[::1]:3000",
          origin: "http://example.com:3000",
        }),
      ),
    ).resolves.toBe(false)
  })
})
