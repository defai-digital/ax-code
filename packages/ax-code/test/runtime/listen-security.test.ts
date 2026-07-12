import { describe, expect, test } from "vitest"

import {
  assertAuthenticatedNetworkBind,
  assertLoopbackHttpUrl,
  formatHostnameForUrl,
  isLoopbackHostname,
  normalizeLoopbackHostname,
  normalizeLoopbackHttpOrigin,
} from "../../src/runtime/listen-security"

describe("isLoopbackHostname", () => {
  test("accepts loopback hostnames and literals", () => {
    for (const hostname of ["localhost", "LOCALHOST", "127.0.0.1", "127.12.0.1", "::1", "[::1]"]) {
      expect(isLoopbackHostname(hostname)).toBe(true)
    }
  })

  test("rejects network and loopback-looking hostnames", () => {
    for (const hostname of ["0.0.0.0", "127.0.0.1.evil.com", "localhost.evil.com"]) {
      expect(isLoopbackHostname(hostname)).toBe(false)
    }
  })

  test("rejects non-loopback binds even when a password is configured", () => {
    const previous = process.env.AX_CODE_SERVER_PASSWORD
    process.env.AX_CODE_SERVER_PASSWORD = "secret"
    try {
      expect(() => assertAuthenticatedNetworkBind("0.0.0.0")).toThrow("local-only")
      expect(() => assertAuthenticatedNetworkBind("127.0.0.1")).not.toThrow()
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_SERVER_PASSWORD
      else process.env.AX_CODE_SERVER_PASSWORD = previous
    }
  })

  test("accepts only loopback HTTP server URLs", () => {
    expect(assertLoopbackHttpUrl("http://127.0.0.1:4096").origin).toBe("http://127.0.0.1:4096")
    expect(assertLoopbackHttpUrl("https://[::1]:4096").hostname).toBe("[::1]")
    expect(() => assertLoopbackHttpUrl("https://remote.example:4096")).toThrow("local-only")
    expect(() => assertLoopbackHttpUrl("ssh://localhost:4096")).toThrow("local-only")
  })

  test("normalizes IPv6 bind and URL forms", () => {
    expect(normalizeLoopbackHostname(" [::1] ")).toBe("::1")
    expect(formatHostnameForUrl("::1")).toBe("[::1]")
    expect(formatHostnameForUrl("127.0.0.1")).toBe("127.0.0.1")
  })

  test("normalizes only loopback HTTP origins", () => {
    expect(normalizeLoopbackHttpOrigin("http://localhost:5173/path")).toBe("http://localhost:5173")
    expect(normalizeLoopbackHttpOrigin("https://remote.example")).toBeNull()
  })
})
