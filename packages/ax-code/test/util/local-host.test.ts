import { describe, expect, test } from "vitest"

import { isLocalHostname } from "../../src/util/local-host"

describe("isLocalHostname", () => {
  test("accepts documented local hostnames", () => {
    for (const hostname of [
      "localhost",
      "LOCALHOST",
      "api.localhost",
      "API.LOCALHOST",
      "0.0.0.0",
      "::1",
      "[::1]",
      "127.0.0.1",
      "127.12.0.1",
      "::ffff:127.0.0.1",
      "::FFFF:127.0.0.1",
    ]) {
      expect(isLocalHostname(hostname)).toBe(true)
    }
  })

  test("accepts WHATWG-normalized hex IPv4-mapped loopback", () => {
    // Callers pass URL.hostname, which normalizes "[::ffff:127.0.0.1]" to
    // "[::ffff:7f00:1]" — the dotted check never sees the 127 octets there.
    for (const hostname of [
      new URL("http://[::ffff:127.0.0.1]:8080/").hostname,
      new URL("http://[::ffff:127.1.2.3]/").hostname,
      "::ffff:7f00:1",
      "[::ffff:7f00:1]",
      "::FFFF:7F00:1",
      "::ffff:7f01:203",
      "::ffff:7fff:ffff",
    ]) {
      expect(isLocalHostname(hostname)).toBe(true)
    }
  })

  test("rejects hex IPv4-mapped addresses outside 127.0.0.0/8", () => {
    for (const hostname of [
      new URL("http://[::ffff:8.8.8.8]/").hostname,
      "[::ffff:808:808]",
      "::ffff:808:808",
      "::ffff:7f0:1",
      "::ffff:7f",
      "7f00:1",
      "::ffff:7f00:1:2",
    ]) {
      expect(isLocalHostname(hostname)).toBe(false)
    }
  })

  test("rejects loopback-looking hostnames that are not IPv4 literals", () => {
    for (const hostname of ["127.evil.com", "127..0.1", "127.0.0.", "127.0.0.256", "127.0.0.1.evil.com"]) {
      expect(isLocalHostname(hostname)).toBe(false)
    }
  })
})
