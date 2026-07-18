import type { Argv } from "yargs"
import path from "node:path"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Filesystem } from "../../util/filesystem"
import {
  buildWikiCards,
  engineConfig,
  ensureAgentsWikiPointers,
  getWikiStatus,
  gitHeadCommit,
  lintWiki,
  planNativeWiki,
  relatedWikiPages,
  resolveWikiRuntimeConfig,
  runNativeWiki,
  writeWikiCards,
  type WikiRuntimeConfig,
  type WikiStatus,
} from "../../wiki"
import { cmd } from "./cmd"

type CommonArgs = { directory?: string; dir?: string; model?: string }

function rootFromArgs(directory?: string): string {
  const caller = Filesystem.callerCwd()
  return Filesystem.resolve(directory ? path.resolve(caller, directory) : caller)
}

async function withWiki<T>(args: CommonArgs, fn: (input: { root: string; config: WikiRuntimeConfig }) => Promise<T>) {
  const root = rootFromArgs(args.directory)
  return bootstrap(root, async () => fn({ root, config: await resolveWikiRuntimeConfig(args) }))
}

function printStatus(status: WikiStatus, json: boolean) {
  if (json) {
    console.log(JSON.stringify(status, null, 2))
    return
  }
  UI.println(`${UI.Style.TEXT_INFO_BOLD}AX Wiki${UI.Style.TEXT_NORMAL}`)
  UI.println(`  root:     ${status.root}`)
  UI.println(`  wiki:     ${status.wikiDir}/ ${status.exists ? "(present)" : "(missing)"}`)
  UI.println(`  index:    ${status.index ?? "(none)"}`)
  UI.println(`  pages:    ${status.pageCount}`)
  UI.println(`  manifest: ${status.manifest ? "present" : "missing"}`)
  UI.println(`  stale:    ${status.stale ? "yes" : "no"}`)
  UI.println(`  healthy:  ${status.healthy ? "yes" : "no"}`)
  UI.println("")
  UI.println("Recommendations:")
  for (const recommendation of status.recommendations) UI.println(`  - ${recommendation}`)
}

const dirOption = {
  type: "string" as const,
  describe: "AX Wiki directory relative to project root (default: ax-wiki)",
}

const modelOption = {
  type: "string" as const,
  describe: "generation model as provider/model (default: AX Code model)",
}

function commonOptions(yargs: Argv) {
  return yargs.option("directory", { type: "string", describe: "project root (default: cwd)" }).option("dir", dirOption)
}

export const WikiStatusCommand = cmd({
  command: "status",
  describe: "show native AX Wiki health and freshness",
  builder: (yargs: Argv) =>
    commonOptions(yargs).option("json", { type: "boolean", default: false, describe: "machine-readable JSON" }),
  handler: async (args) => {
    await withWiki(args, async ({ root, config }) => {
      const status = await getWikiStatus({ root, wikiDir: config.dir, repositoryHead: await gitHeadCommit(root) })
      printStatus(status, args.json === true)
      if (!status.healthy || status.stale) process.exitCode = 1
    })
  },
})

export const WikiDoctorCommand = cmd({
  command: "doctor",
  describe: "validate AX Wiki artifacts, sources, and knowledge routing",
  builder: (yargs: Argv) =>
    commonOptions(yargs).option("json", { type: "boolean", default: false, describe: "machine-readable JSON" }),
  handler: async (args) => {
    await withWiki(args, async ({ root, config }) => {
      const head = await gitHeadCommit(root)
      const status = await getWikiStatus({ root, wikiDir: config.dir, repositoryHead: head })
      const lint = await lintWiki({
        root,
        wikiDir: config.dir,
        repositoryHead: head,
        config: engineConfig(config),
      })
      if (args.json) console.log(JSON.stringify({ status, lint }, null, 2))
      else {
        printStatus(status, false)
        UI.println("")
        UI.println(
          `Lint: ok=${lint.ok} stale=${lint.stale} pages=${lint.stats.pageCount} symbols=${lint.stats.symbolCount}`,
        )
        for (const issue of lint.issues) UI.println(`  [${issue.level}] ${issue.code}: ${issue.message}`)
        UI.println("")
        UI.println("Knowledge routing:")
        UI.println("  AGENTS.md             → policy, build commands, safety")
        UI.println(`  ${config.dir}/             → architecture, workflows, design intent`)
        UI.println("  ax-code index         → precise symbols, callers, references")
        UI.println("  .ax-code/memory.json  → preferences and decisions")
      }
      if (!status.healthy || !lint.ok || lint.stale) process.exitCode = 1
    })
  },
})

