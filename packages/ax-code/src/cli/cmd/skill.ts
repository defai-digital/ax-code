import { EOL } from "os"
import path from "path"
import { existsSync } from "fs"
import type { Argv } from "yargs"
import matter from "gray-matter"
import { Filesystem } from "../../util/filesystem"
import { Instance } from "../../project/instance"
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

export type SkillDoctorReport = SkillValidationReport & {
  sources: Record<string, number>
}

export type SkillTriggerReport = {
  files: string[]
  matched: Array<Pick<Skill.Info, "name" | "description" | "location" | "sourceTool" | "scope">>
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

export function buildSkillDoctorReport(skills: Skill.Info[]): SkillDoctorReport {
  const nameCounts = new Map<string, number>()
  for (const skill of skills) nameCounts.set(skill.name, (nameCounts.get(skill.name) ?? 0) + 1)

  const issues = skills
    .map((skill) => ({
      name: skill.name,
      location: skill.location,
      issues: skillDoctorIssues(skill, nameCounts),
    }))
    .filter((item) => item.issues.length > 0)

  const sources: Record<string, number> = {}
  for (const skill of skills) {
    const source = [skill.sourceTool ?? "unknown", skill.scope ?? "unknown"].join("/")
    sources[source] = (sources[source] ?? 0) + 1
  }
  return {
    total: skills.length,
    valid: skills.length - issues.length,
    invalid: issues.length,
    issues,
    sources,
  }
}

export function buildSkillTriggerReport(skills: Skill.Info[], files: string[]): SkillTriggerReport {
  return {
    files,
    matched: Skill.matchByPaths(skills, files).map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: skill.location,
      sourceTool: skill.sourceTool,
      scope: skill.scope,
    })),
  }
}

export function applySkillValidationExitCode(
  report: Pick<SkillValidationReport, "invalid">,
  target: { exitCode?: number | string | null | undefined } = process,
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

export function formatSkillDoctorReport(report: SkillDoctorReport) {
  const lines = [formatSkillValidationReport(report).trimEnd()]
  lines.push("")
  lines.push("Sources:")
  for (const [source, count] of Object.entries(report.sources).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${source}: ${count}`)
  }
  return lines.join(EOL).concat(EOL)
}

export function formatSkillTriggerReport(report: SkillTriggerReport) {
  const lines = [`Files: ${report.files.length}`, `Matched skills: ${report.matched.length}`]
  for (const skill of report.matched) {
    lines.push(`  ${skill.name}: ${skill.description}`)
  }
  return lines.join(EOL).concat(EOL)
}

export function skillCreateContent(input: { name: string; description: string }) {
  return matter.stringify(`# ${input.name}${EOL}${EOL}Add task-specific instructions here.${EOL}`, {
    name: input.name,
    description: input.description,
  })
}

export function skillCreatePath(input: { basePath: string; name: string }) {
  return path.join(input.basePath, input.name, "SKILL.md")
}

function skillDoctorIssues(skill: Skill.Info, nameCounts: Map<string, number>) {
  const issues = [...(skill.standardIssues ?? [])]
  const descriptionWords = skill.description.trim().split(/\s+/).filter(Boolean)
  if (skill.description.trim().length < 12 || descriptionWords.length < 3) issues.push("description is too vague")
  if (skill.content.length > 200_000) issues.push("SKILL.md exceeds 200KB")
  if ((skill.paths?.length ?? 0) > 20) issues.push("too many path globs")
  if ((nameCounts.get(skill.name) ?? 0) > 1) issues.push("duplicate skill name")

  const base = path.dirname(skill.location)
  for (const ref of relativeContentReferences(skill.content)) {
    if (!existsSync(path.resolve(base, ref))) issues.push(`referenced file is missing: ${ref}`)
  }

  return Array.from(new Set(issues))
}

function relativeContentReferences(content: string) {
  return Array.from(content.matchAll(/@(\.{1,2}\/[^\s`,)]+)/g)).map((match) => match[1])
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

const SkillCreateCommand = cmd({
  command: "create <name>",
  describe: "create a local Agent Skill skeleton",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "skill name",
      })
      .option("description", {
        type: "string",
        demandOption: true,
        describe: "short description for the skill",
      })
      .option("path", {
        type: "string",
        describe: "base skill directory; defaults to .ax-code/skill in the current worktree",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const name = String(args.name)
      const description = String(args.description)
      const basePath = args.path ? path.resolve(String(args.path)) : path.join(Instance.worktree, ".ax-code", "skill")
      const filePath = skillCreatePath({ basePath, name })
      if (await Filesystem.exists(filePath)) {
        console.error(`Error: Skill file already exists: ${filePath}`)
        process.exitCode = 1
        return
      }
      await Filesystem.write(filePath, skillCreateContent({ name, description }))
      process.stdout.write(filePath + EOL)
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

const SkillDoctorCommand = cmd({
  command: "doctor",
  describe: "diagnose discovered skills and compatibility metadata",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      describe: "output machine-readable JSON",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const report = buildSkillDoctorReport(await Skill.all())
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      } else {
        process.stdout.write(formatSkillDoctorReport(report))
      }
      applySkillValidationExitCode(report)
    })
  },
})

const SkillTestTriggerCommand = cmd({
  command: "test-trigger [files..]",
  describe: "show which skills would be recommended for file paths",
  builder: (yargs: Argv) =>
    yargs
      .positional("files", {
        type: "string",
        array: true,
        describe: "file paths to test",
      })
      .option("json", {
        type: "boolean",
        describe: "output machine-readable JSON",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const files = ((args.files as string[] | undefined) ?? []).filter(Boolean)
      const report = buildSkillTriggerReport(await Skill.all(), files)
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
        return
      }
      process.stdout.write(formatSkillTriggerReport(report))
    })
  },
})

export const SkillCommand = cmd({
  command: "skill",
  describe: "manage and validate Agent Skills",
  builder: (yargs: Argv) =>
    yargs
      .command(SkillListCommand)
      .command(SkillCreateCommand)
      .command(SkillValidateCommand)
      .command(SkillDoctorCommand)
      .command(SkillTestTriggerCommand)
      .demandCommand(),
  async handler() {},
})
