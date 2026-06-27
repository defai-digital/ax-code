import { describe, expect, test } from "vitest"
import { rankSlashAutocompleteOptions } from "../../../src/cli/cmd/tui/component/prompt/autocomplete"
import { commandAutocompleteSuffix } from "../../../src/cli/cmd/tui/component/prompt/autocomplete-command"

describe("tui command autocomplete", () => {
  test("labels reusable command sources", () => {
    expect(commandAutocompleteSuffix({ source: "mcp" })).toBe(":mcp")
    expect(commandAutocompleteSuffix({ source: "skill" })).toBe(":skill")
    expect(commandAutocompleteSuffix({ source: "file" })).toBe(":file")
    expect(commandAutocompleteSuffix({ source: "file", workflow: "builtin:noop-dry-run" })).toBe(":workflow")
    expect(commandAutocompleteSuffix({ source: "command" })).toBe("")
  })

  test("filters slash commands by the typed query and ranks prefix matches first", () => {
    const options = [
      { display: "/agents    ", description: "Manage agents" },
      { display: "/connect   ", description: "Connect provider" },
      { display: "/mcp       ", description: "Manage MCP servers" },
      { display: "/new       ", description: "Create a new session", aliases: ["/n"] },
    ]

    expect(rankSlashAutocompleteOptions(options, "new").map((option) => option.display.trim())).toEqual(["/new"])
    expect(rankSlashAutocompleteOptions(options, "/mcp").map((option) => option.display.trim())).toEqual(["/mcp"])
    expect(rankSlashAutocompleteOptions(options, "n").map((option) => option.display.trim())[0]).toBe("/new")
    expect(rankSlashAutocompleteOptions(options, "does-not-exist")).toEqual([])
  })
})
