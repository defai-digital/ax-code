import { cmd } from "./cmd"
import { UI } from "../ui"
import { runDesignCheck, formatResult } from "../../design-check"
import * as prompts from "@clack/prompts"

export const DesignCheckCommand = cmd({
  command: "design-check [paths..]",
  describe: "scan code for design violations (colors, spacing, accessibility)",
  builder: (yargs) =>
    yargs
      .positional("paths", {
        describe: "paths to scan (default: src/)",
        type: "string",
        array: true,
      })
      .option("rule", {
        describe: "enable/disable a rule (e.g., --rule no-hardcoded-colors=off)",
        type: "string",
        array: true,
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Design Check")

    const paths = args.paths?.length ? args.paths : ["src/"]

    // Parse rule overrides
    const ruleOverrides: Record<string, string> = {}
    for (const rule of args.rule ?? []) {
      const [name, severity] = rule.split("=")
      if (name && severity) ruleOverrides[name] = severity
    }

    const spinner = prompts.spinner()
    spinner.start("Scanning files...")

    const result = await runDesignCheck(paths, {
      rules: ruleOverrides as any,
    })

    spinner.stop("Scan complete")

    if (result.files.length === 0) {
      prompts.log.success("No design violations found!")
    } else {
      process.stdout.write(formatResult(result))
    }

    UI.empty()
    const { totalErrors, totalWarnings, filesScanned } = result.summary
    prompts.outro(`${filesScanned} files scanned: ${totalErrors} errors, ${totalWarnings} warnings`)

    if (totalErrors > 0) process.exitCode = 1
  },
})
