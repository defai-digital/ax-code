export const INTERNAL_ONLY_ROOTS = [".internal"] as const

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
