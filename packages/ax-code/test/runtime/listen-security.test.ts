import { describe, expect, test } from "bun:test"

import { isLoopbackHostname } from "../../src/runtime/listen-security"

describe("isLoopbackHostname", () => {
  test("accepts loopback hostnames and literals", () => {
    for (const hostname of ["localhost", "127.0.0.1", "127.12.0.1", "::1", "[::1]"]) {
      expect(isLoopbackHostname(hostname)).toBe(true)
    }
  })

  test("rejects network and loopback-looking hostnames", () => {
    for (const hostname of ["0.0.0.0", "127.0.0.1.evil.com", "localhost.evil.com"]) {
      expect(isLoopbackHostname(hostname)).toBe(false)
    }
  })
})
