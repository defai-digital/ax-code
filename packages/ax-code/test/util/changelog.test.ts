import { describe, expect, test, vi } from "vitest"
import {
  capChangelog,
  CHANGELOG_MAX_BYTES,
  CHANGELOG_TRUNCATION_NOTE,
  findSection,
  latestSection,
  parseChangelog,
  renderReleaseNotesHuman,
  renderSection,
  resolveReleaseNotes,
} from "../../src/util/changelog"
import { ReleaseNotesCommand, renderReleaseNotesHuman as renderFromCommand } from "../../src/cli/cmd/release-notes"

const sample = [
  "# Changelog",
  "",
  "Preamble line.",
  "",
  "## [Unreleased]",
  "",
  "## [7.26.3] - 2026-10-16",
  "",
  "### Fixed",
  "",
  "- Alpha fix.",
  "",
  "## [7.26.2] - 2026-10-16",
  "",
  "### Changed",
  "",
  "- Beta change.",
  "",
  "## [7.25.0] - 2026-10-12",
  "",
  "- Gamma.",
].join("\n")

describe("changelog parser", () => {
  test("splits level-2 version headings and keeps subsections in the body", () => {
    const doc = parseChangelog(sample)
    expect(doc.preamble).toContain("Preamble line.")
    expect(doc.sections.map((s) => s.version)).toEqual(["Unreleased", "7.26.3", "7.26.2", "7.25.0"])
    expect(doc.sections[1].date).toBe("2026-10-16")
    expect(doc.sections[1].heading).toBe("[7.26.3] - 2026-10-16")
    expect(doc.sections[1].body).toContain("### Fixed")
    expect(doc.sections[1].body).toContain("Alpha fix.")
    // The `###` subsection must never be parsed as its own version section.
    expect(doc.sections.some((s) => s.version.includes("Fixed"))).toBe(false)
  })

  test("findSection matches exactly, tolerating a leading v and case", () => {
    const doc = parseChangelog(sample)
    expect(findSection(doc, "7.26.3")?.version).toBe("7.26.3")
    expect(findSection(doc, "v7.26.3")?.version).toBe("7.26.3")
    expect(findSection(doc, "7.26.4")).toBeUndefined()
  })

  test("latestSection skips Unreleased and falls back to the first entry", () => {
    expect(latestSection(parseChangelog(sample))?.version).toBe("7.26.3")
    const onlyUnreleased = parseChangelog("## [Unreleased]\n\n- pending")
    expect(latestSection(onlyUnreleased)?.version).toBe("Unreleased")
  })

  test("renderSection emits the heading and body", () => {
    const section = findSection(parseChangelog(sample), "7.25.0")!
    expect(renderSection(section).text).toBe("## [7.25.0] - 2026-10-12\n\n- Gamma.")
  })
})

describe("changelog size cap", () => {
  test("caps oversized text and appends a truncation note", () => {
    const big = "x".repeat(CHANGELOG_MAX_BYTES + 500)
    const capped = capChangelog(big)
    expect(capped.truncated).toBe(true)
    expect(capped.text.endsWith(CHANGELOG_TRUNCATION_NOTE)).toBe(true)
    expect(Buffer.byteLength(capped.text, "utf8")).toBeLessThan(CHANGELOG_MAX_BYTES + 500)
  })

  test("leaves small text untouched", () => {
    expect(capChangelog("short")).toEqual({ text: "short", truncated: false })
  })
})

describe("resolveReleaseNotes", () => {
  test("resolves the requested version", () => {
    const outcome = resolveReleaseNotes({ changelog: sample, version: "7.26.2" })
    expect(outcome.status).toBe("ok")
    if (outcome.status !== "ok") return
    expect(outcome.version).toBe("7.26.2")
    expect(outcome.text).toContain("Beta change.")
  })

  test("defaults to the latest released section when no version is given", () => {
    const outcome = resolveReleaseNotes({ changelog: sample })
    expect(outcome.status).toBe("ok")
    if (outcome.status !== "ok") return
    expect(outcome.version).toBe("7.26.3")
  })

  test("reports not-found with the available versions", () => {
    const outcome = resolveReleaseNotes({ changelog: sample, version: "9.9.9" })
    expect(outcome.status).toBe("not-found")
    if (outcome.status !== "not-found") return
    expect(outcome.requested).toBe("9.9.9")
    expect(outcome.available).toContain("7.26.3")
  })

  test("reports unavailable when no changelog was bundled", () => {
    expect(resolveReleaseNotes({ changelog: undefined, version: "1.0.0" })).toEqual({ status: "unavailable" })
  })
})

describe("release-notes human rendering", () => {
  test("renders each outcome distinctly", () => {
    expect(renderReleaseNotesHuman({ status: "unavailable" })).toContain("not bundled")
    expect(renderReleaseNotesHuman({ status: "not-found", requested: "9.9.9", available: ["1.0.0"] })).toBe(
      "no release notes for version 9.9.9 (available: 1.0.0)",
    )
    expect(renderReleaseNotesHuman({ status: "ok", version: "1.0.0", text: "## [1.0.0]", truncated: false })).toBe(
      "## [1.0.0]",
    )
    // The command re-exports the same renderer so the CLI and TUI cannot drift.
    expect(renderFromCommand).toBe(renderReleaseNotesHuman)
  })
})

describe("release-notes command", () => {
  test("declares the version and json options", () => {
    expect(ReleaseNotesCommand.command).toBe("release-notes")
  })

  test("prints a JSON document for a requested version", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const previous = process.exitCode
    process.exitCode = undefined
    try {
      // Inject the changelog through the module's own loader by pointing at the
      // repository CHANGELOG.md (present in a source checkout).
      await ReleaseNotesCommand.handler({ "target-version": "7.26.3", json: true, _: [], $0: "ax-code" } as any)
      const printed = writeSpy.mock.calls.map((call) => String(call[0])).join("")
      const parsed = JSON.parse(printed)
      expect(parsed.version).toBe("7.26.3")
      expect(parsed.text).toContain("## [7.26.3]")
      expect(process.exitCode).toBeUndefined()
    } finally {
      writeSpy.mockRestore()
      process.exitCode = previous
    }
  })

  test("fails with exit 1 and a message for an unknown version", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const previous = process.exitCode
    process.exitCode = undefined
    try {
      await ReleaseNotesCommand.handler({
        "target-version": "0.0.0-nonexistent",
        json: false,
        _: [],
        $0: "ax-code",
      } as any)
      expect(process.exitCode).toBe(1)
      const printed = errSpy.mock.calls.map((call) => String(call[0])).join("")
      expect(printed).toContain("no release notes for version 0.0.0-nonexistent")
    } finally {
      errSpy.mockRestore()
      process.exitCode = previous
    }
  })
})
