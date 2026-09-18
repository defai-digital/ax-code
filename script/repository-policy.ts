export const INTERNAL_ONLY_ROOTS = [".internal"] as const

// Root-level agent-instruction files that are local-only: they hold private
// project memory and must never be committed or pushed to GitHub. Matched as
// exact root pathspecs, so nested fixtures such as
// `packages/ax-code/test/AGENTS.md` stay trackable.
export const LOCAL_ONLY_ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"] as const

// Every local-only pathspec, in the exact order both the pre-commit hook and
// script/check-tracked-internal.ts must use. Single source of truth so the two
// guards cannot drift apart.
export const LOCAL_ONLY_PATHSPECS = [...INTERNAL_ONLY_ROOTS, ...LOCAL_ONLY_ROOT_FILES].join(" ")

// Accidental local dumps that GitHub secret scanning has already flagged in
// history as generic "passwords". They are branded SessionIDs, not credentials,
// but they must never be re-committed. ax-code.json is user runtime config.
export const LOCAL_DUMP_PATHSPECS = [
  ":(glob)session-ses_*.md",
  ":(glob)**/session-ses_*.md",
  "ax-code.json",
  ":(glob)**/ax-code.json",
] as const

export function isLocalDumpPath(file: string) {
  const normalized = normalizeRepositoryPath(file)
  if (/(^|\/)session-ses_[^/]+\.md$/i.test(normalized)) return true
  const base = normalized.split("/").pop() ?? normalized
  return base === "ax-code.json"
}

// Empty on purpose: nothing under `.internal/` may be tracked or published.
export const APPROVED_TRACKED_INTERNAL_FILES = [] as const

function normalizeRepositoryPath(file: string) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "")
}

const approvedTrackedInternalFiles = new Set<string>(APPROVED_TRACKED_INTERNAL_FILES)

export function isApprovedTrackedInternalPath(file: string) {
  return approvedTrackedInternalFiles.has(normalizeRepositoryPath(file))
}

export function unapprovedTrackedInternalPaths(files: readonly string[]) {
  return files.filter((file) => !isApprovedTrackedInternalPath(file))
}

export function isInternalOnlyPath(file: string) {
  const normalized = normalizeRepositoryPath(file)
  return INTERNAL_ONLY_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}
