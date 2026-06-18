import { describe, expect, test } from "bun:test"

import { isLocalHostname } from "../../src/util/local-host"

describe("isLocalHostname", () => {
  test("accepts documented local hostnames", () => {
    for (const hostname of [
      "localhost",
      "api.localhost",
      "0.0.0.0",
      "::1",
      "[::1]",
      "127.0.0.1",
      "127.12.0.1",
    ]) {
      expect(isLocalHostname(hostname)).toBe(true)
    }
  })

  test("rejects loopback-looking hostnames that are not IPv4 literals", () => {
    for (const hostname of ["127.evil.com", "127..0.1", "127.0.0.", "127.0.0.256", "127.0.0.1.evil.com"]) {
      expect(isLocalHostname(hostname)).toBe(false)
    }
  })
})
