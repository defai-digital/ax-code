import { describe, expect, test } from "vitest"
import { BrowserPermission } from "../../src/visual/permission"

describe("visual.permission", () => {
  describe("validateUrl", () => {
    test("accepts http URLs", () => {
      const result = BrowserPermission.validateUrl("http://localhost:3000")
      expect(result.valid).toBe(true)
    })

    test("accepts https URLs", () => {
      const result = BrowserPermission.validateUrl("https://example.com")
      expect(result.valid).toBe(true)
    })

    test("rejects file:// URLs", () => {
      const result = BrowserPermission.validateUrl("file:///tmp/index.html")
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("file:")
    })

    test("rejects data: URLs", () => {
      const result = BrowserPermission.validateUrl("data:text/html,<h1>Hello</h1>")
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("data:")
    })

    test("rejects invalid URLs", () => {
      const result = BrowserPermission.validateUrl("not-a-url")
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("Invalid URL")
    })
  })

  describe("isLocalUrl", () => {
    test("identifies localhost", () => {
      expect(BrowserPermission.isLocalUrl("http://localhost:3000")).toBe(true)
    })

    test("identifies 127.0.0.1", () => {
      expect(BrowserPermission.isLocalUrl("http://127.0.0.1:8080")).toBe(true)
    })

    test("identifies ::1", () => {
      expect(BrowserPermission.isLocalUrl("http://[::1]:8080")).toBe(true)
    })

    test("identifies .local domains", () => {
      expect(BrowserPermission.isLocalUrl("http://myapp.local:3000")).toBe(true)
    })

    test("rejects external URLs", () => {
      expect(BrowserPermission.isLocalUrl("https://example.com")).toBe(false)
    })

    test("rejects invalid URLs", () => {
      expect(BrowserPermission.isLocalUrl("not-a-url")).toBe(false)
    })
  })

  describe("check", () => {
    test("returns undefined for unknown hosts", () => {
      const result = BrowserPermission.check("http://unknown.com", [])
      expect(result).toBeUndefined()
    })

    test("returns false for denied hosts", () => {
      const store = [{ host: "blocked.com", mode: "deny" as const, grantedAt: "" }]
      const result = BrowserPermission.check("http://blocked.com/page", store)
      expect(result).toBe(false)
    })

    test("returns true for allowed hosts", () => {
      const store = [{ host: "localhost", mode: "always-allow" as const, grantedAt: "" }]
      const result = BrowserPermission.check("http://localhost:3000", store)
      expect(result).toBe(true)
    })

    test("matches wildcard host", () => {
      const store = [{ host: "*", mode: "always-allow" as const, grantedAt: "" }]
      const result = BrowserPermission.check("http://any-host.com", store)
      expect(result).toBe(true)
    })
  })

  describe("permissionPatterns", () => {
    test("scopes durable permission to the URL origin", () => {
      expect(BrowserPermission.permissionPatterns("https://example.com:8443/path?q=1")).toEqual([
        "https://example.com:8443",
        "https://example.com:8443/*",
      ])
    })
  })
})
