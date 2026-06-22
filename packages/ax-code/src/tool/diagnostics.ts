import { LSP } from "../lsp"
import { Filesystem } from "../util/filesystem"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { MAX_DIAGNOSTICS_PER_FILE, MAX_PROJECT_DIAGNOSTICS_FILES } from "@/constants/tool"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { DiagnosticCorrelation, prewarmAffectedFiles } from "@/debug-engine"
import { DebugEngine } from "@/debug-engine"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "tool.diagnostics" })

// Maximum correlation hints per file in the rendered output.
const MAX_CORRELATIONS_IN_OUTPUT = 5

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
 *
 * When the DRE flag is enabled, also runs cross-file diagnostic correlation
 * and impact-driven LSP prewarming to enrich the agent feedback.
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

  // DRE integration: run correlation and prewarming when the flag is on.
  // Both are best-effort — failures are logged but never block the tool.
  let correlationMap: Map<string, DebugEngine.CorrelatedDiagnostic[]> | undefined
  if (Flag.AX_CODE_EXPERIMENTAL_DEBUG_ENGINE) {
    try {
      correlationMap = await runCorrelationAndPrewarm(uniqueFiles, diagnostics)
    } catch (err) {
      log.warn("DRE correlation/prewarm failed", { error: err })
    }
  }

  return {
    diagnostics,
    output: renderDiagnostics(diagnostics, files, options, correlationMap),
  }
}

/**
 * Render LSP diagnostic errors for changed files.
 * Shared across edit, write, and apply_patch tools.
 *
 * When correlation data is available, appends cross-file root-cause hints
 * inside a <correlation> block within the diagnostics XML.
 */
export function renderDiagnostics(
  diagnostics: Awaited<ReturnType<typeof LSP.diagnostics>>,
  files: string[],
  options?: { includeProjectDiagnostics?: boolean },
  correlationMap?: Map<string, DebugEngine.CorrelatedDiagnostic[]>,
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

    // Render correlation hints for this file.
    const correlationBlock = renderCorrelationBlock(file, correlationMap)

    if (normalizedFiles.has(file)) {
      output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>${correlationBlock}`
    } else if (options?.includeProjectDiagnostics && projectDiagnosticsCount < MAX_PROJECT_DIAGNOSTICS_FILES) {
      projectDiagnosticsCount++
      output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>${correlationBlock}`
    }
  }

  return output
}

// ─── Internal helpers ─────────────────────────────────────────────────

function renderCorrelationBlock(
  file: string,
  correlationMap?: Map<string, DebugEngine.CorrelatedDiagnostic[]>,
): string {
  if (!correlationMap) return ""
  const correlations = correlationMap.get(file)
  if (!correlations || correlations.length === 0) return ""

  const withRootCause = correlations
    .filter((c) => c.rootCauseFile !== null && c.confidence !== "low")
    .slice(0, MAX_CORRELATIONS_IN_OUTPUT)
  if (withRootCause.length === 0) return ""

  const lines = withRootCause.map((c) => {
    const chain = c.rootCauseChain.length > 1 ? ` via ${c.rootCauseChain.slice(1).join(" -> ")}` : ""
    return `  Line ${c.line}: Possible root cause in ${c.rootCauseFile} (${c.rootCauseSymbol}${chain}, confidence: ${c.confidence})`
  })

  return `\n<correlation file="${file}">\n${lines.join("\n")}\n</correlation>`
}

async function runCorrelationAndPrewarm(
  editedFiles: string[],
  diagnostics: Record<string, import("../lsp/client").LSPClient.Diagnostic[]>,
): Promise<Map<string, DebugEngine.CorrelatedDiagnostic[]>> {
  const correlationMap = new Map<string, DebugEngine.CorrelatedDiagnostic[]>()

  // Run correlation for each edited file that has errors.
  const filesWithErrors = editedFiles.filter((file) => {
    const issues = diagnostics[file]
    return issues?.some((d) => d.severity === 1)
  })

  const correlationResults = await Promise.allSettled(
    filesWithErrors.map(async (file) => {
      const correlations = await DiagnosticCorrelation.correlateNow(file)
      correlationMap.set(file, correlations)
    }),
  )
  for (const result of correlationResults) {
    if (result.status === "rejected") {
      log.warn("correlation failed for file", { error: result.reason })
    }
  }

  // Impact-driven prewarming: if any edited file has errors, run a quick
  // impact analysis to prewarm LSP for downstream files. This makes the
  // NEXT edit cycle faster.
  try {
    const projectID = Instance.project.id
    const impact = await DebugEngine.analyzeImpact(projectID, {
      changes: editedFiles.map((f) => ({ kind: "file" as const, path: f })),
      depth: 2,
      maxVisited: 100,
    })
    if (impact.affectedFiles.length > 0) {
      await prewarmAffectedFiles(impact)
    }
  } catch (err) {
    log.warn("impact-driven prewarm failed", { error: err })
  }

  return correlationMap
}
