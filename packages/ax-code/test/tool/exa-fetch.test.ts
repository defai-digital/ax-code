import { afterEach, describe, expect, test, vi } from "vitest"
import { decodeExaMcpContentText, fetchExaTool, parseExaSseContentText } from "../../src/tool/exa-fetch"
import { Ssrf } from "../../src/util/ssrf"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("tool.exa-fetch", () => {
  test("decodeExaMcpContentText decodes already-parsed MCP content text", () => {
    expect(
      decodeExaMcpContentText({
        jsonrpc: "2.0",
        result: {
          content: [{ type: "text", text: "final answer" }],
        },
      }),
    ).toBe("final answer")
  })

  test("parseExaSseContentText decodes MCP content text", () => {
    expect(
      parseExaSseContentText(
        `data:   ${JSON.stringify({
          jsonrpc: "2.0",
          result: {
            content: [{ type: "text", text: "final answer" }],
          },
        })}\n`,
      ),
    ).toBe("final answer")
  })

  test("parseExaSseContentText rejects malformed SSE data", () => {
    expect(parseExaSseContentText("event: message")).toBeUndefined()
    expect(parseExaSseContentText("data: {not json")).toBeUndefined()
    expect(parseExaSseContentText(`data: ${JSON.stringify({ result: { content: [{ text: 123 }] } })}`)).toBeUndefined()
    expect(parseExaSseContentText(`data: ${JSON.stringify({ result: { content: [] } })}`)).toBeUndefined()
  })

  test("reports a cancelled request as cancelled, not as a timeout", async () => {
    vi.spyOn(Ssrf, "pinnedFetch").mockImplementation(async (_url, init) => {
      init?.signal?.throwIfAborted()
      throw new Error("unreachable")
    })
    const controller = new AbortController()
    controller.abort()
    const error: unknown = await fetchExaTool({
      request: {},
      timeout: 60_000,
      errorPrefix: "Search error",
      noResultsMessage: "none",
      title: "search",
      abort: controller.signal,
    }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain("timed out")
    expect((error as Error).message).toMatch(/cancel|abort/i)
  })
})
