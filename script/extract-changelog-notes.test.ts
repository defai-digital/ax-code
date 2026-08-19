import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  buildReleaseNotes,
  changelogAppliesToCli,
  classifyReleaseBody,
  extractChangelogSection,
  formatReleaseNotes,
  main,
  parseReleaseTag,
  releaseTitle,
  shouldReplaceWithChangelog,
  wrapExistingNotes,
} from "./extract-changelog-notes.mjs"

const sample = `# Changelog

## [Unreleased]

## [7.7.0] - 2026-08-19

### Added

- Add scout subagent.

## [7.6.4] - 2026-08-18

### Fixed

- Finish upgrade verification.
`

describe("extractChangelogSection", () => {
  test("returns the matching Keep a Changelog section", () => {
    expect(extractChangelogSection(sample, "7.7.0")).toBe(`## [7.7.0] - 2026-08-19

### Added

- Add scout subagent.
`)
  })

  test("rejects missing and empty sections", () => {
    expect(() => extractChangelogSection(sample, "9.9.9")).toThrow("changelog is missing [9.9.9]")
    expect(() => extractChangelogSection("## [1.0.0] - 2026-01-01\n\n", "1.0.0")).toThrow(
      "changelog section [1.0.0] is empty",
    )
    expect(() => extractChangelogSection(sample, "v7.7.0")).toThrow("invalid version")
  })
})

describe("release note formatting", () => {
  test("parses CLI and Desktop tags", () => {
    expect(parseReleaseTag("v7.7.0")).toEqual({ channel: "cli", version: "7.7.0" })
    expect(parseReleaseTag("desktop-v7.7.0")).toEqual({ channel: "desktop", version: "7.7.0" })
    expect(parseReleaseTag("sdk-v2.0.0")).toBeUndefined()
    expect(releaseTitle("cli", "7.7.0")).toBe("AX Code CLI v7.7.0")
    expect(releaseTitle("desktop", "7.7.0")).toBe("AX Code Desktop v7.7.0")
  })

  test("does not apply the Desktop 1.x changelog to historical CLI 1.x tags", () => {
    expect(changelogAppliesToCli("7.7.0")).toBe(true)
    expect(changelogAppliesToCli("6.7.4")).toBe(true)
    expect(changelogAppliesToCli("1.5.0")).toBe(false)
    expect(shouldReplaceWithChangelog("**Full Changelog**: https://example", "cli", "1.5.0")).toBe(false)
    expect(shouldReplaceWithChangelog("**Full Changelog**: https://example", "cli", "7.6.4")).toBe(true)
  })

  test("formats changelog-backed notes with product and sibling links", () => {
    const notes = formatReleaseNotes({
      channel: "cli",
      version: "7.7.0",
      section: extractChangelogSection(sample, "7.7.0"),
      siblingTag: "desktop-v7.7.0",
      previousTag: "v7.6.4",
    })
    expect(notes).toContain("# AX Code CLI v7.7.0")
    expect(notes).toContain("Terminal CLI and TUI archives.")
    expect(notes).toContain("desktop-v7.7.0")
    expect(notes).toContain("Add scout subagent.")
    expect(notes).toContain("compare/v7.6.4...v7.7.0")
  })

  test("wraps existing custom notes instead of replacing them", () => {
    const existing = "# AX Code v7.4.0\n\n## Highlights\n\n- Image generation.\n"
    expect(classifyReleaseBody(existing)).toBe("custom-prose")
    const notes = wrapExistingNotes({
      channel: "cli",
      version: "7.4.0",
      body: existing,
      siblingTag: "desktop-v7.4.0",
    })
    expect(notes).toContain("# AX Code CLI v7.4.0")
    expect(notes).toContain("## Highlights")
    expect(notes).toContain("Image generation.")
    expect(notes.match(/# AX Code/g)).toHaveLength(1)
  })

  test("replaces auto-generated CLI notes when a post-alignment changelog exists", () => {
    const notes = buildReleaseNotes({
      channel: "cli",
      version: "7.7.0",
      body: "**Full Changelog**: https://github.com/defai-digital/ax-code/compare/v7.6.4...v7.7.0",
      changelog: sample,
      siblingTag: "desktop-v7.7.0",
    })
    expect(notes).toContain("### Added")
    expect(notes).toContain("# AX Code CLI v7.7.0")
    expect(notes).not.toMatch(/^## What's Changed/m)
  })
})

describe("extract-changelog-notes CLI", () => {
  test("writes the extracted section to --out", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ax-code-changelog-notes-"))
    const changelog = path.join(dir, "CHANGELOG.md")
    const out = path.join(dir, "notes", "v7.7.0.md")
    await writeFile(changelog, sample)

    await main(["--version", "7.7.0", "--changelog", changelog, "--out", out], dir)

    expect(await readFile(out, "utf8")).toContain("Add scout subagent.")
  })
})
