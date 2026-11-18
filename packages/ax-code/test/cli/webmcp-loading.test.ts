import { afterEach, expect, test, vi } from "vitest"
import { McpWebMcpCommand } from "../../src/cli/cmd/mcp/webmcp"
import { parseJsonStrict } from "../../src/util/json-value"

vi.mock("../../src/mcp/webmcp-profile", () => {
  throw new Error("Printing WebMCP config must not load live page policy")
})

afterEach(() => vi.restoreAllMocks())

test("printing WebMCP config loads only its launch contract", async () => {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
  const handler = McpWebMcpCommand.handler as (args: Record<string, unknown>) => Promise<void>
  await handler({ name: "webmcp", origin: ["https://example.test"], enable: false, headless: true, read: true })
  const output = write.mock.calls.map(([chunk]) => String(chunk)).join("")
  expect(parseJsonStrict(output)).toMatchObject({
    mcp: {
      webmcp: {
        type: "local",
        enabled: false,
        command: expect.arrayContaining(["chrome-devtools-mcp@1.10.1", "--isolated", "--headless"]),
        webmcp: { allowedOrigins: ["https://example.test"], read: true },
      },
    },
  })
})
