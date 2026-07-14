/**
 * ax-code wiki — OpenWiki adapter CLI (ADR-050).
 */

import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Filesystem } from "../../util/filesystem"
import {
  ensureAgentsWikiPointers,
  getWikiStatus,
  runOpenWiki,
  formatElapsed,
  startQuietHeartbeat,
  OPENWIKI_INSTALL_HINT,
  lintWiki,
  buildWikiCards,
  writeWikiCards,
  relatedWikiPages,
  type WikiStatus,
} from "../../wiki"

function rootFromArgs(directory?: string): string {
  return directory || Filesystem.callerCwd()
}

function printStatus(status: WikiStatus, json: boolean) {
  if (json) {
    console.log(
      JSON.stringify(
        {
          healthy: status.healthy,
          root: status.root,
          wikiDir: status.wikiDirRelative,
          wikiExists: status.wikiExists,
          hasIndex: status.hasIndex,
          index: status.indexRelative,
          pageCount: status.pageCount,
          lastUpdate: status.lastUpdate
            ? {
                commit: status.lastUpdate.commit,
                timestamp: status.lastUpdate.timestamp,
                model: status.lastUpdate.model,
              }
            : undefined,
          binary: {
            found: status.binary.found,
            command: status.binary.command,
            path: status.binary.path,
          },
          recommendations: status.recommendations,
        },
        null,
        2,
      ),
    )
    return
  }

  UI.println(`${UI.Style.TEXT_INFO_BOLD}Repo Wiki (OpenWiki)${UI.Style.TEXT_NORMAL}`)
  UI.println(`  root:     ${status.root}`)
  UI.println(`  wiki:     ${status.wikiDirRelative}/ ${status.wikiExists ? "(present)" : "(missing)"}`)
  if (status.wikiExists) {
    UI.println(`  index:    ${status.indexRelative ?? "(none)"}`)
    if (status.pageCount !== undefined) UI.println(`  pages:    ${status.pageCount}`)
    if (status.lastUpdate?.timestamp || status.lastUpdate?.commit) {
      UI.println(
        `  updated:  ${status.lastUpdate.timestamp ?? "?"}  commit=${status.lastUpdate.commit ?? "?"}`,
      )
    }
  }
  UI.println(
    `  binary:   ${status.binary.found ? status.binary.path ?? status.binary.command : `NOT FOUND (${status.binary.command})`}`,
  )
  UI.println(`  healthy:  ${status.healthy ? "yes" : "no"}`)
  UI.println("")
  UI.println("Recommendations:")
  for (const r of status.recommendations) {
    UI.println(`  - ${r}`)
  }
}

export const WikiStatusCommand = cmd({
  command: "status",
  describe: "show OpenWiki binary + openwiki/ directory status",
  builder: (yargs: Argv) =>
    yargs
      .option("json", { type: "boolean", default: false, describe: "machine-readable JSON" })
      .option("directory", { type: "string", describe: "project root (default: cwd)" })
      .option("command", { type: "string", describe: "OpenWiki executable (default: openwiki)" }),
  handler: async (args) => {
    const root = rootFromArgs(args.directory)
    const status = await getWikiStatus({ root, command: args.command })
    printStatus(status, args.json === true)
    if (!status.healthy && args.json !== true) process.exitCode = 1
  },
})

export const WikiDoctorCommand = cmd({
  command: "doctor",
  describe: "health-check wiki setup and print remediation steps",
  builder: (yargs: Argv) =>
    yargs
      .option("json", { type: "boolean", default: false, describe: "machine-readable JSON" })
      .option("directory", { type: "string", describe: "project root (default: cwd)" })
      .option("command", { type: "string", describe: "OpenWiki executable (default: openwiki)" }),
  handler: async (args) => {
    const root = rootFromArgs(args.directory)
    const status = await getWikiStatus({ root, command: args.command })
    printStatus(status, args.json === true)
    if (!args.json) {
      UI.println("")
      UI.println("Knowledge routing:")
      UI.println("  AGENTS.md          → policy, build commands, safety")
      UI.println("  openwiki/          → architecture & design intent (OpenWiki)")
      UI.println("  ax-code index      → structural graph (symbols / callers)")
      UI.println("  .ax-code/memory    → preferences & decisions")
      if (!status.binary.found) {
        UI.println("")
        UI.println(OPENWIKI_INSTALL_HINT)
      }
    }
    // Doctor is non-zero only when neither wiki nor a path to create it exists.
    if (!status.wikiExists && !status.binary.found) process.exitCode = 1
  },
})

