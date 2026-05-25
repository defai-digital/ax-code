import { describe, expect, test } from "bun:test"
import { decodeMcpDebugServerInfoValue, parseMcpDebugServerInfoText } from "../../src/cli/cmd/mcp"

describe("mcp debug response decoding", () => {
  test("decodeMcpDebugServerInfoValue extracts parsed server info", () => {
    expect(
      decodeMcpDebugServerInfoValue({
        jsonrpc: "2.0",
        result: {
          serverInfo: {
            name: "server",
            version: "1.0.0",
          },
        },
      }),
    ).toEqual({
      name: "server",
      version: "1.0.0",
    })
  })

  test("decodeMcpDebugServerInfoValue ignores non-object envelopes", () => {
    expect(decodeMcpDebugServerInfoValue(null)).toBeUndefined()
    expect(decodeMcpDebugServerInfoValue([])).toBeUndefined()
    expect(decodeMcpDebugServerInfoValue({ result: [] })).toBeUndefined()
    expect(decodeMcpDebugServerInfoValue({ result: {} })).toBeUndefined()
  })

  test("parseMcpDebugServerInfoText parses JSON before extracting server info", () => {
    expect(
      parseMcpDebugServerInfoText(
        `  ${JSON.stringify({
          result: {
            serverInfo: {
              name: "server",
            },
          },
        })}\n`,
      ),
    ).toEqual({
      name: "server",
    })
    expect(parseMcpDebugServerInfoText("{not json")).toBeUndefined()
    expect(parseMcpDebugServerInfoText("")).toBeUndefined()
  })
})
