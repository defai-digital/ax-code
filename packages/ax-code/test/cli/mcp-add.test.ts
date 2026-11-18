import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import * as prompts from "@clack/prompts"
import { McpAddCommand } from "../../src/cli/cmd/mcp/command"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

vi.mock("@clack/prompts", async (original) => ({
  ...(await original<typeof import("@clack/prompts")>()),
  select: vi.fn(),
  text: vi.fn(),
}))

afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await Instance.disposeAll()
})

test("MCP add refuses malformed JSONC without rewriting the existing document", async () => {
  await using project = await tmpdir({ git: true })
  const file = path.join(project.path, "ax-code.jsonc")
  const original = '{ "mcp": {}, "broken": }\n'
  await fs.writeFile(file, original)
  vi.spyOn(process, "cwd").mockReturnValue(project.path)
  vi.spyOn(process.stdout, "write").mockReturnValue(true)
  vi.mocked(prompts.select).mockResolvedValueOnce(file).mockResolvedValueOnce("custom-local")
  vi.mocked(prompts.text).mockResolvedValueOnce("added").mockResolvedValueOnce("node fixture.js")
  await expect(McpAddCommand.handler!({} as never)).rejects.toThrow()
  expect(await fs.readFile(file, "utf8")).toBe(original)
})
