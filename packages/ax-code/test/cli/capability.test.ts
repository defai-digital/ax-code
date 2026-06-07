import { describe, expect, test } from "bun:test"
import { formatCapabilityList } from "../../src/cli/cmd/capability"
import type { Capability } from "../../src/capability"

describe("capability command helpers", () => {
  test("formatCapabilityList includes status, kind, name, and source", () => {
    const output = formatCapabilityList([
      {
        kind: "command",
        name: "release-check",
        sourceTool: "agents",
        scope: "project",
      },
      {
        kind: "skill",
        name: "Bad_Name",
        sourceTool: "opencode",
        scope: "project",
        warnings: [
          {
            code: "skill_standard_issue",
            message: "name should be standard",
            severity: "warn",
          },
        ],
      },
    ] satisfies Capability.Info[])

    expect(output).toContain("ok    command")
    expect(output).toContain("release-check")
    expect(output).toContain("agents/project")
    expect(output).toContain("warn  skill")
    expect(output).toContain("opencode/project")
  })
})
