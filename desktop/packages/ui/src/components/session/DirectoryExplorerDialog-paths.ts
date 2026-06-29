import { normalizeProjectPath } from "@/lib/projectResolution"

export const normalizeDirectoryExplorerProjectPathKey = (value?: string | null): string | null => {
  const normalized = normalizeProjectPath(value)
  if (!normalized) return null
  return normalized.startsWith("//") || /^[A-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}
