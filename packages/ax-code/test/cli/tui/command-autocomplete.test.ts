import { describe, expect, test } from "vitest"
import { commandAutocompleteSuffix } from "../../../src/cli/cmd/tui/component/prompt/autocomplete-command"

describe("tui command autocomplete", () => {
  test("labels reusable command sources", () => {
    expect(commandAutocompleteSuffix({ source: "mcp" })).toBe(":mcp")
    expect(commandAutocompleteSuffix({ source: "skill" })).toBe(":skill")
    expect(commandAutocompleteSuffix({ source: "file" })).toBe(":file")
    expect(commandAutocompleteSuffix({ source: "file", workflow: "builtin:noop-dry-run" })).toBe(":workflow")
    expect(commandAutocompleteSuffix({ source: "command" })).toBe("")
  })
})
