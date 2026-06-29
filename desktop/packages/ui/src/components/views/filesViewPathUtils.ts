import { projectPathMatchesRoot } from "@/lib/projectResolution"

export const normalizeFilesViewPath = (value: string): string => {
  if (!value) return ""

  const raw = value.replace(/\\/g, "/")
  const hadUncPrefix = raw.startsWith("//")

  let normalized = raw.replace(/\/+/g, "/")
  if (hadUncPrefix && !normalized.startsWith("//")) {
    normalized = `/${normalized}`
  }

  const isUnixRoot = normalized === "/"
  const isWindowsDriveRoot = /^[A-Za-z]:\/$/.test(normalized)
  if (!isUnixRoot && !isWindowsDriveRoot) {
    normalized = normalized.replace(/\/+$/, "")
  }

  return normalized
}

export const isFilesViewPathWithinRoot = (path: string, root: string): boolean => {
  const normalizedRoot = normalizeFilesViewPath(root)
  const normalizedPath = normalizeFilesViewPath(path)
  if (!normalizedRoot || !normalizedPath) return false
  return projectPathMatchesRoot(normalizedPath, normalizedRoot)
}

const appendPathSegment = (base: string, segment: string): string =>
  base.endsWith("/") ? `${base}${segment}` : `${base}/${segment}`

export const getFilesViewAncestorPaths = (filePath: string, root: string): string[] => {
  const normalizedRoot = normalizeFilesViewPath(root)
  const normalizedFile = normalizeFilesViewPath(filePath)

  if (!isFilesViewPathWithinRoot(normalizedFile, normalizedRoot)) return []

  const relative = normalizedFile.slice(normalizedRoot.length).replace(/^\//, "")
  const parts = relative.split("/")
  const ancestors: string[] = []
  let current = normalizedRoot

  for (let i = 0; i < parts.length - 1; i++) {
    current = current ? appendPathSegment(current, parts[i]) : parts[i]
    ancestors.push(current)
  }
  return ancestors
}

export const getFilesViewDisplayPath = (root: string | null, path: string): string => {
  if (!path) return ""

  const normalizedFilePath = normalizeFilesViewPath(path)
  const normalizedRoot = root ? normalizeFilesViewPath(root) : ""
  if (!normalizedRoot || !isFilesViewPathWithinRoot(normalizedFilePath, normalizedRoot)) {
    return normalizedFilePath
  }

  const relative = normalizedFilePath.slice(normalizedRoot.length)
  return relative.startsWith("/") ? relative.slice(1) : relative
}
