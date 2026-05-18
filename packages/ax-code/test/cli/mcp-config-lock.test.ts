import { expect, test } from "bun:test"
import path from "path"

test("MCP config write queue recovers from prior rejected locks", async () => {
  const src = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/mcp.ts")).text()
  const start = src.indexOf("async function addMcpToConfig")
  const end = src.indexOf("export const McpAddCommand", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const block = src.slice(start, end)

  expect(block).toContain('log.warn("previous MCP config write failed before queued write"')
  expect(block).toContain("if (configLocks.get(configPath) === next) configLocks.delete(configPath)")
})
