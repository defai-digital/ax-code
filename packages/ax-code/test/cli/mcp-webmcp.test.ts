import { expect, test, vi } from "vitest"
import yargs from "yargs"
import { McpWebMcpCommand } from "../../src/cli/cmd/mcp-webmcp"
import { McpCommand } from "../../src/cli/cmd/mcp"
import { Config } from "../../src/config/config"
import { parseJsonPayload } from "../../src/util/json-value"
import path from "node:path"

test("WebMCP CLI prints disabled config without connecting or writing user configuration", async () => {
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true)
  try {
    await yargs()
      .exitProcess(false)
      .command(McpCommand)
      .parseAsync(["mcp", "webmcp", "--origin", "https://example.test", "--name", "trial"])
    const parsed = Config.Info.parse(parseJsonPayload(output.mock.calls.map(([text]) => text).join("")))
    expect(parsed.mcp?.trial).toMatchObject({
      type: "local",
      enabled: false,
      webmcp: { allowedOrigins: ["https://example.test"] },
    })
  } finally {
    output.mockRestore()
  }
})

test("WebMCP CLI preserves explicit browser selection and enablement", async () => {
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true)
  try {
    const executablePath = path.resolve("chrome-for-testing")
    await yargs()
      .exitProcess(false)
      .command(McpWebMcpCommand)
      .parseAsync([
        "webmcp",
        "--origin",
        "https://example.test",
        "--enable",
        "--headless",
        "--executable-path",
        executablePath,
      ])
    const parsed = Config.Info.parse(parseJsonPayload(output.mock.calls.map(([text]) => text).join("")))
    expect(parsed.mcp?.webmcp).toMatchObject({ enabled: true, webmcp: { headless: true, executablePath } })
  } finally {
    output.mockRestore()
  }
})
