import type { Argv } from "yargs"
import path from "path"
import { Instance } from "../../project/instance"
import { CodeIntelligence } from "../../code-intelligence"
import { CodeGraphBuilder } from "../../code-intelligence/builder"
import { CodeGraphQuery } from "../../code-intelligence/query"
import { AutoIndex } from "../../code-intelligence/auto-index"
import { Ripgrep } from "../../file/ripgrep"
import { LANGUAGE_EXTENSIONS } from "../../lsp/language"
import { LSP } from "../../lsp"
import {
  INDEXER_SEMANTIC_METHODS,
  INDEX_PREWARM_MAX_FILES,
  INDEX_PREWARM_MAX_LANGUAGES,
} from "../../lsp/prewarm-profile"
import { NativePerf } from "../../perf/native"
import type { NativePerfSnapshot } from "../../perf/native"
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

export function isIndexableFile(file: string): boolean {
  const ext = path.extname(file)
  const lang = LANGUAGE_EXTENSIONS[ext]
  return lang !== undefined && lang !== "plaintext"
}

// Group a file list by detected LSP language. Files whose extension
// doesn't map to an LSP language are grouped under "unknown" and
// filtered out by the caller. Exported for the unit test.
export function groupFilesByLanguage(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const file of files) {
    const ext = path.extname(file)
    const lang = LANGUAGE_EXTENSIONS[ext] ?? "unknown"
    const bucket = groups.get(lang) ?? []
    bucket.push(file)
    groups.set(lang, bucket)
  }
  return groups
}

type Phase = {
  name: string
  ms: number
  pct: number
}

type Probe = {
  ready: string[]
  missing: Record<string, number>
}

type Report = {
  projectID: string
  directory: string
  worktree: string
  requested: {
    concurrency: number
    limit?: number
    probe: boolean
    nativeProfile: boolean
  }
  files: {
    discovered: number
  }
  graph: {
    nodes: number
    edges: number
  }
  run: {
    nodes: number
    edges: number
    indexed: number
    unchanged: number
    skipped: number
    failed: number
    pruned: { files: number; nodes: number; edges: number }
    elapsedMs: number
  }
  timings: {
    totalMs: number
    phases: Phase[]
  }
  probe?: Probe
  native?: NativePerfSnapshot
  lspPerf?: Record<string, LSP.PerfRow>
}

function zero(): CodeGraphBuilder.IndexFilesResult {
  return {
    nodes: 0,
    edges: 0,
    files: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    pruned: { files: 0, nodes: 0, edges: 0 },
    timings: {
      readFile: 0,
      lspTouch: 0,
      lspDocumentSymbol: 0,
      symbolWalk: 0,
      lspReferences: 0,
      edgeResolve: 0,
      dbTransaction: 0,
      total: 0,
    },
  }
}

export function phaseRows(input: CodeGraphBuilder.IndexTimings): Phase[] {
  const total = input.total
  const pct = (ms: number) => (total > 0 ? Number(((ms / total) * 100).toFixed(1)) : 0)

  return [
    { name: "lsp.references", ms: input.lspReferences, pct: pct(input.lspReferences) },
    { name: "lsp.documentSymbol", ms: input.lspDocumentSymbol, pct: pct(input.lspDocumentSymbol) },
    { name: "lsp.touch", ms: input.lspTouch, pct: pct(input.lspTouch) },
    { name: "edge.resolve", ms: input.edgeResolve, pct: pct(input.edgeResolve) },
    { name: "db.transaction", ms: input.dbTransaction, pct: pct(input.dbTransaction) },
    { name: "symbol.walk", ms: input.symbolWalk, pct: pct(input.symbolWalk) },
    { name: "file.read", ms: input.readFile, pct: pct(input.readFile) },
  ]
}

