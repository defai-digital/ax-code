import { afterEach, describe, expect, test } from "bun:test"
import type { Skill } from "../../src/skill"
import {
  applySkillValidationExitCode,
  buildSkillDoctorReport,
  buildSkillTriggerReport,
  buildSkillValidationReport,
  formatSkillDoctorReport,
  formatSkillList,
  formatSkillTriggerReport,
  formatSkillValidationReport,
  skillCreateContent,
  skillCreatePath,
} from "../../src/cli/cmd/skill"
import { Instance } from "../../src/project/instance"
import { createSkill, SkillInputError } from "../../src/skill/authoring"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

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

  test("buildSkillDoctorReport summarizes sources", () => {
    const report = buildSkillDoctorReport([
      baseSkill({ name: "release-notes", sourceTool: "opencode", scope: "project" }),
      baseSkill({ name: "qa", sourceTool: "agents", scope: "user" }),
    ])

    expect(report.sources).toEqual({
      "agents/user": 1,
      "opencode/project": 1,
    })
    expect(formatSkillDoctorReport(report)).toContain("Sources:")
  })

  test("buildSkillDoctorReport catches doctor-only maintenance issues", () => {
    const report = buildSkillDoctorReport([
      baseSkill({
        name: "dup",
        description: "Short",
        location: "/repo/.ax-code/skill/dup/SKILL.md",
        content: "Use @./missing.md",
        paths: Array.from({ length: 21 }, (_, index) => `src/${index}/**/*.ts`),
      }),
      baseSkill({
        name: "dup",
        description: "Another duplicate skill.",
        location: "/repo/.ax-code/skill/dup2/SKILL.md",
      }),
    ])

    const first = report.issues.find((issue) => issue.location.endsWith("/dup/SKILL.md"))
    expect(first?.issues).toContain("description is too vague")
    expect(first?.issues).toContain("too many path globs")
    expect(first?.issues).toContain("duplicate skill name")
    expect(first?.issues).toContain("referenced file is missing: ./missing.md")
  })

  test("buildSkillDoctorReport catches oversized skill files", () => {
    const report = buildSkillDoctorReport([
      baseSkill({
        name: "oversized",
        description: "Oversized skill content.",
        content: "x".repeat(200_001),
      }),
    ])

    expect(report.issues[0].issues).toContain("SKILL.md exceeds 200KB")
  })

  test("buildSkillTriggerReport matches path globs", () => {
    const report = buildSkillTriggerReport(
      [baseSkill({ name: "ts", paths: ["**/*.ts"] }), baseSkill({ name: "css", paths: ["**/*.css"] })],
      ["src/index.ts"],
    )

    expect(report.matched.map((skill) => skill.name)).toEqual(["ts"])
    expect(formatSkillTriggerReport(report)).toContain("Matched skills: 1")
  })

  test("skill create helpers write a standard skeleton path and content", () => {
    expect(skillCreatePath({ basePath: "/repo/.ax-code/skill", name: "release-notes" })).toBe(
      "/repo/.ax-code/skill/release-notes/SKILL.md",
    )

    const content = skillCreateContent({
      name: "release-notes",
      description: "Draft release notes.",
    })
    expect(content).toContain("name: release-notes")
    expect(content).toContain("description: Draft release notes.")
    expect(content).toContain("# release-notes")
  })

  test("createSkill validates names at the shared authoring boundary", async () => {
    await using tmp = await tmpdir({ git: true })

    await expect(
      Instance.provide({
        directory: tmp.path,
        fn: () => createSkill({ name: "../../escape", description: "Attempted traversal." }),
      }),
    ).rejects.toThrow(SkillInputError)
  })
})
