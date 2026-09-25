import path from "node:path"
import { realpathSync } from "node:fs"
import { asRecordOrUndefined } from "../util/record"
import { MUTATION_TOOLS } from "../tool/mutation-tools"
import type { GoalVerification } from "./goal-verification"

// Resolve existing ancestors so deleted/moved files retain their workspace
// identity across root aliases (for example /tmp and /private/tmp on macOS).
function canonicalLocation(file: string): string {
  try {
    return realpathSync.native(file)
  } catch {
    const parent = path.dirname(file)
    return parent === file ? file : path.join(canonicalLocation(parent), path.basename(file))
  }
}

function contained(relative: string) {
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)
}

// The frozen paths describe planned inputs. Successful file-tool results also
// identify inputs changed during this goal; include them in receipt freshness
// without rewriting the contract or claiming that its tests cover those files.
export function goalSourceScope(input: {
  cwd: string
  created: number
  sourcePaths: readonly string[]
  messages: readonly GoalVerification.Message[]
}) {
  const paths = new Set(input.sourcePaths)
  const additional = new Set<string>()
  const external = new Set<string>()
  const root = path.resolve(input.cwd)
  const canonicalRoot = canonicalLocation(root)
  const scopes = input.sourcePaths.map((file) => path.resolve(root, file))
  const add = (value: unknown) => {
    if (typeof value !== "string" || !path.isAbsolute(value)) return
    let absolute = path.resolve(value)
    let local = path.relative(root, absolute)
    if (!contained(local)) {
      local = path.relative(canonicalRoot, canonicalLocation(absolute))
      if (!contained(local)) {
        external.add(value)
        return
      }
      absolute = path.resolve(root, local)
    }
    // Keep lexical paths already inside the root: the fingerprint reader owns
    // symlink admission and must still reject escaping links.
    const relative = local.split(path.sep).join("/")
    // Runtime goal storage is mutable control state, never source evidence.
    if (relative === ".ax-code/goals" || relative.startsWith(".ax-code/goals/")) return
    if (scopes.some((scope) => absolute === scope || absolute.startsWith(scope + path.sep))) return
    paths.add(relative)
    additional.add(relative)
  }
  for (const message of input.messages) {
    if (message.info?.role !== "assistant") continue
    for (const part of message.parts ?? []) {
      const record = asRecordOrUndefined(part)
      if (record?.type !== "tool" || !MUTATION_TOOLS.has(String(record.tool))) continue
      const state = asRecordOrUndefined(record.state)
      if (state?.status !== "completed") continue
      // A tool can finish after goal creation within a message that started
      // earlier (for example, create_goal followed by edit in the same turn).
      const ended = asRecordOrUndefined(state.time)?.end
      const changedAt = typeof ended === "number" && Number.isFinite(ended) ? ended : message.info.time?.created
      if (typeof changedAt === "number" && changedAt < input.created) continue
      const metadata = asRecordOrUndefined(state.metadata)
      add(metadata?.filepath)
      add(asRecordOrUndefined(metadata?.filediff)?.file)
      // NotebookEditTool's input is `notebook_path`, which is not one of the
      // message-level path aliases, so its changed notebook is otherwise never
      // attributed to this goal's source scope.
      if (record.tool === "notebook_edit") {
        add(asRecordOrUndefined(state.input)?.notebook_path)
        add(metadata?.notebook_path)
      }
      // MultiEditTool returns each executed edit's metadata in results, rather
      // than a top-level filediff. Do not infer changed paths from tool inputs.
      if (record.tool === "multiedit" && Array.isArray(metadata?.results)) {
        for (const result of metadata.results) {
          const entry = asRecordOrUndefined(result)
          add(entry?.filepath)
          add(asRecordOrUndefined(entry?.filediff)?.file)
        }
      }
      if (Array.isArray(metadata?.files)) {
        for (const entry of metadata.files) {
          const file = asRecordOrUndefined(entry)
          add(file?.filePath)
          add(file?.movePath)
        }
      }
      // RefactorApplyTool reports applied paths as a flat string array (both at
      // the top level and inside its result), not as filePath records.
      if (record.tool === "refactor_apply") {
        if (Array.isArray(metadata?.filesChanged)) {
          for (const file of metadata.filesChanged) add(file)
        }
        const result = asRecordOrUndefined(metadata?.result)
        if (Array.isArray(result?.filesChanged)) {
          for (const file of result.filesChanged) add(file)
        }
      }
    }
  }
  return { paths: [...paths].sort(), additional: [...additional].sort(), external: [...external].sort() }
}

export function goalSourceScopeNotice(additional: readonly string[], external: readonly string[] = []) {
  const outside = external.length
    ? `File tools also changed ${external.length} path(s) outside this workspace. Their content is not fingerprinted by this goal; use project-owned checks for any required external state.`
    : ""
  if (!additional.length) return outside || undefined
  return (
    `Files changed by this goal outside declared sourcePaths are included in receipt freshness: ${additional.slice(0, 10).join(", ")}` +
    (additional.length > 10 ? ` (and ${additional.length - 10} more)` : "") +
    `. This does not prove the frozen checks exercise them. Run regressions for the actual changed sources and tests; ` +
    `if the frozen checks omit required coverage, request /goal revise before claiming completion. Do not edit the frozen contract. ${outside}`.trim()
  )
}
