import path from "path"
import { isScopedBinaryPackageName } from "./package-names"

export type BinaryPublishTarget = {
  packageName: string
  version: string
  distDir: string
}

export function collectBinaryPublishTargets(
  entries: Array<{
    manifestPath: string
    packageName: unknown
    version: unknown
  }>,
  basePackageName: string,
): BinaryPublishTarget[] {
  return entries.flatMap((entry) => {
    if (typeof entry.packageName !== "string" || typeof entry.version !== "string") {
      return []
    }
    if (!isScopedBinaryPackageName(entry.packageName, basePackageName)) {
      return []
    }

    return [
      {
        packageName: entry.packageName,
        version: entry.version,
        // Build output still uses the legacy directory name; only the package name is scoped.
        distDir: path.posix.dirname(entry.manifestPath.replaceAll("\\", "/")),
      },
    ]
  })
}