export const WikiPlanCommand = cmd({
  command: "plan",
  describe: "preview the deterministic AX Wiki page plan without model calls",
  builder: (yargs: Argv) =>
    commonOptions(yargs).option("json", { type: "boolean", default: false, describe: "machine-readable JSON" }),
  handler: async (args) => {
    await withWiki(args, async ({ root, config }) => {
      const plan = await planNativeWiki({ root, dir: config.dir })
      if (args.json) console.log(JSON.stringify(plan, null, 2))
      else {
        UI.println(`${UI.Style.TEXT_INFO_BOLD}AX Wiki plan${UI.Style.TEXT_NORMAL}`)
        UI.println(`  sources: ${plan.sourceCount}  pages: ${plan.pages.length}`)
        for (const page of plan.pages) UI.println(`  - ${page.path}: ${page.title}`)
      }
    })
  },
})

export const WikiEnsureAgentsCommand = cmd({
  command: "ensure-agents",
  describe: "inject or update the AX-WIKI block in AGENTS.md and existing CLAUDE.md",
  builder: (yargs: Argv) =>
    commonOptions(yargs)
      .option("dry-run", { type: "boolean", default: false, describe: "preview without writing" })
      .option("force", { type: "boolean", default: false, describe: "override wiki.autoInjectAgents=false" }),
  handler: async (args) => {
    await withWiki(args, async ({ root, config }) => {
      if (!config.autoInjectAgents && args.force !== true) {
        UI.println("Skipped: wiki.autoInjectAgents is false (use --force to override).")
        return
      }
      const result = await ensureAgentsWikiPointers(root, {
        dryRun: args["dry-run"] === true,
        wikiDir: config.dir,
        touchClaudeMd: config.touchClaudeMd,
      })
      if (args["dry-run"]) {
        for (const [file, content] of Object.entries(result.previews)) {
          UI.println(`--- ${file} (preview) ---`)
          UI.println(content)
        }
      } else
        UI.println(
          result.updated.length
            ? `Updated: ${result.updated.join(", ")}`
            : "AX Wiki pointer blocks already up to date.",
        )
    })
  },
})

