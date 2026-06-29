import { getProjectPathIdentityKey } from "@/lib/projectResolution"

export const normalizeDirectoryExplorerProjectPathKey = (value?: string | null): string | null => {
  return getProjectPathIdentityKey(value)
}
