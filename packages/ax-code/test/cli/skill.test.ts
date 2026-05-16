import { describe, expect, test } from "bun:test"
import type { Skill } from "../../src/skill"
import {
  applySkillValidationExitCode,
  buildSkillValidationReport,
  formatSkillList,
  formatSkillValidationReport,
} from "../../src/cli/cmd/skill"

const baseSkill = (overrides: Partial<Skill.Info>): Skill.Info => ({
  name: "release-notes",
  description: "Draft release notes.",
  location: "/repo/.ax-code/skill/release-notes/SKILL.md",
  content: "# Release Notes",
  ...overrides,
})

describe("skill command helpers", () => {
  test("buildSkillValidationReport summarizes standard issues", () => {
    const report = buildSkillValidationReport([
      baseSkill({ name: "release-notes" }),
      baseSkill({
        name: "Bad_Name",
        location: "/repo/.ax-code/skill/different-name/SKILL.md",
        standardIssues: ["name should use lowercase letters, numbers, and single hyphen separators"],
      }),
    ])

    expect(report).toEqual({
      total: 2,
      valid: 1,
      invalid: 1,
      issues: [
        {
          name: "Bad_Name",
          location: "/repo/.ax-code/skill/different-name/SKILL.md",
          issues: ["name should use lowercase letters, numbers, and single hyphen separators"],
        },
      ],
    })
  })

  test("formatSkillList marks skills with standard issues as warnings", () => {
    const output = formatSkillList([
      baseSkill({ name: "release-notes" }),
      baseSkill({
        name: "Bad_Name",
        description: "Legacy skill.",
        standardIssues: ["name should use lowercase letters, numbers, and single hyphen separators"],
      }),
    ])

    expect(output).toContain("ok    release-notes")
    expect(output).toContain("warn  Bad_Name")
    expect(output).toContain("Legacy skill.")
  })

  test("formatSkillValidationReport is readable for CI logs", () => {
    const output = formatSkillValidationReport({
      total: 1,
      valid: 0,
      invalid: 1,
      issues: [
        {
          name: "Bad_Name",
          location: "/repo/.ax-code/skill/different-name/SKILL.md",
          issues: ["name should match the parent directory name"],
        },
      ],
    })

    expect(output).toContain("Skills: 1 total, 0 valid, 1 with issues")
    expect(output).toContain("Bad_Name")
    expect(output).toContain("location: /repo/.ax-code/skill/different-name/SKILL.md")
    expect(output).toContain("- name should match the parent directory name")
  })

  test("applySkillValidationExitCode fails when validation finds issues", () => {
    const target: { exitCode?: number | string | undefined } = {}

    applySkillValidationExitCode({ invalid: 1 }, target)

    expect(target.exitCode).toBe(1)
  })

  test("applySkillValidationExitCode leaves valid runs successful", () => {
    const target: { exitCode?: number | string | undefined } = {}

    applySkillValidationExitCode({ invalid: 0 }, target)

    expect(target.exitCode).toBeUndefined()
  })
})
