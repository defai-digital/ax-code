import { describe, expect, test } from "vitest"
import {
  rankSlashAutocompleteOptions,
  shouldClearPromptForAutocompleteSelection,
  shouldHideAutocompleteOnInput,
} from "../../../src/cli/cmd/tui/component/prompt/autocomplete"
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
      { display: "/agent     ", description: "Manage agents", aliases: ["/agents"] },
      { display: "/connect   ", description: "Connect provider" },
      { display: "/mcp       ", description: "Manage MCP servers" },
      { display: "/new       ", description: "Create a new session", aliases: ["/n"] },
    ]

    expect(rankSlashAutocompleteOptions(options, "new").map((option) => option.display.trim())).toEqual(["/new"])
    expect(rankSlashAutocompleteOptions(options, "/mcp").map((option) => option.display.trim())).toEqual(["/mcp"])
    expect(rankSlashAutocompleteOptions(options, "n").map((option) => option.display.trim())[0]).toBe("/new")
    expect(rankSlashAutocompleteOptions(options, "does-not-exist")).toEqual([])
  })

  test("matches slash command aliases without changing the visible command name", () => {
    const options = [
      { display: "/model     ", value: "/model", description: "Switch model", aliases: ["/models"] },
      { display: "/agent     ", value: "/agent", description: "Switch agent", aliases: ["/agents"] },
    ]

    expect(rankSlashAutocompleteOptions(options, "models").map((option) => option.display.trim())).toEqual(["/model"])
    expect(rankSlashAutocompleteOptions(options, "/agents").map((option) => option.display.trim())).toEqual(["/agent"])
  })

  test("keeps slash autocomplete open while the trigger cursor settles", () => {
    expect(
      shouldHideAutocompleteOnInput({
        mode: "/",
        value: "/",
        triggerIndex: 0,
        cursorOffset: 0,
      }),
    ).toBe(false)
  })

  test("hides slash autocomplete after command arguments without implying prompt deletion", () => {
    expect(
      shouldHideAutocompleteOnInput({
        mode: "/",
        value: "/review staged",
        triggerIndex: 0,
        cursorOffset: "/review staged".length,
      }),
    ).toBe(true)
  })

  test("clears the draft when autocomplete executes a client-side slash action", () => {
    expect(
      shouldClearPromptForAutocompleteSelection({
        visible: "/",
        option: { clearPromptOnSelect: true },
      }),
    ).toBe(true)
    expect(
      shouldClearPromptForAutocompleteSelection({
        visible: "/",
        option: {},
      }),
    ).toBe(false)
    expect(
      shouldClearPromptForAutocompleteSelection({
        visible: "@",
        option: { clearPromptOnSelect: true },
      }),
    ).toBe(false)
  })
})
