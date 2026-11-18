import { expect, test, vi } from "vitest"
import { Configuration, Requirement } from "../../src/mcp/webmcp-config"
import * as Launch from "../../src/mcp/webmcp-launch"
import { Info, McpLocal } from "../../src/config/schema"

vi.mock("../../src/mcp/webmcp-profile", () => {
  throw new Error("WebMCP launch and config schemas must not load live page policy")
})

test("configuration schemas retain origin bounds and public metadata without live page policy", () => {
  expect(Configuration.parse({ allowedOrigins: [] })).toEqual({ allowedOrigins: [] })
  expect(Configuration.meta()?.ref).toBe("WebMcpProfileConfig")
  expect(Requirement.meta()?.ref).toBe("WebMcpRequirementConfig")
  expect(Requirement.safeParse({ allowedOrigins: [] }).success).toBe(false)
  expect(Configuration.safeParse({ allowedOrigins: ["https://example.test", "https://example.test"] }).success).toBe(
    false,
  )
  expect(Configuration.safeParse({ allowedOrigins: ["https://example.test/path"] }).success).toBe(false)
  expect(Configuration.safeParse({ allowedOrigins: [], executablePath: "relative/chrome" }).success).toBe(false)
  expect(Info.safeParse({ webmcp: { allow: false } }).success).toBe(true)
  expect(McpLocal.safeParse({ type: "local", command: ["ignored"], webmcp: { allowedOrigins: [] } }).success).toBe(true)
})

test("launch validation freezes a profile and regenerates reviewed argv without live page policy", () => {
  const server = Launch.config({ allowedOrigins: ["https://example.test"], headless: true })
  server.command = ["untrusted", "--arbitrary-flag"]
  const profile = Launch.validateLaunch(server)
  expect(profile).toBeDefined()
  if (!profile) throw new Error("Expected a WebMCP profile")
  expect(Object.isFrozen(profile)).toBe(true)
  expect(Object.isFrozen(profile.allowedOrigins)).toBe(true)
  expect(Launch.command(profile)).toContain(Launch.PACKAGE)
  expect(Launch.command(profile)).not.toContain("--arbitrary-flag")
  expect(Launch.trustGateReason(server)).toBeUndefined()
  expect(Launch.trustGateReason(Launch.config({ allowedOrigins: [], executablePath: "/custom/chrome" }))).toContain(
    "executablePath",
  )
})
