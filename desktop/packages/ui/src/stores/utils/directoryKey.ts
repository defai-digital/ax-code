import { normalizeProjectPath } from "@/lib/projectResolution"

export const normalizeDirectoryKey = (directory: string | null | undefined): string => {
  return normalizeProjectPath(directory) ?? ""
}
