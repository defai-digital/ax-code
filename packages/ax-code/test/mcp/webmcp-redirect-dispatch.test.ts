import { describe, expect, test, vi } from "vitest"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { convertMcpTool } from "../../src/mcp/tool-conversion"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"

const profile = () => WebMcpProfile.config({ allowedOrigins: ["https://a.test"] }, true).webmcp

function fakeClient(result: unknown) {
  return { callTool: async () => result } as unknown as Client
}

/** The pinned bridge's real wording for a navigation blocked by the allowlist. */
const blockedRedirect = {
  content: [{ type: "text", text: "Error: net::ERR_INTERNET_DISCONNECTED at https://a.test/x" }],
  structuredContent: { errorMessage: "net::ERR_INTERNET_DISCONNECTED at https://a.test/x" },
  isError: true,
}

async function dispatch(toolName: string, result: unknown, args: Record<string, unknown>, fetchImpl: unknown) {
  const tool = await convertMcpTool(
    { name: toolName, description: "", inputSchema: { type: "object", properties: {} } } as never,
    fakeClient(result),
    undefined,
    { server: "webmcp", toolName, profile: profile() },
  )
  vi.stubGlobal("fetch", fetchImpl)
  try {
    return await tool.execute!(args, { toolCallId: "t", abortSignal: undefined, messages: [] } as never)
  } finally {
    vi.unstubAllGlobals()
  }
}

const redirectTo = (location: string) =>
  (async () => ({
    status: 301,
    headers: { get: (name: string) => (name.toLowerCase() === "location" ? location : null) },
  })) as unknown

describe("WebMCP dispatch: blocked-redirect normalization (ADR-168)", () => {
  test("a blocked redirect raises OriginNotGrantedError for the redirect target", async () => {
    let caught: unknown
    try {
      await dispatch("new_page", blockedRedirect, { url: "https://a.test/x" }, redirectTo("https://b.test/"))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(WebMcpProfile.OriginNotGrantedError)
    expect((caught as WebMcpProfile.OriginNotGrantedError).origin).toBe("https://b.test")
  })

  test("no grantable redirect target keeps the original opaque error", async () => {
    const noRedirect = (async () => ({ status: 200, headers: { get: () => null } })) as unknown
    let caught: unknown
    try {
      await dispatch("new_page", blockedRedirect, { url: "https://a.test/x" }, noRedirect)
    } catch (error) {
      caught = error
    }
    expect(caught).not.toBeInstanceOf(WebMcpProfile.OriginNotGrantedError)
    expect((caught as Error).message).toContain("WebMCP bridge operation failed")
  })

  test("a non-navigation tool failure is never probed", async () => {
    const fetchSpy = vi.fn()
    let caught: unknown
    try {
      await dispatch("list_pages", blockedRedirect, {}, fetchSpy)
    } catch (error) {
      caught = error
    }
    expect(caught).not.toBeInstanceOf(WebMcpProfile.OriginNotGrantedError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("a requested origin outside the allowlist is rejected at call time, not probed", async () => {
    const fetchSpy = vi.fn()
    let caught: unknown
    try {
      // https://other.test is not in the profile: validateCall rejects it
      // before dispatch, so the redirect probe must never run.
      await dispatch("new_page", blockedRedirect, { url: "https://other.test/x" }, fetchSpy)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(WebMcpProfile.OriginNotGrantedError)
    expect((caught as WebMcpProfile.OriginNotGrantedError).origin).toBe("https://other.test")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