export function buildIndexReport(input: {
  projectID: string
  directory: string
  worktree: string
  concurrency: number
  limit?: number
  probe: boolean
  nativeProfile: boolean
  files: number
  status: { nodeCount: number; edgeCount: number }
  result: CodeGraphBuilder.IndexFilesResult
  elapsedMs: number
  probeResult?: Probe
  native?: NativePerfSnapshot
  lspPerf?: Record<string, LSP.PerfRow>
}): Report {
  return {
    projectID: input.projectID,
    directory: input.directory,
    worktree: input.worktree,
    requested: {
      concurrency: input.concurrency,
      limit: input.limit,
      probe: input.probe,
      nativeProfile: input.nativeProfile,
    },
    files: {
      discovered: input.files,
    },
    graph: {
      nodes: input.status.nodeCount,
      edges: input.status.edgeCount,
    },
    run: {
      nodes: input.result.nodes,
      edges: input.result.edges,
      indexed: input.result.files,
      unchanged: input.result.unchanged,
      skipped: input.result.skipped,
      failed: input.result.failed,
      pruned: input.result.pruned,
      elapsedMs: input.elapsedMs,
    },
    timings: {
      totalMs: input.result.timings.total,
      phases: phaseRows(input.result.timings),
    },
    probe: input.probeResult,
    native: input.native,
    lspPerf: input.lspPerf,
  }
}

// Probe LSP availability for each language present in the project.
// For each language with at least one file, we pick a representative
// file and call LSP.touchFile to force the server to spawn. Then we
// call LSP.status() to see which servers are actually connected.
//
// This is the pre-flight check users needed in v2.3.12: the earlier
// flow silently produced `nodes=0` when an LSP server couldn't spawn,
// leaving users with no diagnostic. Now we print a readiness table
// before the batch so missing LSPs are visible upfront.
//
// Returns the set of languages that have at least one connected
// server. The CLI uses this to decide whether to warn the user that
// a subset of their project won't be indexed.
export async function probeLspServers(
  groups: Map<string, string[]>,
): Promise<{ ready: Set<string>; missing: Map<string, number> }> {
  const ready = new Set<string>()
  const missing = new Map<string, number>()
  const probes = [...groups.entries()]
    .filter(([lang]) => lang !== "unknown" && lang !== "plaintext")
    .map(async ([lang, files]) => {
      const first = files[0]
      if (!first) return undefined

      // Parallel probe: touchFile already deduplicates shared cold starts
      // via the LSP spawning registry, so serializing by language only
      // inflates cold index startup on polyglot projects.
      const opened = await LSP.touchFile(first, false, {
        mode: "semantic",
        methods: [...INDEXER_SEMANTIC_METHODS],
      }).catch(() => 0)

      return { lang, fileCount: files.length, opened }
    })

  // Read the set of connected clients. Each client has a `root` and a
  // list of extensions it serves. We don't get the language name
  // directly from status(), so we cross-reference by checking which
  // of our groups have a client whose root matches any file's
  // directory prefix. In practice ax-code's clients are all rooted at
  // Instance.directory so a simpler check works: if status() returns
  // a client at all and its extensions include an extension present
  // in the group, mark the language ready.
  const statuses = await LSP.status().catch(() => [])
  for (const probe of await Promise.all(probes)) {
    if (!probe) continue
    // Use the observed touch result rather than hasClients(). The
    // latter is intentionally optimistic (extension + root match),
    // while the probe wants actual readiness after spawn/init.
    const languageReady = probe.opened > 0
    if (languageReady) {
      ready.add(probe.lang)
    } else {
      missing.set(probe.lang, probe.fileCount)
    }
  }

  // Ignore the unused `statuses` — it's captured here so a future
  // enhancement can print per-server health (root path, error state)
  // without a second round-trip. Silence the unused-variable lint.
  void statuses

  return { ready, missing }
}

