import { describe, expect, test } from "vitest"

import { parseChatSlashCommand } from "./chatInputSlashCommand"

describe("parseChatSlashCommand", () => {
  test("parses leading slash commands used by chat submit", () => {
    expect(parseChatSlashCommand("/undo")).toEqual({ name: "undo", rest: "" })
    expect(parseChatSlashCommand("  /summary auth flow")).toEqual({ name: "summary", rest: "auth flow" })
    expect(parseChatSlashCommand("/unknown")).toBeNull()
    expect(parseChatSlashCommand("/undo", "shell")).toBeNull()
  })
})
