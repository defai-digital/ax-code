import { LSP } from "../lsp"
import { Filesystem } from "../util/filesystem"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { MAX_DIAGNOSTICS_PER_FILE, MAX_PROJECT_DIAGNOSTICS_FILES } from "@/constants/tool"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool.diagnostics" })

/**
 * Publish file edit + watcher events. Shared across edit, write, and apply_patch.
 */
export async function notifyFileEdited(file: string, event: "change" | "add") {
  await Bus.publish(File.Event.Edited, { file })
  await Bus.publish(FileWatcher.Event.Updated, { file, event })
}

/**
 * Touch files with LSP, collect diagnostics, and render output string.
 * Shared across edit, write, and apply_patch.
 */
export async function collectDiagnostics(files: string[], options?: { includeProjectDiagnostics?: boolean }) {
  const uniqueFiles = [...new Set(files)]
  const touched = await Promise.allSettled(uniqueFiles.map((file) => LSP.touchFile(file, false)))
  for (let index = 0; index < touched.length; index++) {
    const result = touched[index]
    if (result?.status !== "rejected") continue
    log.warn("failed to warm LSP before collecting diagnostics", {
      file: uniqueFiles[index],
      error: result.reason,
    })
  }
  const diagnostics = await LSP.diagnostics()
  return { diagnostics, output: renderDiagnostics(diagnostics, files, options) }
}

/**
 * Render LSP diagnostic errors for changed files.
 * Shared across edit, write, and apply_patch tools.
 */
export function renderDiagnostics(
  diagnostics: Awaited<ReturnType<typeof LSP.diagnostics>>,
  files: string[],
  options?: { includeProjectDiagnostics?: boolean },
): string {
  let output = ""
  const normalizedFiles = new Set(files.map(Filesystem.normalizePath))
  let projectDiagnosticsCount = 0

  for (const [file, issues] of Object.entries(diagnostics)) {
    const errors = issues.filter((item) => item.severity === 1)
    if (errors.length === 0) continue

    const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    const suffix =
      errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""

    if (normalizedFiles.has(file)) {
      output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    } else if (options?.includeProjectDiagnostics && projectDiagnosticsCount < MAX_PROJECT_DIAGNOSTICS_FILES) {
      projectDiagnosticsCount++
      output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }
  }

  return output
}
