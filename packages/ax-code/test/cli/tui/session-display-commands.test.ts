import { describe, expect, test } from "vitest"
import { transcriptFilename } from "../../../src/cli/cmd/tui/routes/session/display-command-helpers"

describe("tui session display command helpers", () => {
  test("builds transcript export filename from session id", () => {
    expect(transcriptFilename("abcdef123456")).toBe("session-abcdef12.md")
  })
})
