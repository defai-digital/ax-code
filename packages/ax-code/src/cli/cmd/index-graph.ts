import type { Argv } from "yargs"
import path from "path"
import { Instance } from "../../project/instance"
import { CodeIntelligence } from "../../code-intelligence"
import { CodeGraphQuery } from "../../code-intelligence/query"
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

        // Progress heartbeat. LSP-driven indexing for a medium codebase
        // (~600 files) takes several minutes and this command prints
        // nothing between "files: N indexable" and "Indexing complete"
        // by default. That looks identical to a hang, and users
        // Ctrl-C out of the command in the middle of indexing, leaving
        // the graph half-populated. The timer below polls the LIVE
        // node count (`CodeGraphQuery.countNodes`) every 5 seconds and
        // prints a delta so it's obvious work is happening.
        //
        // v2.3.9 fix: the earlier heartbeat (v2.3.7–v2.3.8) read
        // `CodeIntelligence.status().nodeCount`, which returns the
        // cached `code_index_cursor.node_count` summary row. That row
        // is only updated at the END of `indexFiles()` (see
        // `builder.ts:upsertCursor` call after the batch loop), so
        // during a live indexing run the cursor holds the previous
        // batch's final count and the heartbeat printed "+0 this
        // interval" for the entire run — the exact UX problem the
        // heartbeat was supposed to fix. `countNodes` runs a real
        // `SELECT COUNT(*)` against `code_node` so it reflects rows
        // inserted by the in-progress batch in real time.
        UI.println("")
        UI.println(`${UI.Style.TEXT_DIM}Indexing in progress. This takes several minutes for larger projects.${UI.Style.TEXT_NORMAL}`)
        UI.println("")
        const heartbeatStart = Date.now()
        let lastNodeCount = CodeGraphQuery.countNodes(projectID)
        const heartbeat = setInterval(() => {
          const current = CodeGraphQuery.countNodes(projectID)
          const delta = current - lastNodeCount
          const elapsedSec = Math.round((Date.now() - heartbeatStart) / 1000)
          UI.println(
            `  ${UI.Style.TEXT_DIM}[${elapsedSec}s] ${current.toLocaleString()} symbols indexed (+${delta.toLocaleString()} this interval)${UI.Style.TEXT_NORMAL}`,
          )
          lastNodeCount = current
        }, 5_000)

        const start = Date.now()
        let result: Awaited<ReturnType<typeof CodeIntelligence.indexFiles>>
        try {
          result = await CodeIntelligence.indexFiles(projectID, files, args.concurrency)
        } finally {
          clearInterval(heartbeat)
        }
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

        // Running TUI / server sessions read the graph through an
        // in-process cache of the last poll. They will NOT pick up
        // the freshly-indexed data until their next poll cycle, and
        // in practice users who index in one terminal while a TUI
        // is open in another see stale "graph not indexed" output
        // in the sidebar for minutes afterwards. Point this out
        // explicitly so the next step is obvious.
        UI.println("")
        UI.println(
          `${UI.Style.TEXT_DIM}If you have an ax-code TUI session open, restart it to pick up the new graph.${UI.Style.TEXT_NORMAL}`,
        )
      },
    })
  },
})
