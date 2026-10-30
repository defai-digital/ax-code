import { expect, test } from "vitest"
import { buildBody, buildReleaseNotes, extractVersionSection, loadChangelog } from "./build-release-notes"

const changelog = `# Changelog

## [Unreleased]

## [0.1.3] - 2026-09-07

### Performance

- Memoize chart layouts.

## [0.1.2] - 2026-09-05

### Documentation

- Package overview.
`

test("extractVersionSection returns the section body without the heading", () => {
  const section = extractVersionSection(changelog, "0.1.3")
  expect(section).not.toBeNull()
  expect(section!.startsWith("### Performance")).toBe(true)
  expect(section).toContain("- Memoize chart layouts.")
  expect(section).not.toContain("0.1.2")
})

test("extractVersionSection stops at the next version heading", () => {
  const section = extractVersionSection(changelog, "0.1.2")
  expect(section).toContain("- Package overview.")
  expect(section).not.toContain("0.1.3")
})

test("extractVersionSection returns null for a missing version", () => {
  expect(extractVersionSection(changelog, "9.9.9")).toBeNull()
})

test("buildBody links the public GitHub Packages package, embeds the section, and adds usage", () => {
  const body = buildBody("0.1.3", "### Performance\n\n- Memoize chart layouts.")
  expect(body).toContain("# ax-tui v0.1.3")
  expect(body).toContain("[`@defai-digital/ax-tui@0.1.3`](https://github.com/orgs/defai-digital/packages/npm/package/ax-tui)")
  expect(body).toContain("Public GitHub Packages release")
  expect(body).not.toContain("Private GitHub Packages release")
  expect(body).toContain("## What's changed")
  expect(body).toContain("- Memoize chart layouts.")
  expect(body).toContain("## Install")
  expect(body).toContain("pnpm add @defai-digital/ax-tui@0.1.3")
  expect(body).toContain("MAINTENANCE.md")
})

test("buildReleaseNotes throws when the changelog lacks the version", () => {
  expect(() => buildReleaseNotes(changelog, "9.9.9")).toThrow(/No CHANGELOG section found for version 9\.9\.9/)
})

test("real CHANGELOG.md covers every released version", async () => {
  const real = await loadChangelog()
  for (const version of ["0.1.3", "0.1.2", "0.1.1"]) {
    expect(extractVersionSection(real, version), `CHANGELOG section for ${version}`).not.toBeNull()
    expect(() => buildReleaseNotes(real, version)).not.toThrow()
  }
})
