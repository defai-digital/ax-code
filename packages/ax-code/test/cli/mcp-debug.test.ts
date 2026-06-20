import { describe, expect, test } from "vitest"
import {
  decodeMcpDebugServerInfoValue,
  formatMcpDebugEpochSeconds,
  parseMcpDebugServerInfoText,
  parseMcpLocalCommand,
} from "../../src/cli/cmd/mcp"

describe("mcp debug response decoding", () => {
  test("formats malformed auth expiry timestamps without throwing", () => {
    expect(formatMcpDebugEpochSeconds(Date.parse("2026-04-01T00:00:00Z") / 1000)).toBe("2026-04-01T00:00:00.000Z")
    expect(formatMcpDebugEpochSeconds(Number.NaN)).toBe("1970-01-01T00:00:00.000Z")
    expect(formatMcpDebugEpochSeconds(Number.POSITIVE_INFINITY)).toBe("1970-01-01T00:00:00.000Z")
    expect(formatMcpDebugEpochSeconds(8_640_000_000_000_001)).toBe("1970-01-01T00:00:00.000Z")
  })

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

describe("mcp local command parsing", () => {
  test("preserves quoted arguments when storing custom local commands", () => {
    expect(parseMcpLocalCommand("node server.js --root \"My Project\" --label='local mcp'")).toEqual([
      "node",
      "server.js",
      "--root",
      "My Project",
      "--label=local mcp",
    ])
  })
})
