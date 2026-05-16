import { EOL } from "os"
import type { Argv } from "yargs"
import { Skill } from "../../skill"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"

export type SkillValidationIssue = {
  name: string
  location: string
  issues: string[]
}

export type SkillValidationReport = {
  total: number
  valid: number
  invalid: number
  issues: SkillValidationIssue[]
}

export function buildSkillValidationReport(skills: Skill.Info[]): SkillValidationReport {
  const issues = skills
    .filter((skill) => skill.standardIssues?.length)
    .map((skill) => ({
      name: skill.name,
      location: skill.location,
      issues: skill.standardIssues ?? [],
    }))

  return {
    total: skills.length,
    valid: skills.length - issues.length,
    invalid: issues.length,
    issues,
  }
}

export function applySkillValidationExitCode(
  report: Pick<SkillValidationReport, "invalid">,
  target: { exitCode?: number | string | undefined } = process,
) {
  if (report.invalid > 0) target.exitCode = 1
}

export function formatSkillList(skills: Skill.Info[]) {
  if (skills.length === 0) return `No skills found.${EOL}`

  return skills
    .map((skill) => {
      const status = skill.standardIssues?.length ? "warn" : "ok"
      return `${status.padEnd(4)}  ${skill.name.padEnd(24)}  ${skill.description}`
    })
    .join(EOL)
    .concat(EOL)
}

export function formatSkillValidationReport(report: SkillValidationReport) {
  const lines = [`Skills: ${report.total} total, ${report.valid} valid, ${report.invalid} with issues`]

  for (const item of report.issues) {
    lines.push("")
    lines.push(`${item.name}`)
    lines.push(`  location: ${item.location}`)
    for (const issue of item.issues) {
      lines.push(`  - ${issue}`)
    }
  }

  return lines.join(EOL).concat(EOL)
}

const SkillListCommand = cmd({
  command: "list",
  describe: "list available skills",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      describe: "output machine-readable JSON",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const skills = await Skill.all()
      if (args.json) {
        process.stdout.write(JSON.stringify(skills, null, 2) + EOL)
        return
      }
      process.stdout.write(formatSkillList(skills))
    })
  },
})

const SkillValidateCommand = cmd({
  command: "validate",
  describe: "validate discovered skills against the Agent Skills standard",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      describe: "output machine-readable JSON",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const report = buildSkillValidationReport(await Skill.all())
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      } else {
        process.stdout.write(formatSkillValidationReport(report))
      }
      applySkillValidationExitCode(report)
    })
  },
})

export const SkillCommand = cmd({
  command: "skill",
  describe: "manage and validate Agent Skills",
  builder: (yargs: Argv) => yargs.command(SkillListCommand).command(SkillValidateCommand).demandCommand(),
  async handler() {},
})
