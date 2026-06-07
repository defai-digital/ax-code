import { EOL } from "os"
import type { Argv } from "yargs"
import { CompatibilityImport } from "../../import/compatibility"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import {
  ImportCommand as StorageImportCommand,
  parseShareUrl,
  shouldAttachShareAuthHeaders,
  transformShareData,
  type ShareData,
} from "./storage/import"

export { parseShareUrl, shouldAttachShareAuthHeaders, transformShareData, type ShareData }

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
  describe: "import session data, or dry-run import opencode/claude/codex compatibility files",
  builder: (yargs: Argv) =>
    yargs
      .positional("file", {
        describe: "path to JSON file, share URL, or one of: opencode, claude, codex",
        type: "string",
        demandOption: true,
      })
      .option("write", {
        type: "boolean",
        describe: "write compatibility import candidates; dry-run is the default",
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
      })
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
        return
      }
      process.stdout.write(formatCompatibilityImportReport(report))
    })
  },
})
