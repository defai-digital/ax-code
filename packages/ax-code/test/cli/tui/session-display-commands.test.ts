import { describe, expect, test } from "vitest"
import path from "node:path"
import {
  resolveTranscriptExportPath,
  transcriptFilename,
} from "../../../src/cli/cmd/tui/routes/session/display-command-helpers"

describe("tui session display command helpers", () => {
  test("builds transcript export filename from session id", () => {
    expect(transcriptFilename("abcdef123456")).toBe("session-abcdef12.md")
  })

  test("resolves export filenames whose first segment starts with dots", () => {
    expect(resolveTranscriptExportPath("..exports/session.md")).toBe(path.join(process.cwd(), "..exports", "session.md"))
  })

  test("rejects export filenames outside the workspace", () => {
    expect(() => resolveTranscriptExportPath("../session.md")).toThrow("Export filename must stay inside")
    expect(() => resolveTranscriptExportPath(path.join(path.sep, "tmp", "session.md"))).toThrow(
      "Export filename must be relative",
    )
  })
})
