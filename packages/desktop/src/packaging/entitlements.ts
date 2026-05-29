import { existsSync } from "node:fs"
import path from "node:path"

export const MAC_ENTITLEMENTS_FILE_NAME = "entitlements.mac.plist"

export function defaultMacEntitlementsPath(): string {
  return path.resolve(import.meta.dirname, "../../resources", MAC_ENTITLEMENTS_FILE_NAME)
}

export function resolveMacEntitlementsPath(entitlementsPath: string | undefined): string {
  return entitlementsPath ? path.resolve(entitlementsPath) : defaultMacEntitlementsPath()
}

export function assertMacEntitlementsFile(
  entitlementsPath: string,
  exists: (file: string) => boolean = existsSync,
): void {
  if (!exists(entitlementsPath)) {
    throw new Error(`Mac release entitlements file is missing: ${entitlementsPath}`)
  }
}
