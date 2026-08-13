import path from "path"

export function resolveInstalledPackagePath(nodeModulesDir: string, packageName: string) {
  const parts = packageName.split("/")
  return path.join(nodeModulesDir, ...parts)
}

export interface PackageRuntimeManifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function isInstallableRuntimeDependency(name: string, version: string) {
  if (name.startsWith("@ax-code/")) return false
  return !/^(workspace|catalog|link|file):/.test(version)
}

export function collectPackageRuntimeDependencies(manifests: PackageRuntimeManifest[]) {
  const runtimeDependencies = new Map<string, string>()
  for (const manifest of manifests) {
    for (const dependencySet of [manifest.dependencies, manifest.peerDependencies]) {
      for (const [name, version] of Object.entries(dependencySet ?? {})) {
        if (!isInstallableRuntimeDependency(name, version)) continue
        if (!runtimeDependencies.has(name)) runtimeDependencies.set(name, version)
      }
    }
  }

  return Object.fromEntries([...runtimeDependencies.entries()].sort(([a], [b]) => a.localeCompare(b)))
}
