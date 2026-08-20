export const INTERNAL_ONLY_ROOTS = [".internal"] as const

// These architecture records were explicitly approved for version control.
// Keep this list exact: every other `.internal` file remains local-only.
export const APPROVED_TRACKED_INTERNAL_FILES = [
  ".internal/adr/ADR-058-ax-code-tui.md",
  ".internal/prd/PRD-2026-08-20-ax-code-tui.md",
  ".internal/reports/planning/ax-code-tui/REFERENCE-REVIEW.md",
  ".internal/reports/planning/ax-code-tui/TECH-SPEC.md",
  ".internal/reports/planning/ax-code-tui/reviews/minimax-m3-review.md",
  ".internal/reports/planning/ax-code-tui/reviews/qwen-3.8-max-qa.md",
] as const

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
