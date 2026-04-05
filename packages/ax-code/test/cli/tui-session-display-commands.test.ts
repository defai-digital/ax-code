import { describe, expect, test } from "bun:test"
import { shareTitle, transcriptFilename } from "../../src/cli/cmd/tui/routes/session/display-command-helpers"

describe("tui session display command helpers", () => {
  test("formats share title from share state", () => {
    expect(shareTitle(undefined)).toBe("Share session")
    expect(shareTitle("https://example.com")).toBe("Copy share link")
  })

  test("builds transcript export filename from session id", () => {
    expect(transcriptFilename("abcdef123456")).toBe("session-abcdef12.md")
  })
})
