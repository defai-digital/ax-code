import { LSP } from "../lsp"
import { Filesystem } from "../util/filesystem"
import { MAX_DIAGNOSTICS_PER_FILE, MAX_PROJECT_DIAGNOSTICS_FILES } from "./constants"

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
