import type { CommandModule } from "yargs"
import path from "node:path"
import { Context, type DepthLevel } from "../../context"
import { Filesystem } from "../../util/filesystem"
import { ensureAgentsWikiPointers, getWikiStatus, resolveWikiRuntimeConfig, runNativeWiki } from "../../wiki"
import { bootstrap } from "../bootstrap"

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
        describe: "Bootstrap native AX Wiki pointers and generate source-backed pages",
        default: false,
      })
      .option("wiki-only-agents", {
        type: "boolean",
        describe: "With --wiki: only inject AX Wiki pointers; skip model generation",
        default: false,
      }),
  handler: async (args) => {
    const caller = Filesystem.callerCwd()
    const root = Filesystem.resolve(args.directory ? path.resolve(caller, args.directory) : caller)
    const depth = args.depth as DepthLevel

    console.log(`Analyzing project at ${root} (depth: ${depth})...`)
    const result = await Context.init({ root, depth, force: args.force, dryRun: args["dry-run"] })

    if (args["dry-run"]) {
      console.log("\n--- AGENTS.md Preview ---\n")
      console.log(result.content)
      console.log("\n--- End Preview ---")
      return
    }

    if (!result.created) console.log("AGENTS.md already exists. Use --force to regenerate.")
    else {
      const complexity = result.info.complexity
      console.log("\nAGENTS.md generated successfully!")
      console.log(`  File: ${result.path}`)
      console.log(`  Project: ${result.info.name} (${result.info.primaryLanguage})`)
      console.log(`  Stack: ${result.info.techStack.join(", ")}`)
      if (complexity)
        console.log(`  Complexity: ${complexity.level} (${complexity.fileCount} files, ~${complexity.linesOfCode} LOC)`)
    }

    await bootstrap(root, async () => {
      const config = await resolveWikiRuntimeConfig()
      if (!args.wiki) {
        try {
          const status = await getWikiStatus({ root, wikiDir: config.dir })
          if (status.exists && config.autoInjectAgents) {
            const pointers = await ensureAgentsWikiPointers(root, {
              wikiDir: config.dir,
              touchClaudeMd: config.touchClaudeMd,
            })
            if (pointers.updated.length) console.log(`\nAX Wiki: updated pointers in ${pointers.updated.join(", ")}`)
          }
        } catch {
          // A soft pointer refresh must never fail init.
        }
        return
      }

      console.log("\nAX Wiki bootstrap (--wiki)…")
      const pointers = await ensureAgentsWikiPointers(root, {
        wikiDir: config.dir,
        touchClaudeMd: config.touchClaudeMd,
      })
      console.log(
        pointers.updated.length ? `  Pointers: updated ${pointers.updated.join(", ")}` : "  Pointers: already present",
      )

      if (args["wiki-only-agents"]) {
        console.log("  Skipping generation (--wiki-only-agents). Run `ax-code wiki generate` when ready.")
        return
      }

      console.log("  Compiling native AX Wiki with the configured AX Code model…")
      const started = Date.now()
      try {
        const wiki = await runNativeWiki({
          root,
          action: "generate",
          dir: config.dir,
          model: config.model,
          onProgress: (progress) => {
            if (progress.type === "page_start") console.log(`  [${progress.index}/${progress.total}] ${progress.path}`)
          },
        })
        console.log(
          `  Generated ${wiki.generatedPages.length} page(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
        )
      } catch (error) {
        console.error(`  AX Wiki generation failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exitCode = 1
      }
    })
  },
}
