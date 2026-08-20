import path from "path"

export function resolveInstalledPackagePath(nodeModulesDir: string, packageName: string) {
  const parts = packageName.split("/")
  return path.join(nodeModulesDir, ...parts)
}

export interface PackageRuntimeManifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export type CatalogDependencyVersionResolver = (name: string) => string

function installableRuntimeDependencyVersion(
  name: string,
  version: string,
  resolveCatalogVersion?: CatalogDependencyVersionResolver,
) {
  if (name.startsWith("@ax-code/")) return
  if (version.startsWith("catalog:")) {
    if (!resolveCatalogVersion) return
    const resolved = resolveCatalogVersion(name)
    if (!resolved || /^(workspace|catalog|link|file):/.test(resolved)) {
      throw new Error(`Catalog dependency ${name} did not resolve to an installable version: ${resolved || "<empty>"}`)
    }
    return resolved
  }
  if (/^(workspace|link|file):/.test(version)) return
  return version
}

export function collectPackageRuntimeDependencies(
  manifests: PackageRuntimeManifest[],
  resolveCatalogVersion?: CatalogDependencyVersionResolver,
) {
  const runtimeDependencies = new Map<string, string>()
  for (const manifest of manifests) {
    for (const dependencySet of [manifest.dependencies, manifest.peerDependencies]) {
      for (const [name, version] of Object.entries(dependencySet ?? {})) {
        const installableVersion = installableRuntimeDependencyVersion(name, version, resolveCatalogVersion)
        if (!installableVersion) continue
        if (!runtimeDependencies.has(name)) runtimeDependencies.set(name, installableVersion)
      }
    }
  }

  return Object.fromEntries([...runtimeDependencies.entries()].sort(([a], [b]) => a.localeCompare(b)))
}
