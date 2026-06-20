import { describe, expect, test } from "vitest"
import { Command } from "../../src/command"

describe("Command.hints", () => {
  test("orders numbered placeholders numerically", () => {
    expect(Command.hints("run $1 then $10 then $2 then $2")).toEqual(["$1", "$2", "$10"])
  })

  test("keeps the catch-all arguments hint after numbered placeholders", () => {
    expect(Command.hints("$ARGUMENTS with $10 and $2")).toEqual(["$2", "$10", "$ARGUMENTS"])
  })

  test("does not expose partial numbered placeholder prefixes", () => {
    expect(Command.hints("keep $1abc and $1_name but replace $1")).toEqual(["$1"])
  })

  test("labels and truncates MCP prompt templates as untrusted content", async () => {
    const text = await Command.mcpPromptTemplateText({
      client: "docs",
      name: "summarize",
      messages: [{ content: { type: "text", text: "Use this external context." } }],
    })

    expect(text).toContain("[Untrusted MCP prompt content from docs/summarize]")
    expect(text).toContain("Use this external context.")
  })
})
