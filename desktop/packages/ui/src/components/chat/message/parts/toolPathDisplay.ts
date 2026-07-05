import { normalizeProjectPath, projectPathMatchesRoot } from "@/lib/projectResolution"

export const normalizeToolDisplayPath = (value: string): string => normalizeProjectPath(value) ?? ""

const pathsEqual = (left: string, right: string): boolean =>
  projectPathMatchesRoot(left, right) && projectPathMatchesRoot(right, left)

const toComparablePath = (value: string): string =>
  value.startsWith("//") || /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value

export const getToolRelativePath = (path: string, currentDirectory: string): string => {
  const normalizedPath = normalizeToolDisplayPath(path)
  const normalizedCurrentDirectory = normalizeToolDisplayPath(currentDirectory)

  if (!normalizedPath) {
    return ""
  }

  if (!normalizedCurrentDirectory) {
    return normalizedPath
  }

  if (pathsEqual(normalizedPath, normalizedCurrentDirectory)) {
    return "."
  }

  if (!projectPathMatchesRoot(normalizedPath, normalizedCurrentDirectory)) {
    return normalizedPath
  }

  const comparablePath = toComparablePath(normalizedPath)
  const comparableDirectory = toComparablePath(normalizedCurrentDirectory)
  const relative = normalizedPath.slice(comparableDirectory.length)
  if (comparablePath === comparableDirectory) {
    return "."
  }
  return relative.startsWith("/") ? relative.slice(1) : relative
}
