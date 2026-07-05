import { describe, expect, test } from "vitest"
import { buildBuiltInCommands, filterCommandList } from "./CommandAutocompleteCommands"
import type { CommandInfo } from "./CommandAutocomplete"

const t = ((key: string) => key) as Parameters<typeof buildBuiltInCommands>[0]["t"]

const commandNames = (input: Parameters<typeof buildBuiltInCommands>[0]): string[] =>
  buildBuiltInCommands(input).map((command) => command.name)

describe("buildBuiltInCommands", () => {
  test("returns session commands before a session has messages", () => {
    expect(
      commandNames({
        hasSession: true,
        hasMessagesInCurrentSession: false,
        canStartSessionCommand: true,
        t,
      }),
    ).toEqual([
      "init",
      "undo",
      "redo",
      "timeline",
      "compact",
      "summary",
      "workspace-review",
      "plan-feature",
      "catch-up",
      "debug",
      "weigh",
      "explore",
    ])
  })

  test("omits init after the session has messages", () => {
    expect(
      commandNames({
        hasSession: true,
        hasMessagesInCurrentSession: true,
        canStartSessionCommand: true,
        t,
      }),
    ).not.toContain("init")
  })

  test("keeps start-session commands available for a new-session draft", () => {
    expect(
      commandNames({
        hasSession: false,
        hasMessagesInCurrentSession: false,
        canStartSessionCommand: true,
        t,
      }),
    ).toEqual(["compact", "workspace-review", "plan-feature", "catch-up", "debug", "weigh", "explore"])
  })

  test("falls back to compact when there is no active session or draft", () => {
    expect(
      commandNames({
        hasSession: false,
        hasMessagesInCurrentSession: false,
        canStartSessionCommand: false,
        t,
      }),
    ).toEqual(["compact"])
  })
})

describe("filterCommandList", () => {
  const commands: CommandInfo[] = [
    { id: "openchamber:init", name: "init", source: "openchamber", description: "Initialize project" },
    { id: "openchamber:debug", name: "debug", source: "openchamber", description: "Investigate a failure" },
    { id: "skill:docs", name: "docs", source: "skill", description: "Write documentation" },
  ]

  test("filters by command name or description", () => {
    expect(filterCommandList(commands, { searchQuery: "fail", allowInitCommand: true }).map((command) => command.name))
      .toEqual(["debug"])
    expect(filterCommandList(commands, { searchQuery: "doc", allowInitCommand: true }).map((command) => command.name))
      .toEqual(["docs"])
  })

  test("hides init when the current session already has messages", () => {
    expect(filterCommandList(commands, { searchQuery: "", allowInitCommand: false }).map((command) => command.name))
      .toEqual(["debug", "docs"])
  })
})
