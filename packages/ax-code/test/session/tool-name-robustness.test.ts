import { describe, expect, test } from "vitest"
import { LLM } from "../../src/session/llm"
import { InvalidTool } from "../../src/tool/invalid"

describe("unavailable tool feedback", () => {
  const available = [
    "read",
    "glob",
    "grep",
    "edit",
    "write",
    "list",
    "task",
    "webfetch",
    "bash_output",
    "bash_input",
    "invalid",
  ]

  test.each(["bash", "shell", "sh"])("%s suggests current shell tools without repairing to one", (name) => {
    const tools = Object.fromEntries(available.map((key) => [key, {}]))
    expect(LLM.repairedToolName(name, tools)).toBeUndefined()
    const message = LLM.toolCallError(name, "unknown tool", available)
    expect(message).toContain("is not available in this turn")
    expect(message).toContain("closest matches first): bash_input, bash_output,")
    const names = message.split("first): ")[1].split(". Choose")[0].split(", ")
    expect(names).toHaveLength(8)
    expect(names.every((name) => available.includes(name) && name !== "invalid")).toBe(true)
  })

  test.each(["repo_browser.search", "repo_browser.grep"])(
    "%s suggests search tools without automatic execution",
    (name) => {
      expect(LLM.unavailableToolMessage(name, available)).toMatch(/first\): (grep, glob|glob, grep),/)
      expect(LLM.repairedToolName(name, { grep: {}, glob: {} })).toBeUndefined()
    },
  )

  test.each(["repo_browser.open_file", "repo_browser.read"])(
    "%s suggests read without assuming argument compatibility",
    (name) => {
      expect(LLM.unavailableToolMessage(name, available)).toContain("first): read,")
      expect(LLM.repairedToolName(name, { read: {} })).toBeUndefined()
    },
  )

  test("ranks edit distance and shared prefixes deterministically", () => {
    expect(LLM.unavailableToolMessage("raed", ["webfetch", "read", "write"])).toContain("first): read,")
    expect(LLM.unavailableToolMessage("bash_inpt", ["bash_output", "bash_input", "read"])).toContain(
      "first): bash_input,",
    )
    expect(LLM.unavailableToolMessage("unknown", [])).toContain("No tools are available in this turn")
  })

  test.each(["list_directory", "list-dir", "ls", "Read"])(
    "existing alias %s requires an own target in this turn",
    (name) => {
      expect(LLM.repairedToolName(name, {})).toBeUndefined()
      expect(LLM.repairedToolName(name, Object.create({ list: {}, read: {} }))).toBeUndefined()
      expect(LLM.repairedToolName(name, { list: {}, read: {} })).toBe(name === "Read" ? "read" : "list")
    },
  )

  test("invalid tool returns actionable feedback and keeps argument errors for available tools", async () => {
    const invalid = await InvalidTool.init()
    const error = LLM.toolCallError("bash", "old SDK error", ["bash_output"])
    const result = await invalid.execute({ tool: "bash", error }, {} as never)
    expect(result.output).toBe(`Tool call failed: ${error}`)
    expect(result.output).not.toContain("arguments provided")
    expect(LLM.toolCallError("read", "filePath is required", ["read"])).toBe("filePath is required")
  })
})
