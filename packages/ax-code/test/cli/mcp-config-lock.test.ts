import { expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"

test("MCP config writes use process and cross-process locks", async () => {
  const src = await readFile(path.join(import.meta.dirname, "../../src/cli/cmd/mcp-impl.ts"), "utf-8")
  const start = src.indexOf("async function addMcpToConfig")
  const end = src.indexOf("export const McpAddCommand", start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const block = src.slice(start, end)

  const processLock = block.indexOf("using _process = await Lock.write(configPath)")
  const fileLock = block.indexOf("using _crossProcess = await FileLock.acquire(configPath)")
  expect(processLock).toBeGreaterThan(-1)
  expect(fileLock).toBeGreaterThan(processLock)
})