export const WikiEnsureAgentsCommand = cmd({
  command: "ensure-agents",
  describe: "inject/update OPENWIKI marker block in AGENTS.md (and CLAUDE.md if present)",
  builder: (yargs: Argv) =>
    yargs
      .option("directory", { type: "string", describe: "project root (default: cwd)" })
      .option("dry-run", { type: "boolean", default: false, describe: "preview without writing" }),
  handler: async (args) => {
    const root = rootFromArgs(args.directory)
    const result = await ensureAgentsWikiPointers(root, { dryRun: args["dry-run"] === true })
    if (args["dry-run"]) {
      for (const [file, content] of Object.entries(result.previews)) {
        UI.println(`--- ${file} (preview) ---`)
        UI.println(content)
      }
      return
    }
    if (result.updated.length === 0) {
      UI.println("Wiki pointer blocks already up to date.")
      return
    }
    UI.println(`Updated: ${result.updated.join(", ")}`)
  },
})

async function runGenerateOrUpdate(
  action: "generate" | "update",
  args: { directory?: string; command?: string; "skip-agents"?: boolean; quiet?: boolean },
) {
  const root = rootFromArgs(args.directory)
  const quiet = args.quiet === true
  UI.println(
    `${UI.Style.TEXT_INFO_BOLD}${action === "generate" ? "Generating" : "Updating"} repo wiki via OpenWiki…${UI.Style.TEXT_NORMAL}`,
  )
  UI.println(`  root: ${root}`)
  UI.println(`  note: long-running LLM job — output streams live; heartbeats every 15s when quiet`)

  const started = Date.now()
  let lastActivity = started
  const stopHeartbeat = quiet
    ? () => {}
    : startQuietHeartbeat({
        intervalMs: 15_000,
        getLastActivityMs: () => lastActivity,
        getStartedMs: () => started,
        onTick: (elapsedMs) => {
          process.stderr.write(`[ax-code wiki] still running… elapsed ${formatElapsed(elapsedMs)}\n`)
        },
      })

  try {
    const result = await runOpenWiki({
      root,
      action,
      command: args.command,
      onProgress: quiet
        ? undefined
        : (ev) => {
            lastActivity = Date.now()
            const out = ev.stream === "stdout" ? process.stdout : process.stderr
            out.write(ev.chunk)
          },
    })

    // When quiet, print buffered output at the end (or always print nothing live).
    if (quiet) {
      if (result.stdout.trim()) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : result.stdout + "\n")
      if (result.stderr.trim()) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : result.stderr + "\n")
    } else {
      // Ensure trailing newline after stream chunks that may not end with \n
      if (result.stdout.length && !result.stdout.endsWith("\n")) process.stdout.write("\n")
      if (result.stderr.length && !result.stderr.endsWith("\n")) process.stderr.write("\n")
    }

    if (!result.ok) {
      UI.println(`${UI.Style.TEXT_WARNING}${result.error ?? "OpenWiki failed"}${UI.Style.TEXT_NORMAL}`)
      if (result.installHint) UI.println(result.installHint)
      process.exitCode = 1
      return
    }

    UI.println(`OpenWiki ${action} completed in ${formatElapsed(result.durationMs)}`)

    if (args["skip-agents"] !== true) {
      const ensured = await ensureAgentsWikiPointers(root)
      if (ensured.updated.length) {
        UI.println(`Agents markers updated: ${ensured.updated.join(", ")}`)
      }
    }
  } finally {
    stopHeartbeat()
  }
}

export const WikiGenerateCommand = cmd({
  command: "generate",
  describe: "generate or refresh the OpenWiki repo wiki (requires openwiki CLI)",
  builder: (yargs: Argv) =>
    yargs
      .option("directory", { type: "string", describe: "project root (default: cwd)" })
      .option("command", { type: "string", describe: "OpenWiki executable (default: openwiki)" })
      .option("skip-agents", { type: "boolean", default: false, describe: "do not touch AGENTS.md markers" })
      .option("quiet", {
        type: "boolean",
        default: false,
        describe: "buffer OpenWiki output until completion (no live stream / heartbeats)",
      }),
  handler: async (args) => runGenerateOrUpdate("generate", args),
})

export const WikiUpdateCommand = cmd({
  command: "update",
  describe: "incrementally update the OpenWiki repo wiki (requires openwiki CLI)",
  builder: (yargs: Argv) =>
    yargs
      .option("directory", { type: "string", describe: "project root (default: cwd)" })
      .option("command", { type: "string", describe: "OpenWiki executable (default: openwiki)" })
      .option("skip-agents", { type: "boolean", default: false, describe: "do not touch AGENTS.md markers" })
      .option("quiet", {
        type: "boolean",
        default: false,
        describe: "buffer OpenWiki output until completion (no live stream / heartbeats)",
      }),
  handler: async (args) => runGenerateOrUpdate("update", args),
})

