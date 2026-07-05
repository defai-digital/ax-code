import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { normalizeSafeExternalUrl } = require("./external-url.js")

describe("normalizeSafeExternalUrl", () => {
  test("allows browser and OS-safe external protocols", () => {
    expect(normalizeSafeExternalUrl(" https://example.com/docs ")).toBe("https://example.com/docs")
    expect(normalizeSafeExternalUrl("mailto:support@example.com")).toBe("mailto:support@example.com")
    expect(normalizeSafeExternalUrl("tel:+15551234567")).toBe("tel:+15551234567")
  })

  test("rejects unsafe or malformed external URLs", () => {
    expect(normalizeSafeExternalUrl("file:///Users/test/secret.txt")).toBeNull()
    expect(normalizeSafeExternalUrl("javascript:alert(1)")).toBeNull()
    expect(normalizeSafeExternalUrl("https://user:pass@example.com/docs")).toBeNull()
    expect(normalizeSafeExternalUrl("https://example.com\n.evil.test/docs")).toBeNull()
    expect(normalizeSafeExternalUrl("https://example.com\t.evil.test/docs")).toBeNull()
    expect(normalizeSafeExternalUrl("not a url")).toBeNull()
    expect(normalizeSafeExternalUrl("")).toBeNull()
  })
})
