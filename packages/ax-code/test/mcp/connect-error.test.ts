import { describe, expect, test } from "vitest"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import {
  combineTransportErrors,
  isTransientMcpConnectError,
  mcpClientUserAgent,
  mergeRemoteMcpHeaders,
} from "../../src/mcp/connect-error"

describe("mcp connect-error", () => {
  test("retries reset, refused, and 503-style failures", () => {
    expect(isTransientMcpConnectError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true)
    expect(isTransientMcpConnectError(new Error("fetch failed"))).toBe(true)
    expect(isTransientMcpConnectError(new Error("upstream 503 temporarily unavailable"))).toBe(true)
  })

  test("does not retry auth, registration, or budget timeouts", () => {
    expect(isTransientMcpConnectError(new UnauthorizedError("redirect"))).toBe(false)
    expect(isTransientMcpConnectError(new Error("HTTP 403: Invalid OAuth error response: SyntaxError"))).toBe(false)
    expect(isTransientMcpConnectError(new Error("Operation timed out after 30000ms"))).toBe(false)
    expect(isTransientMcpConnectError(new Error("Mock transport cannot connect"))).toBe(false)
    expect(isTransientMcpConnectError(new Error("HTTP 401 Unauthorized"))).toBe(false)
    expect(isTransientMcpConnectError(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }))).toBe(
      false,
    )
  })

  test("keeps the first transport error when both fail", () => {
    expect(
      combineTransportErrors([
        { name: "StreamableHTTP", error: new Error("connection refused") },
        { name: "SSE", error: new Error("not found") },
      ]),
    ).toBe("StreamableHTTP: connection refused; SSE: not found")
    expect(combineTransportErrors([{ name: "StreamableHTTP", error: new Error("only") }])).toBe("only")
  })

  test("sends ax-code User-Agent and lets a valid header override it", () => {
    expect(mcpClientUserAgent("7.7.9")).toBe("ax-code/7.7.9")
    expect(mergeRemoteMcpHeaders(undefined, "ax-code/7.7.9")).toEqual({ "User-Agent": "ax-code/7.7.9" })
    expect(
      mergeRemoteMcpHeaders({ Authorization: "Bearer x", "User-Agent": "custom-agent/1" }, "ax-code/7.7.9"),
    ).toEqual({
      Authorization: "Bearer x",
      "User-Agent": "custom-agent/1",
    })
    expect(mergeRemoteMcpHeaders({ "user-agent": "   " }, "ax-code/7.7.9")).toEqual({ "User-Agent": "ax-code/7.7.9" })
  })
})
