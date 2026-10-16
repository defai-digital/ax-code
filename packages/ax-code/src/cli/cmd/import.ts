import { EOL } from "os"
import type { Argv } from "yargs"
import { CompatibilityImport } from "../../import/compatibility"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { ImportCommand as StorageImportCommand } from "./storage/import"

export function formatCompatibilityImportReport(report: CompatibilityImport.Report) {
  const lines = [
    `Import ${report.source}: ${report.dryRun ? "dry-run" : "written"}`,
    `Candidates: ${report.total}, copy: ${report.copy}, skipped: ${report.skipped}`,
  ]
  for (const item of report.candidates) {
    const warning = item.warnings?.length ? ` warnings=${item.warnings.join(",")}` : ""
    const reason = item.reason ? ` reason=${item.reason}` : ""
    lines.push(`  ${item.action} ${item.kind} ${item.sourcePath} -> ${item.targetPath}${reason}${warning}`)
  }
  return lines.join(EOL).concat(EOL)
}

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data, or dry-run import opencode/claude/codex/cursor/windsurf compatibility files",
  builder: (yargs: Argv) =>
    yargs
      .positional("file", {
        describe: "path to JSON file, or one of: opencode, claude, codex, cursor, windsurf",
        type: "string",
        demandOption: true,
      })
      .option("write", {
        type: "boolean",
        describe: "write compatibility import candidates; dry-run is the default",
      })
      .option("user", {
        type: "boolean",
        describe:
          "also read user-level files (~/.claude.json, ~/.codex/config.toml). Nothing outside the project is read without this flag. Codex config.toml MCP tables are reported but not imported (no TOML parser).",
      })
      .option("json", {
        type: "boolean",
        describe: "output machine-readable JSON for compatibility imports",
      }),
  async handler(args) {
    const source = CompatibilityImport.Source.safeParse(args.file)
    if (!source.success) {
      await StorageImportCommand.handler?.(args as never)
      return
    }

    await bootstrap(process.cwd(), async () => {
      const report = await CompatibilityImport.run({
        source: source.data,
        directory: process.cwd(),
        write: args.write === true,
        user: args.user === true,
      })
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
        return
      }
      process.stdout.write(formatCompatibilityImportReport(report))
    })
  },
})
