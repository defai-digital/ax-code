import { expect, test, vi } from "vitest"
import yargs from "yargs"
import { McpWebMcpCommand } from "../../src/cli/cmd/mcp-webmcp"
import { McpCommand } from "../../src/cli/cmd/mcp"
import { Config } from "../../src/config/config"
import { parseJsonPayload } from "../../src/util/json-value"
import path from "node:path"

test("WebMCP CLI without --origin prints an unrestricted disabled config (ADR-170)", async () => {
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true)
  try {
    await yargs().exitProcess(false).command(McpCommand).parseAsync(["mcp", "webmcp"])
    const parsed = Config.Info.parse(parseJsonPayload(output.mock.calls.map(([text]) => text).join("")))
    const entry = parsed.mcp?.webmcp
    expect(entry).toMatchObject({ type: "local", enabled: false, webmcp: { allowedOrigins: [] } })
    if (entry && "type" in entry && entry.type === "local") {
      expect(entry.command.some((arg) => arg.startsWith("--allowed-url-pattern="))).toBe(false)
    }
  } finally {
    output.mockRestore()
  }
})

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

test("WebMCP CLI rejects the headless persistent-profile combination", async () => {
  await expect(
    yargs()
      .exitProcess(false)
      .command(McpWebMcpCommand)
      .parseAsync(["webmcp", "--origin", "https://example.test", "--headless", "--persistent-profile"]),
  ).rejects.toThrow("never headless")
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
