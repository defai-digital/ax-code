/**
 * /init command — generates AGENTS.md project context
 */

import type { CommandModule } from "yargs"
import { Context, type DepthLevel } from "../../context"
import { Filesystem } from "../../util/filesystem"
import {
  detectWiki,
  ensureAgentsWikiPointers,
  runOpenWiki,
  formatElapsed,
  startQuietHeartbeat,
  OPENWIKI_INSTALL_HINT,
  resolveBinary,
  resolveWikiRuntimeConfig,
} from "../../wiki"

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

    const wikiCfg = await resolveWikiRuntimeConfig().catch(() => null)

    // Soft path: if a wiki already exists, keep AGENTS.md pointer fresh without --wiki.
    if (!args.wiki) {
      try {
        const existing = await detectWiki({
          root,
          dir: wikiCfg?.dir,
          command: wikiCfg?.command,
        })
        if (existing.wikiExists && wikiCfg?.autoInjectAgents !== false) {
          const soft = await ensureAgentsWikiPointers(root, {
            wikiRel: existing.wikiDirRelative,
            touchClaudeMd: wikiCfg?.touchClaudeMd !== false,
          })
          if (soft.updated.length) {
            console.log(
              `\nOpenWiki: wiki present at ${existing.wikiDirRelative}/; updated markers: ${soft.updated.join(", ")}`,
            )
          }
        }
      } catch {
        // never fail init on soft wiki inject
      }
      return
    }

    console.log("\nOpenWiki bootstrap (--wiki)…")
    const dir = wikiCfg?.dir ?? "openwiki"
    const command = wikiCfg?.command ?? "openwiki"
    const ensured = await ensureAgentsWikiPointers(root, {
      wikiRel: dir,
      touchClaudeMd: wikiCfg?.touchClaudeMd !== false,
    })
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

    const binary = await resolveBinary(command)
    if (!binary) {
      console.log(`  OpenWiki CLI not found ("${command}").`)
      console.log(`  ${OPENWIKI_INSTALL_HINT}`)
      console.log("  AGENTS markers are in place; generate the wiki later with `ax-code wiki generate`.")
      return
    }

    console.log("  Running OpenWiki generate (may take several minutes; live stream + 15s heartbeats)…")
    const started = Date.now()
    let lastActivity = started
    const stopHeartbeat = startQuietHeartbeat({
      intervalMs: 15_000,
      getLastActivityMs: () => lastActivity,
      getStartedMs: () => started,
      onTick: (elapsedMs) => {
        process.stderr.write(`  [ax-code init --wiki] still running… elapsed ${formatElapsed(elapsedMs)}\n`)
      },
    })
    try {
      const run = await runOpenWiki({
        root,
        action: "generate",
        binaryPath: binary,
        command,
        onProgress: (ev) => {
          lastActivity = Date.now()
          const out = ev.stream === "stdout" ? process.stdout : process.stderr
          out.write(ev.chunk)
        },
      })
      if (run.stdout.length && !run.stdout.endsWith("\n")) process.stdout.write("\n")
      if (run.stderr.length && !run.stderr.endsWith("\n")) process.stderr.write("\n")
      if (!run.ok) {
        console.log(`  OpenWiki generate failed: ${run.error ?? "unknown error"}`)
        if (run.installHint) console.log(`  ${run.installHint}`)
        process.exitCode = 1
        return
      }
      // Re-ensure markers after OpenWiki may have rewritten AGENTS.md
      await ensureAgentsWikiPointers(root, {
        wikiRel: dir,
        touchClaudeMd: wikiCfg?.touchClaudeMd !== false,
      })
      console.log(`  Wiki generate completed in ${formatElapsed(run.durationMs)}`)
    } finally {
      stopHeartbeat()
    }
  },
}
