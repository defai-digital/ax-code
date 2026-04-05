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
        await CodeIntelligence.indexFiles(projectID, files, args.concurrency)
        const elapsed = Date.now() - start

        const status = CodeIntelligence.status(projectID)
        UI.println("")
        UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}Indexing complete${UI.Style.TEXT_NORMAL}`)
        UI.println(`  nodes:     ${status.nodeCount}`)
        UI.println(`  edges:     ${status.edgeCount}`)
        UI.println(`  elapsed:   ${elapsed}ms`)
      },
    })
  },
})