export const WikiLintCommand = cmd({
  command: "lint",
  describe: "lint wiki health (stale vs HEAD, index, symbol links)",
  builder: (yargs: Argv) =>
    yargs
      .option("json", { type: "boolean", default: false, describe: "machine-readable JSON" })
      .option("directory", { type: "string", describe: "project root (default: cwd)" })
      .option("command", { type: "string", describe: "OpenWiki executable (default: openwiki)" }),
  handler: async (args) => {
    const root = rootFromArgs(args.directory)
    const report = await lintWiki({ root, command: args.command })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      UI.println(`${UI.Style.TEXT_INFO_BOLD}Wiki lint${UI.Style.TEXT_NORMAL}`)
      UI.println(`  wiki:   ${report.wikiDirRelative}/`)
      UI.println(`  ok:     ${report.ok ? "yes" : "no"}`)
      UI.println(`  stale:  ${report.stale ? "yes" : "no"}`)
      if (report.headCommit) UI.println(`  HEAD:   ${report.headCommit.slice(0, 12)}`)
      if (report.wikiCommit) UI.println(`  cursor: ${report.wikiCommit.slice(0, 12)}`)
      UI.println(
        `  pages:  ${report.stats.pageCount}  symbols: ${report.stats.symbolCount}  linked pages: ${report.stats.linkedPageCount}`,
      )
      if (report.issues.length) {
        UI.println("")
        for (const issue of report.issues) {
          UI.println(`  [${issue.level}] ${issue.code}: ${issue.message}`)
        }
      } else {
        UI.println("  No issues.")
      }
    }
    if (!report.ok || report.stale) process.exitCode = 1
  },
})

export const WikiCardsCommand = cmd({
  command: "cards",
  describe: "build Knowledge Cards-lite index from openwiki pages (.ax-code/wiki-cards.md)",
  builder: (yargs: Argv) =>
    yargs
      .option("directory", { type: "string", describe: "project root (default: cwd)" })
      .option("json", { type: "boolean", default: false, describe: "print JSON cards to stdout" })
      .option("stdout", { type: "boolean", default: false, describe: "print markdown to stdout instead of writing" })
      .option("output", { type: "string", describe: "output path (default: .ax-code/wiki-cards.md)" }),
  handler: async (args) => {
    const root = rootFromArgs(args.directory)
    const result = await buildWikiCards({ root })
    if ("error" in result) {
      UI.println(`${UI.Style.TEXT_WARNING}${result.error}${UI.Style.TEXT_NORMAL}`)
      process.exitCode = 1
      return
    }
    if (args.json) {
      console.log(JSON.stringify({ wiki: result.wikiDirRelative, cards: result.cards }, null, 2))
      return
    }
    if (args.stdout) {
      process.stdout.write(result.markdown.endsWith("\n") ? result.markdown : result.markdown + "\n")
      return
    }
    const out = args.output || result.defaultOutputPath
    await writeWikiCards(out, result.markdown)
    UI.println(`Wrote ${result.cards.length} card(s) → ${out}`)
  },
})

export const WikiRelatedCommand = cmd({
  command: "related <symbol>",
  describe: "find wiki pages linked to a symbol (frontmatter symbols: or mention fallback)",
  builder: (yargs: Argv) =>
    yargs
      .positional("symbol", { type: "string", demandOption: true, describe: "symbol or type name" })
      .option("directory", { type: "string", describe: "project root (default: cwd)" })
      .option("json", { type: "boolean", default: false, describe: "machine-readable JSON" })
      .option("exact", {
        type: "boolean",
        default: false,
        describe: "only frontmatter symbols: matches (no body mention fallback)",
      }),
  handler: async (args) => {
    const root = rootFromArgs(args.directory)
    const result = await relatedWikiPages({
      root,
      symbol: String(args.symbol),
      mentionFallback: args.exact !== true,
    })
    if ("error" in result) {
      UI.println(`${UI.Style.TEXT_WARNING}${result.error}${UI.Style.TEXT_NORMAL}`)
      process.exitCode = 1
      return
    }
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    UI.println(`${UI.Style.TEXT_INFO_BOLD}Wiki related: ${result.symbol}${UI.Style.TEXT_NORMAL}`)
    UI.println(
      `  index: ${result.indexStats.pageCount} pages, ${result.indexStats.symbolCount} symbols, ${result.indexStats.linkedPageCount} linked`,
    )
    if (result.matches.length === 0) {
      UI.println("  No matching wiki pages.")
      UI.println("  Tip: add frontmatter symbols: on wiki pages, or use code_intelligence for the graph.")
      process.exitCode = 1
      return
    }
    for (const m of result.matches) {
      UI.println(`  - [${m.via}] ${m.title}  (${m.path})`)
      if (m.summary) UI.println(`      ${m.summary}`)
    }
  },
})

export const WikiCommand = cmd({
  command: "wiki",
  describe: "OpenWiki repo wiki (generate, update, status) — complementary to ax-code index",
  builder: (yargs) =>
    yargs
      .command(WikiStatusCommand)
      .command(WikiDoctorCommand)
      .command(WikiEnsureAgentsCommand)
      .command(WikiGenerateCommand)
      .command(WikiUpdateCommand)
      .command(WikiLintCommand)
      .command(WikiCardsCommand)
      .command(WikiRelatedCommand)
      .demandCommand(),
  async handler() {},
})
