import { normalizeProjectPath, projectPathMatchesRoot } from "@/lib/projectResolution"

export const normalizeViewPath = (value?: string | null): string => normalizeProjectPath(value) ?? ""

export const viewPathsEqual = (left?: string | null, right?: string | null): boolean => {
  const normalizedLeft = normalizeViewPath(left)
  const normalizedRight = normalizeViewPath(right)
  if (!normalizedLeft || !normalizedRight) return false
  return projectPathMatchesRoot(normalizedLeft, normalizedRight) && projectPathMatchesRoot(normalizedRight, normalizedLeft)
}

const isAbsolutePath = (value: string): boolean => {
  return value.startsWith("/") || value.startsWith("//") || /^[A-Za-z]:\//.test(value)
}

export const toViewAbsolutePath = (directory: string, filePath: string): string => {
  const normalizedDirectory = normalizeViewPath(directory)
  const normalizedFilePath = filePath.replace(/\\/g, "/")
  if (isAbsolutePath(normalizedFilePath)) {
    return normalizeViewPath(normalizedFilePath)
  }
  const trimmedFilePath = normalizedFilePath.replace(/^\/+/, "")
  return normalizedDirectory ? `${normalizedDirectory}/${trimmedFilePath}` : trimmedFilePath
}
