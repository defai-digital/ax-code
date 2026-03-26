/**
 * /init command — generates AX.md project context
 * Ported from ax-cli's init command
 */

import type { CommandModule } from "yargs"
import { Context, type DepthLevel } from "../../context"

export const InitCommand: CommandModule<{}, { depth: string; force: boolean; "dry-run": boolean; directory: string }> = {
  command: "init",
  describe: "Generate AX.md project context for AI comprehension",
  builder: (yargs) =>
    yargs
      .option("depth", {
        type: "string",
        describe: "Analysis depth: basic, standard, full, security",
        default: "standard",
        choices: ["basic", "standard", "full", "security"],
      })
      .option("force", {
        type: "boolean",
        describe: "Force regeneration even if AX.md exists",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "Preview without writing file",
        default: false,
      })
      .option("directory", {
        type: "string",
        describe: "Project directory to analyze",
        default: process.cwd(),
      }),
  handler: async (args) => {
    const root = args.directory
    const depth = args.depth as DepthLevel

    console.log(`Analyzing project at ${root} (depth: ${depth})...`)

    const result = await Context.init({
      root,
      depth,
      force: args.force,
      dryRun: args["dry-run"],
    })

    if (args["dry-run"]) {
      console.log("\n--- AX.md Preview ---\n")
      console.log(result.content)
      console.log("\n--- End Preview ---")
      return
    }

    if (!result.created) {
      console.log("AX.md already exists. Use --force to regenerate.")
      return
    }

    const c = result.info.complexity
    console.log(`\nAX.md generated successfully!`)
    console.log(`  File: ${result.path}`)
    console.log(`  Project: ${result.info.name} (${result.info.primaryLanguage})`)
    console.log(`  Stack: ${result.info.techStack.join(", ")}`)
    if (c) {
      console.log(`  Complexity: ${c.level} (${c.fileCount} files, ~${c.linesOfCode} LOC)`)
    }
  },
}
