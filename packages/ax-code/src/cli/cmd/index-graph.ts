import type { Argv } from "yargs"
import path from "path"
import { Instance } from "../../project/instance"
import { CodeIntelligence } from "../../code-intelligence"
import { Ripgrep } from "../../file/ripgrep"
import { LANGUAGE_EXTENSIONS } from "../../lsp/language"
import { UI } from "../ui"
import { cmd } from "./cmd"

// Initial population command for the v3 Code Intelligence graph.
//
// Users who enable AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE start with an
// empty graph — every query returns "No symbols" until indexing runs.
// This command walks the project's source files (via ripgrep, so
// .gitignore is respected) and calls CodeIntelligence.indexFiles to
// hydrate the graph in one pass. After this, the file watcher keeps
// it up to date on its own.

function isIndexableFile(file: string): boolean {
  const ext = path.extname(file)
  const lang = LANGUAGE_EXTENSIONS[ext]
  return lang !== undefined && lang !== "plaintext"
}

export const IndexCommand = cmd({
  command: "index",
  describe: "populate the Code Intelligence graph for this project",
  builder: (yargs: Argv) => {
    return yargs
      .option("concurrency", {
        describe: "max concurrent LSP indexing jobs",
        type: "number",
        default: 4,
      })
      .option("limit", {
        describe: "cap the number of files to index (for benchmarking)",
        type: "number",
      })
  },
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const projectID = Instance.project.id

        UI.println(`${UI.Style.TEXT_INFO_BOLD}Indexing code intelligence graph${UI.Style.TEXT_NORMAL}`)
        UI.println(`  project:   ${projectID}`)
        UI.println(`  directory: ${Instance.directory}`)
        UI.println(`  worktree:  ${Instance.worktree}`)

        // Collect eligible files first so we can report progress and
        // honor --limit. The walker is cheap relative to the indexer,
        // so doing this upfront costs little and makes the progress
        // output accurate.
        const files: string[] = []
        for await (const rel of Ripgrep.files({ cwd: Instance.directory })) {
          const abs = path.join(Instance.directory, rel)
          if (!isIndexableFile(abs)) continue
          files.push(abs)
          if (args.limit !== undefined && files.length >= args.limit) break
        }

        UI.println(`  files:     ${files.length} indexable`)
        if (files.length === 0) {
          UI.println("")
          UI.println(`${UI.Style.TEXT_WARNING}No indexable source files found.${UI.Style.TEXT_NORMAL}`)
          return
        }

        const start = Date.now()
        const result = await CodeIntelligence.indexFiles(projectID, files, args.concurrency)
        const elapsed = Date.now() - start

        const status = CodeIntelligence.status(projectID)
        UI.println("")
        UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}Indexing complete${UI.Style.TEXT_NORMAL}`)
        UI.println(`  nodes:     ${status.nodeCount}`)
        UI.println(`  edges:     ${status.edgeCount}`)
        UI.println(`  elapsed:   ${elapsed}ms`)

        // Per-phase breakdown — aggregated wall-clock across all files.
        // Since files run in parallel (concurrency jobs at a time) the
        // sum over-counts by up to a factor of `concurrency`. Ratios
        // between phases are what matter for identifying bottlenecks.
        const t = result.timings
        const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`
        const pct = (ms: number) => (t.total > 0 ? ` (${((ms / t.total) * 100).toFixed(1)}%)` : "")
        UI.println("")
        UI.println(`  phase breakdown (parallel, ratios matter more than absolutes):`)
        UI.println(`    lsp.references:     ${fmt(t.lspReferences).padStart(8)}${pct(t.lspReferences)}`)
        UI.println(`    lsp.documentSymbol: ${fmt(t.lspDocumentSymbol).padStart(8)}${pct(t.lspDocumentSymbol)}`)
        UI.println(`    lsp.touch:          ${fmt(t.lspTouch).padStart(8)}${pct(t.lspTouch)}`)
        UI.println(`    edge.resolve:       ${fmt(t.edgeResolve).padStart(8)}${pct(t.edgeResolve)}`)
        UI.println(`    db.transaction:     ${fmt(t.dbTransaction).padStart(8)}${pct(t.dbTransaction)}`)
        UI.println(`    symbol.walk:        ${fmt(t.symbolWalk).padStart(8)}${pct(t.symbolWalk)}`)
        UI.println(`    file.read:          ${fmt(t.readFile).padStart(8)}${pct(t.readFile)}`)
      },
    })
  },
})