async function runGenerateOrUpdate(
  action: "generate" | "update",
  args: CommonArgs & { "skip-agents"?: boolean; quiet?: boolean; force?: boolean },
) {
  await withWiki(args, async ({ root, config }) => {
    UI.println(
      `${UI.Style.TEXT_INFO_BOLD}${action === "generate" ? "Generating" : "Updating"} native AX Wiki…${UI.Style.TEXT_NORMAL}`,
    )
    UI.println(`  root:  ${root}`)
    UI.println(`  dir:   ${config.dir}/`)
    UI.println(`  model: ${config.model ?? "AX Code default"}`)
    const started = Date.now()
    const result = await runNativeWiki({
      root,
      action,
      dir: config.dir,
      model: config.model,
      force: args.force === true,
      onProgress: args.quiet
        ? undefined
        : (progress) => {
            if (progress.type === "discover") UI.println(`  discovered ${progress.sourceCount} source files`)
            else if (progress.type === "plan") UI.println(`  planned ${progress.pageCount} pages`)
            else if (progress.type === "page_start")
              UI.println(`  [${progress.index}/${progress.total}] ${progress.path}`)
            else if (progress.type === "validate") UI.println(`  validation issues: ${progress.issueCount}`)
          },
    })
    if (args["skip-agents"] !== true && config.autoInjectAgents) {
      const agents = await ensureAgentsWikiPointers(root, { wikiDir: config.dir, touchClaudeMd: config.touchClaudeMd })
      if (agents.updated.length) UI.println(`  agent pointers: ${agents.updated.join(", ")}`)
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    UI.println(
      `AX Wiki ${action} completed in ${seconds}s: ${result.generatedPages.length} generated, ${result.unchangedPages.length} unchanged, ${result.removedPages.length} removed.`,
    )
  })
}

function generationOptions(yargs: Argv) {
  return commonOptions(yargs)
    .option("model", modelOption)
    .option("force", { type: "boolean", default: false, describe: "replace manually modified generated content" })
    .option("skip-agents", { type: "boolean", default: false, describe: "do not update AGENTS.md pointers" })
    .option("quiet", { type: "boolean", default: false, describe: "hide per-page progress" })
}

export const WikiGenerateCommand = cmd({
  command: "generate",
  describe: "compile a complete source-backed AX Wiki with the AX Code model provider",
  builder: generationOptions,
  handler: async (args) => runGenerateOrUpdate("generate", args),
})

export const WikiUpdateCommand = cmd({
  command: "update",
  describe: "incrementally regenerate pages affected by source changes",
  builder: generationOptions,
  handler: async (args) => runGenerateOrUpdate("update", args),
})

export const WikiLintCommand = cmd({
  command: "lint",
  describe: "validate generated pages, source citations, links, and freshness",
  builder: (yargs: Argv) =>
    commonOptions(yargs).option("json", { type: "boolean", default: false, describe: "machine-readable JSON" }),
  handler: async (args) => {
    await withWiki(args, async ({ root, config }) => {
      const report = await lintWiki({
        root,
        wikiDir: config.dir,
        repositoryHead: await gitHeadCommit(root),
        config: engineConfig(config),
      })
      if (args.json) console.log(JSON.stringify(report, null, 2))
      else {
        UI.println(`${UI.Style.TEXT_INFO_BOLD}AX Wiki lint${UI.Style.TEXT_NORMAL}`)
        UI.println(`  wiki: ${report.wikiDir}/  ok: ${report.ok ? "yes" : "no"}  stale: ${report.stale ? "yes" : "no"}`)
        UI.println(
          `  pages: ${report.stats.pageCount}  sources: ${report.stats.sourceCount}  symbols: ${report.stats.symbolCount}`,
        )
        for (const issue of report.issues) UI.println(`  [${issue.level}] ${issue.code}: ${issue.message}`)
      }
      if (!report.ok || report.stale) process.exitCode = 1
    })
  },
})

export const WikiCardsCommand = cmd({
  command: "cards",
  describe: "build a compact AX Wiki card index at .ax-code/wiki-cards.md",
  builder: (yargs: Argv) =>
    commonOptions(yargs)
      .option("json", { type: "boolean", default: false, describe: "print JSON cards" })
      .option("stdout", { type: "boolean", default: false, describe: "print Markdown instead of writing" })
      .option("output", { type: "string", describe: "output path (default: .ax-code/wiki-cards.md)" }),
  handler: async (args) => {
    await withWiki(args, async ({ root, config }) => {
      const result = await buildWikiCards({ root, wikiDir: config.dir })
      if (args.json) console.log(JSON.stringify({ wiki: result.wikiDir, cards: result.cards }, null, 2))
      else if (args.stdout) process.stdout.write(result.markdown)
      else {
        const output = args.output || result.defaultOutputPath
        await writeWikiCards(output, result.markdown)
        UI.println(`Wrote ${result.cards.length} card(s) → ${output}`)
      }
    })
  },
})

export const WikiRelatedCommand = cmd({
  command: "related <symbol>",
  describe: "find AX Wiki pages by exact frontmatter symbol or text mention",
  builder: (yargs: Argv) =>
    commonOptions(yargs)
      .positional("symbol", { type: "string", demandOption: true, describe: "symbol or type name" })
      .option("json", { type: "boolean", default: false, describe: "machine-readable JSON" })
      .option("exact", { type: "boolean", default: false, describe: "disable body mention fallback" }),
  handler: async (args) => {
    const symbol = String(args.symbol ?? "").trim()
    await withWiki(args, async ({ root, config }) => {
      const result = await relatedWikiPages({ root, symbol, wikiDir: config.dir, mentionFallback: args.exact !== true })
      if (args.json) console.log(JSON.stringify(result, null, 2))
      else {
        UI.println(`${UI.Style.TEXT_INFO_BOLD}AX Wiki related: ${result.symbol}${UI.Style.TEXT_NORMAL}`)
        for (const match of result.matches) {
          UI.println(`  - [${match.via}] ${match.title} (${match.path})`)
          if (match.summary) UI.println(`      ${match.summary}`)
        }
        if (!result.matches.length) {
          UI.println("  No matching wiki pages; use code_intelligence for structural lookup.")
          process.exitCode = 1
        }
      }
    })
  },
})

export const WikiCommand = cmd({
  command: "wiki",
  describe: "native source-backed AX Wiki — complementary to ax-code index",
  builder: (yargs) =>
    yargs
      .command(WikiStatusCommand)
      .command(WikiDoctorCommand)
      .command(WikiPlanCommand)
      .command(WikiEnsureAgentsCommand)
      .command(WikiGenerateCommand)
      .command(WikiUpdateCommand)
      .command(WikiLintCommand)
      .command(WikiCardsCommand)
      .command(WikiRelatedCommand)
      .demandCommand(),
  async handler() {},
})
