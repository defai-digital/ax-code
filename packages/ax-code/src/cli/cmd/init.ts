/**
 * /init command — generates AGENTS.md project context
 */

import type { CommandModule } from "yargs"
import { Context, type DepthLevel } from "../../context"
import { Filesystem } from "../../util/filesystem"
import { ensureAgentsWikiPointers, runOpenWiki, OPENWIKI_INSTALL_HINT, resolveBinary, resolveWikiCommand } from "../../wiki"

export const InitCommand: CommandModule<
  {},
  {
    depth: string
    force: boolean
    "dry-run": boolean
    directory?: string
    wiki: boolean
    "wiki-only-agents": boolean
  }
> = {
  command: "init",
  describe: "Generate AGENTS.md project context for AI comprehension",
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
        describe: "Force regeneration even if AGENTS.md exists",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "Preview without writing file",
        default: false,
      })
      .option("directory", {
        type: "string",
        describe: "Project directory to analyze (defaults to the caller's cwd)",
      })
      .option("wiki", {
        type: "boolean",
        describe: "Bootstrap OpenWiki: ensure AGENTS markers and run wiki generate when OpenWiki CLI is available",
        default: false,
      })
      .option("wiki-only-agents", {
        type: "boolean",
        describe: "With --wiki: only inject AGENTS/CLAUDE markers; skip OpenWiki generate",
        default: false,
      }),
  handler: async (args) => {
    const root = args.directory || Filesystem.callerCwd()
    const depth = args.depth as DepthLevel

    console.log(`Analyzing project at ${root} (depth: ${depth})...`)

    const result = await Context.init({
      root,
      depth,
      force: args.force,
      dryRun: args["dry-run"],
    })

    if (args["dry-run"]) {
      console.log("\n--- AGENTS.md Preview ---\n")
      console.log(result.content)
      console.log("\n--- End Preview ---")
      return
    }

    if (!result.created) {
      console.log("AGENTS.md already exists. Use --force to regenerate.")
    } else {
      const c = result.info.complexity
      console.log(`\nAGENTS.md generated successfully!`)
      console.log(`  File: ${result.path}`)
      console.log(`  Project: ${result.info.name} (${result.info.primaryLanguage})`)
      console.log(`  Stack: ${result.info.techStack.join(", ")}`)
      if (c) {
        console.log(`  Complexity: ${c.level} (${c.fileCount} files, ~${c.linesOfCode} LOC)`)
      }
    }

    if (!args.wiki) return

    console.log("\nOpenWiki bootstrap (--wiki)…")
    const ensured = await ensureAgentsWikiPointers(root)
    if (ensured.updated.length) {
      console.log(`  Markers: updated ${ensured.updated.join(", ")}`)
    } else {
      console.log("  Markers: already present")
    }

    if (args["wiki-only-agents"]) {
      console.log("  Skipping OpenWiki generate (--wiki-only-agents).")
      console.log("  Run `ax-code wiki generate` when ready.")
      return
    }

    const command = resolveWikiCommand()
    const binary = await resolveBinary(command)
    if (!binary) {
      console.log(`  OpenWiki CLI not found ("${command}").`)
      console.log(`  ${OPENWIKI_INSTALL_HINT}`)
      console.log("  AGENTS markers are in place; generate the wiki later with `ax-code wiki generate`.")
      return
    }

    console.log("  Running OpenWiki generate (may take several minutes)…")
    const run = await runOpenWiki({ root, action: "generate", binaryPath: binary, command })
    if (run.stdout.trim()) process.stdout.write(run.stdout.endsWith("\n") ? run.stdout : run.stdout + "\n")
    if (run.stderr.trim()) process.stderr.write(run.stderr.endsWith("\n") ? run.stderr : run.stderr + "\n")
    if (!run.ok) {
      console.log(`  OpenWiki generate failed: ${run.error ?? "unknown error"}`)
      if (run.installHint) console.log(`  ${run.installHint}`)
      process.exitCode = 1
      return
    }
    // Re-ensure markers after OpenWiki may have rewritten AGENTS.md
    await ensureAgentsWikiPointers(root)
    console.log(`  Wiki generate completed in ${Math.round(run.durationMs / 1000)}s`)
  },
}
