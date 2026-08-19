import { describe, expect, test } from "vitest"
import { planReleaseUpdates } from "./sync-github-release-notes.mjs"

const changelog = `# Changelog

## [7.7.0] - 2026-08-19

### Added

- Add scout subagent.

## [7.6.4] - 2026-08-18

### Fixed

- Finish upgrade verification.
`

describe("planReleaseUpdates", () => {
  test("titles CLI and Desktop releases and fills missing changelog notes", () => {
    const plan = planReleaseUpdates(
      [
        { tag_name: "v7.7.0", name: "v7.7.0", body: "**Full Changelog**: https://example", draft: false },
        { tag_name: "desktop-v7.7.0", name: "v7.7.0", body: "## [7.7.0] - 2026-08-19\n\n### Added\n\n- Add scout subagent.\n", draft: false },
        { tag_name: "v1.5.0", name: "v1.5.0", body: "Security + Gemini + 57 bug fixes", draft: false },
        { tag_name: "sdk-v2.0.0", name: "v2.0.0", body: "SDK release", draft: false },
      ],
      changelog,
    )

    expect(plan.map((item) => item.tag)).toEqual(["v7.7.0", "desktop-v7.7.0", "v1.5.0"])
    expect(plan[0].name).toBe("AX Code CLI v7.7.0")
    expect(plan[0].notes).toContain("Add scout subagent.")
    expect(plan[0].notes).toContain("desktop-v7.7.0")
    expect(plan[1].name).toBe("AX Code Desktop v7.7.0")
    expect(plan[2].name).toBe("AX Code CLI v1.5.0")
    expect(plan[2].notes).toContain("Security + Gemini + 57 bug fixes")
    expect(plan[2].notes).not.toContain("Add scout subagent.")
  })
})
