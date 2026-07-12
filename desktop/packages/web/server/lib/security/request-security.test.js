import { describe, expect, it } from "vitest"

import { createRequestSecurityRuntime } from "./request-security.js"
import { createMockRequest } from "../../test-helpers/route-harness.js"

const createRuntime = (settings = {}) =>
  createRequestSecurityRuntime({
    readSettingsFromDiskMigrated: async () => settings,
  })

describe("request security origin checks", () => {
  it("normalizes host casing before comparing origins", async () => {
    const runtime = createRuntime()

    await expect(
      runtime.isRequestOriginAllowed(
        createMockRequest({
          host: "LOCALHOST:3000",
          origin: "http://localhost:3000",
        }),
      ),
    ).resolves.toBe(true)
  })

  it("trims origin headers before comparing origins", async () => {
    const runtime = createRuntime()

    await expect(
      runtime.isRequestOriginAllowed(
        createMockRequest({
          host: "localhost:3000",
          origin: " http://localhost:3000 ",
        }),
      ),
    ).resolves.toBe(true)
  })

  it("treats IPv6 loopback host headers as localhost equivalents", async () => {
    const runtime = createRuntime()

    await expect(
      runtime.isRequestOriginAllowed(
        createMockRequest({
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
        createMockRequest({
          host: "[::1]:3000",
          origin: "http://example.com:3000",
        }),
      ),
    ).resolves.toBe(false)
  })

  it("rejects spoofed forwarded host and protocol headers", async () => {
    const runtime = createRuntime()

    await expect(
      runtime.isRequestOriginAllowed(
        createMockRequest({
          host: "localhost:3902",
          origin: "https://desktop.example.com",
          protocol: "http",
          forwardedHost: "desktop.example.com",
          forwardedProto: "https",
        }),
      ),
    ).resolves.toBe(false)
  })

  it("rejects a stale public origin from pre-local-only settings", async () => {
    const runtime = createRuntime({ publicOrigin: "https://desktop.example.com" })

    await expect(
      runtime.isRequestOriginAllowed(
        createMockRequest({
          host: "localhost:3902",
          origin: "https://desktop.example.com",
        }),
      ),
    ).resolves.toBe(false)
  })

  it("rejects matching non-loopback Host and Origin headers", async () => {
    const runtime = createRuntime()

    await expect(
      runtime.isRequestOriginAllowed(
        createMockRequest({
          host: "desktop.example.com",
          origin: "http://desktop.example.com",
        }),
      ),
    ).resolves.toBe(false)
  })
})
