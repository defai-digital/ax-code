import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { isTrustedRendererNavigationUrl, normalizeDevRendererUrl } = require("./renderer-navigation-policy.js")

describe("renderer navigation policy", () => {
  test("normalizes loopback dev renderer URLs", () => {
    expect(normalizeDevRendererUrl(" http://localhost:5180/ ")).toBe("http://localhost:5180")
    expect(normalizeDevRendererUrl("http://127.0.0.2:5180/")).toBe("http://127.0.0.2:5180")
    expect(normalizeDevRendererUrl("http://[::1]:5180/")).toBe("http://[::1]:5180")
  })

  test("rejects non-loopback dev renderer URLs", () => {
    expect(normalizeDevRendererUrl("https://localhost:5180/")).toBeNull()
    expect(normalizeDevRendererUrl("http://192.168.1.20:5180/")).toBeNull()
    expect(normalizeDevRendererUrl("not a url")).toBeNull()
    expect(normalizeDevRendererUrl("")).toBeNull()
  })

  test("trusts all loopback server URLs on the active desktop server port", () => {
    expect(isTrustedRendererNavigationUrl("http://localhost:3910/projects", { serverPort: 3910 })).toBe(true)
    expect(isTrustedRendererNavigationUrl("http://127.0.0.2:3910/projects", { serverPort: 3910 })).toBe(true)
    expect(isTrustedRendererNavigationUrl("http://[::1]:3910/projects", { serverPort: 3910 })).toBe(true)
  })

  test("rejects remote, spoofed, and wrong-port server URLs", () => {
    expect(isTrustedRendererNavigationUrl("http://localhost:39109/projects", { serverPort: 3910 })).toBe(false)
    expect(isTrustedRendererNavigationUrl("http://localhost:3910@evil.example/projects", { serverPort: 3910 })).toBe(
      false,
    )
    expect(isTrustedRendererNavigationUrl("http://192.168.1.20:3910/projects", { serverPort: 3910 })).toBe(false)
    expect(isTrustedRendererNavigationUrl("https://localhost:3910/projects", { serverPort: 3910 })).toBe(false)
  })

  test("trusts the normalized dev renderer origin", () => {
    expect(
      isTrustedRendererNavigationUrl("http://127.0.0.2:5180/src/App.tsx", {
        serverPort: 3910,
        devRendererUrl: "http://127.0.0.2:5180/",
      }),
    ).toBe(true)
    expect(
      isTrustedRendererNavigationUrl("http://127.0.0.3:5180/src/App.tsx", {
        serverPort: 3910,
        devRendererUrl: "http://127.0.0.2:5180/",
      }),
    ).toBe(false)
  })
})
