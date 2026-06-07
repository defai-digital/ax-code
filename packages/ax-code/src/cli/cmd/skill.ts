import { EOL } from "os"
import path from "path"
import type { Argv } from "yargs"
import { Skill } from "../../skill"
import {
  buildSkillDoctorReport,
  buildSkillTriggerReport,
  buildSkillValidationReport,
  createSkill,
  SkillInputError,
  skillCreateContent,
  skillCreatePath,
  SkillExistsError,
  SkillPathError,
  type SkillDoctorReport,
  type SkillTriggerReport,
  type SkillValidationReport,
} from "../../skill/authoring"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"

export {
  buildSkillDoctorReport,
  buildSkillTriggerReport,
  buildSkillValidationReport,
  skillCreateContent,
  skillCreatePath,
}
export type { SkillDoctorReport, SkillTriggerReport, SkillValidationReport }

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
      try {
        const result = await createSkill({
          name: String(args.name),
          description: String(args.description),
          path: args.path ? path.resolve(String(args.path)) : undefined,
        })
        process.stdout.write(result.path + EOL)
      } catch (error) {
        if (error instanceof SkillExistsError || error instanceof SkillPathError || error instanceof SkillInputError) {
          console.error(`Error: ${error.message}`)
          process.exitCode = 1
          return
        }
        throw error
      }
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
