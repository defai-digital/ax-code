import { describe, expect, test } from "vitest"

import { buildUpdateReleaseUrl, normalizeReleaseNotesForMarkdown } from "./updateReleaseNotes"

describe("normalizeReleaseNotesForMarkdown", () => {
  test("converts HTML release notes to readable markdown text", () => {
    const html =
      "<h2>[1.1.3] - 2026-06-14</h2><ul><li>UI: fixed provider loading.</li><li>CI: retried installs.</li></ul>"

    expect(normalizeReleaseNotesForMarkdown(html)).toBe(
      "## [1.1.3] - 2026-06-14\n\n- UI: fixed provider loading.\n- CI: retried installs.",
    )
  })

  test("keeps markdown release notes unchanged", () => {
    const markdown = "## [1.1.3] - 2026-06-14\n\n- UI: fixed provider loading."

    expect(normalizeReleaseNotesForMarkdown(markdown)).toBe(markdown)
  })

  test("decodes common HTML entities", () => {
    expect(normalizeReleaseNotesForMarkdown("<p>Fix A &amp; B &#35;42</p>")).toBe("Fix A & B #42")
  })
})

describe("buildUpdateReleaseUrl", () => {
  test("links bare versions to package release tags", () => {
    expect(buildUpdateReleaseUrl("6.7.19")).toBe("https://github.com/defai-digital/ax-code/releases/tag/v6.7.19")
  })

  test("preserves versions that already include a release tag prefix", () => {
    expect(buildUpdateReleaseUrl("desktop-v6.7.19")).toBe(
      "https://github.com/defai-digital/ax-code/releases/tag/desktop-v6.7.19",
    )
    expect(buildUpdateReleaseUrl("v6.7.19")).toBe(
      "https://github.com/defai-digital/ax-code/releases/tag/v6.7.19",
    )
  })

  test("falls back to the release list when no version is available", () => {
    expect(buildUpdateReleaseUrl(undefined)).toBe("https://github.com/defai-digital/ax-code/releases")
  })
})