// Install hints for the LSP servers most commonly missing in real
// projects. Keyed by the LSP language id (matching LANGUAGE_EXTENSIONS
// values). Covers the top ~10 most-used languages; less common ones
// fall back to a generic "check ~/.local/share/ax-code/log/" hint.
const INSTALL_HINTS: Record<string, string> = {
  typescript: "typescript-language-server is bundled with ax-code — if missing, check the log for spawn errors",
  typescriptreact: "typescript-language-server is bundled with ax-code — if missing, check the log for spawn errors",
  javascript: "typescript-language-server is bundled with ax-code — if missing, check the log for spawn errors",
  javascriptreact: "typescript-language-server is bundled with ax-code — if missing, check the log for spawn errors",
  go: "install gopls: go install golang.org/x/tools/gopls@latest",
  rust: "install rust-analyzer: rustup component add rust-analyzer",
  python: "install pyright: pip install pyright  (or enable ty with AX_CODE_EXPERIMENTAL_LSP_TY=1)",
  ruby: "install solargraph or rubocop",
  java: "JDTLS is bundled — if missing, ensure a JDK is on PATH",
  kotlin: "install kotlin-language-server",
  csharp: "install omnisharp-roslyn",
  swift: "sourcekit-lsp ships with Xcode — ensure `xcode-select --install` has been run",
  dart: "install dart SDK and dart analyzer",
  elixir: "install elixir-ls",
  zig: "install zls: https://github.com/zigtools/zls",
  haskell: "install haskell-language-server",
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
      .option("probe", {
        describe: "run an LSP pre-flight probe before indexing",
        type: "boolean",
        default: true,
      })
      .option("json", {
        describe: "output machine-readable JSON",
        type: "boolean",
        default: false,
      })
      .option("native-profile", {
        describe: "collect native bridge timings for this run",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const projectID = Instance.project.id
        const json = args.json === true
        const out = (line = "") => {
          if (!json) UI.println(line)
        }
        if (args.nativeProfile) {
          process.env.AX_CODE_PROFILE_NATIVE = "1"
          NativePerf.install()
        }

        out(`${UI.Style.TEXT_INFO_BOLD}Indexing code intelligence graph${UI.Style.TEXT_NORMAL}`)
        out(`  project:   ${projectID}`)
        out(`  directory: ${Instance.directory}`)
        out(`  worktree:  ${Instance.worktree}`)

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

        out(`  files:     ${files.length} indexable`)
        // Do NOT short-circuit when `files.length === 0`. An empty
        // walk is the exact case where orphan purge matters most: a
        // user who deleted every indexable file from a previously
        // indexed project needs us to clean up the DB, not bail out
        // leaving stale rows. We still print the "no files" warning
        // but continue into the indexer so the prune runs.
        if (files.length === 0) {
          out("")
          out(`${UI.Style.TEXT_WARNING}No indexable source files found.${UI.Style.TEXT_NORMAL}`)
          // If there are also no stored rows to clean up, there's
          // genuinely nothing to do — bail here to match the old
          // behavior for pristine projects.
          if (CodeGraphQuery.listFiles(projectID).length === 0) {
            const status = CodeIntelligence.status(projectID)
            const native = args.nativeProfile ? NativePerf.snapshot() : undefined
            if (args.nativeProfile) NativePerf.reset()
            if (json) {
              process.stdout.write(
                JSON.stringify(
                  buildIndexReport({
                    projectID,
                    directory: Instance.directory,
                    worktree: Instance.worktree,
                    concurrency: args.concurrency,
                    limit: args.limit,
                    probe: args.probe,
                    nativeProfile: args.nativeProfile,
                    files: files.length,
                    status,
                    result: zero(),
                    elapsedMs: 0,
                    native,
                  }),
                  null,
                  2,
                ) + "\n",
              )
            }
            return
          }
          out(`${UI.Style.TEXT_DIM}Reconciling graph with working tree...${UI.Style.TEXT_NORMAL}`)
        }

        // LSP pre-flight probe. Groups the candidate files by language
        // and attempts to spawn a client per language. Prints a ready/
        // missing table so users can tell upfront which slice of their
        // project will actually produce symbols. This replaces the old
        // post-run "No symbols were extracted" fallback with an
        // up-front, actionable diagnostic.
        //
        // Skippable with --no-probe for cases where the user is
        // running in a constrained env and just wants the indexer to
        // try everything.
        const groups = groupFilesByLanguage(files)
        let probeResult: Probe | undefined
        // Reset before any explicit LSP warmup/probe work so the perf
        // artifact reflects the full synchronous semantic path the user
        // paid for, not just the later indexFiles() batch.
        LSP.perfReset()
        if (files.length > 0) {
          await LSP.prewarmFiles(
            LSP.selectPrewarmFiles(files, {
              maxFiles: INDEX_PREWARM_MAX_FILES,
              maxLanguages: INDEX_PREWARM_MAX_LANGUAGES,
            }),
            {
              mode: "semantic",
              methods: [...INDEXER_SEMANTIC_METHODS],
            },
          ).catch(() => ({
            readyCount: 0,
            freshSpawnCount: 0,
          }))
        }
        // Skip the LSP probe when there are no files — nothing to
        // probe, and the "no LSP servers available" warning would be
        // misleading in a graph-reconcile-only run.
        if (args.probe && files.length > 0) {
          const probe = await probeLspServers(groups)
          probeResult = {
            ready: [...probe.ready].sort(),
            missing: Object.fromEntries([...probe.missing.entries()].sort(([a], [b]) => a.localeCompare(b))),
          }
          if (!json) {
            out("")
            out(`${UI.Style.TEXT_DIM}Probing LSP servers...${UI.Style.TEXT_NORMAL}`)
            for (const [lang, langFiles] of groups) {
              if (lang === "unknown" || lang === "plaintext") continue
              const count = langFiles.length
              if (probe.ready.has(lang)) {
                out(
                  `  ${UI.Style.TEXT_SUCCESS}✓${UI.Style.TEXT_NORMAL} ${lang} (${count} file${count === 1 ? "" : "s"})`,
                )
              } else {
                const hint = INSTALL_HINTS[lang] ?? "check ~/.local/share/ax-code/log/ for spawn errors"
                out(
                  `  ${UI.Style.TEXT_WARNING}✗${UI.Style.TEXT_NORMAL} ${lang} (${count} file${count === 1 ? "" : "s"}) — ${hint}`,
                )
              }
            }
            if (probe.ready.size === 0) {
              out("")
              out(
                `${UI.Style.TEXT_WARNING}No LSP servers are available for any language in this project.${UI.Style.TEXT_NORMAL}`,
              )
              out(`Indexing will run but is very likely to produce zero symbols. Install at least one of`)
              out(`the language servers listed above, or run with --no-probe to bypass this warning.`)
            }
            if (probe.missing.size > 0 && probe.ready.size > 0) {
              const missingFiles = [...probe.missing.values()].reduce((a, b) => a + b, 0)
              out("")
              out(
                `${UI.Style.TEXT_DIM}${missingFiles.toLocaleString()} file(s) across ${probe.missing.size} language(s) will be skipped due to missing LSP servers.${UI.Style.TEXT_NORMAL}`,
              )
            }
          }
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
        out("")
        out(
          `${UI.Style.TEXT_DIM}Indexing in progress. This takes several minutes for larger projects.${UI.Style.TEXT_NORMAL}`,
        )
        out("")

        // Transition AutoIndex state so the TUI sidebar (which polls
        // /debug-engine/pending-plans every 10s) reflects this manual
        // run as "indexing" instead of "not indexed". Without this,
        // users running `ax-code index` in a second terminal still
        // see the stale sidebar state until the run completes.
        AutoIndex.setState(projectID, {
          state: "indexing",
          completed: 0,
          total: files.length,
          startedAt: Date.now(),
          finishedAt: null,
          error: null,
        })

        // Heartbeat state. Two signals travel through here:
        //   - latestCompleted: per-file progress from the builder's
        //     `onProgress` callback. Tells the user how many files
        //     have actually finished (not batch boundaries).
        //   - lastNodeCount: prior snapshot of the live node count,
        //     used to compute the "+N interval" delta.
        //
        // Showing files N/M alongside the symbol count fixes the
        // "looks stuck" UX from the old heartbeat: when a batch of
        // files is all in LSP-references phase, no nodes are being
        // committed and "+0 interval" used to print repeatedly with
        // no other signal. Now the file counter at least moves
        // after each file commits.
        const heartbeatStart = Date.now()
        let lastNodeCount = CodeGraphQuery.countNodes(projectID)
        let latestCompleted = 0
        const heartbeat = json
          ? undefined
          : setInterval(() => {
              const current = CodeGraphQuery.countNodes(projectID)
              const delta = current - lastNodeCount
              const elapsedSec = Math.round((Date.now() - heartbeatStart) / 1000)
              out(
                `  ${UI.Style.TEXT_DIM}[${elapsedSec}s] ${latestCompleted.toLocaleString()}/${files.length.toLocaleString()} files · ${current.toLocaleString()} symbols (+${delta.toLocaleString()} interval)${UI.Style.TEXT_NORMAL}`,
              )
              lastNodeCount = current
            }, 5_000)

        const start = Date.now()
        let result: Awaited<ReturnType<typeof CodeIntelligence.indexFiles>>
        try {
          result = await CodeIntelligence.indexFiles(projectID, files, {
            concurrency: args.concurrency,
            // Block on the cross-process lock — another ax-code
            // process may be indexing the same project right now
            // and we want to queue rather than race. 30-minute
            // timeout is generous enough for the largest realistic
            // index run (any longer and the user should upgrade
            // their machine).
            lock: "acquire",
            lockTimeoutMs: 30 * 60 * 1000,
            onLockWait: () => {
              out(
                `${UI.Style.TEXT_WARNING}Another ax-code process is currently indexing this project. Waiting...${UI.Style.TEXT_NORMAL}`,
              )
            },
            onProgress: (completed, total) => {
              latestCompleted = completed
              AutoIndex.reportProgress(projectID, completed, total)
            },
            // Reconcile the graph with the working tree: delete
            // rows for files that no longer exist. Scoped to the
            // walk root (`Instance.directory`) so this can't reach
            // across sibling worktrees of a shared project id.
            //
            // Disabled when `--limit` is set: a truncated walk
            // would purge every file past the limit, which is
            // never what the user wants when benchmarking.
            pruneOrphans: args.limit === undefined,
            pruneScopePrefix: Instance.directory,
          })
        } catch (err) {
          if (heartbeat) clearInterval(heartbeat)
          AutoIndex.setState(projectID, {
            state: "failed",
            startedAt: start,
            finishedAt: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          })
          if (err instanceof CodeGraphBuilder.LockHeldError) {
            out("")
            out(
              `${UI.Style.TEXT_WARNING}Timed out waiting for another ax-code process to finish indexing.${UI.Style.TEXT_NORMAL}`,
            )
            out(
              `Retry after the other process completes, or investigate a stale lockfile under ~/.local/share/ax-code/locks/.`,
            )
            return
          }
          throw err
        }
        if (heartbeat) clearInterval(heartbeat)
        const elapsed = Date.now() - start

        const status = CodeIntelligence.status(projectID)
        const native = args.nativeProfile ? NativePerf.snapshot() : undefined
        const lspPerf = LSP.perfSnapshot()
        if (args.nativeProfile) NativePerf.reset()
        LSP.perfReset()
        // Transition to idle now that the run is over. This is the
        // signal the TUI sidebar uses to flip out of its "indexing"
        // state back to the normal "N symbols indexed" display.
        AutoIndex.setState(projectID, {
          state: "idle",
          completed: files.length,
          total: files.length,
          startedAt: start,
          finishedAt: Date.now(),
          error: null,
        })
        if (json) {
          process.stdout.write(
            JSON.stringify(
              buildIndexReport({
                projectID,
                directory: Instance.directory,
                worktree: Instance.worktree,
                concurrency: args.concurrency,
                limit: args.limit,
                probe: args.probe,
                nativeProfile: args.nativeProfile,
                files: files.length,
                status,
                result,
                elapsedMs: elapsed,
                probeResult,
                native,
                lspPerf: Object.keys(lspPerf).length > 0 ? lspPerf : undefined,
              }),
              null,
              2,
            ) + "\n",
          )
          return
        }
        out("")
        // Pick the headline wording based on whether we actually wrote
        // any nodes. "Indexing complete" with nodes=0 is confusing:
        // users can't tell whether their project has no indexable
        // symbols or LSP failed silently on every file. Distinguish
        // the empty outcome explicitly.
        if (status.nodeCount === 0) {
          out(`${UI.Style.TEXT_WARNING}Indexing finished but produced no symbols${UI.Style.TEXT_NORMAL}`)
        } else {
          out(`${UI.Style.TEXT_SUCCESS_BOLD}Indexing complete${UI.Style.TEXT_NORMAL}`)
        }
        out(`  nodes:     ${status.nodeCount.toLocaleString()}`)
        out(`  edges:     ${status.edgeCount.toLocaleString()}`)
        out(
          `  files:     ${result.files.toLocaleString()} indexed, ${result.unchanged.toLocaleString()} unchanged, ${result.skipped.toLocaleString()} skipped, ${result.failed.toLocaleString()} failed`,
        )
        if (result.pruned.files > 0) {
          out(
            `  pruned:    ${result.pruned.files.toLocaleString()} file(s) removed (${result.pruned.nodes.toLocaleString()} nodes, ${result.pruned.edges.toLocaleString()} edges)`,
          )
        }
        out(`  elapsed:   ${elapsed.toLocaleString()}ms`)

        if (result.failed > 0) {
          out("")
          out(
            `${UI.Style.TEXT_WARNING}${result.failed} file(s) failed to index.${UI.Style.TEXT_NORMAL} Check the log file for details.`,
          )
        }
        if (status.nodeCount === 0 && files.length > 0) {
          // Graph is empty despite having candidate files — the most
          // common cause is LSP servers failing to spawn (missing
          // language runtime, unsupported language version) or
          // returning no document symbols. Point users at the log.
          out("")
          out(`${UI.Style.TEXT_WARNING}No symbols were extracted.${UI.Style.TEXT_NORMAL} Common causes:`)
          out(`  • LSP server for the project's language failed to spawn (check the log)`)
          out(`  • Project contains only unsupported file types`)
          out(`  • Files are empty or contain no top-level symbols`)
          out(`  • Re-run with --probe (default on) to see which languages lacked a server`)
        }

        // Per-phase breakdown — aggregated wall-clock across all files.
        // Since files run in parallel (concurrency jobs at a time) the
        // sum over-counts by up to a factor of `concurrency`. Ratios
        // between phases are what matter for identifying bottlenecks.
        const t = result.timings
        const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`
        const pct = (ms: number) => (t.total > 0 ? ` (${((ms / t.total) * 100).toFixed(1)}%)` : "")
        out("")
        out(`  phase breakdown (parallel, ratios matter more than absolutes):`)
        out(`    lsp.references:     ${fmt(t.lspReferences).padStart(8)}${pct(t.lspReferences)}`)
        out(`    lsp.documentSymbol: ${fmt(t.lspDocumentSymbol).padStart(8)}${pct(t.lspDocumentSymbol)}`)
        out(`    lsp.touch:          ${fmt(t.lspTouch).padStart(8)}${pct(t.lspTouch)}`)
        out(`    edge.resolve:       ${fmt(t.edgeResolve).padStart(8)}${pct(t.edgeResolve)}`)
        out(`    db.transaction:     ${fmt(t.dbTransaction).padStart(8)}${pct(t.dbTransaction)}`)
        out(`    symbol.walk:        ${fmt(t.symbolWalk).padStart(8)}${pct(t.symbolWalk)}`)
        out(`    file.read:          ${fmt(t.readFile).padStart(8)}${pct(t.readFile)}`)
        const profile = native ? NativePerf.render(native) : ""
        if (profile) {
          out("")
          process.stdout.write(profile + "\n")
        }

        // Prior releases showed a "restart your TUI" hint here because
        // the sidebar's `/debug-engine/pending-plans` endpoint read
        // node counts from the cached `code_index_cursor` row, which
        // was only updated at the end of a full indexing run. The
        // fix in `code-intelligence/index.ts:status()` (v2.3.11)
        // makes that endpoint compute counts live via `countNodes`,
        // so a running TUI picks up the new graph on its next poll
        // automatically — no restart needed.
      },
    })
  },
})
