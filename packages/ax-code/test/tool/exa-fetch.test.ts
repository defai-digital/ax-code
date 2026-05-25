import { describe, expect, test } from "bun:test"
import { decodeExaMcpContentText, parseExaSseContentText } from "../../src/tool/exa-fetch"

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
        `data: ${JSON.stringify({
          jsonrpc: "2.0",
          result: {
            content: [{ type: "text", text: "final answer" }],
          },
        })}`,
      ),
    ).toBe("final answer")
  })

  test("parseExaSseContentText rejects malformed SSE data", () => {
    expect(parseExaSseContentText("event: message")).toBeUndefined()
    expect(parseExaSseContentText("data: {not json")).toBeUndefined()
    expect(parseExaSseContentText(`data: ${JSON.stringify({ result: { content: [{ text: 123 }] } })}`)).toBeUndefined()
    expect(parseExaSseContentText(`data: ${JSON.stringify({ result: { content: [] } })}`)).toBeUndefined()
  })
})
