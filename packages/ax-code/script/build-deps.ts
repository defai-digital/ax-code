import path from "path"

const OPENTUI_TARGET_PACKAGE = /^@opentui\/core-(darwin|linux|win32)-(arm64|x64)(-musl)?$/
const PARCEL_WATCHER_TARGET_PACKAGE = /^@parcel\/watcher-(darwin|linux|win32)-(arm64|x64)(-(glibc|musl))?$/

export interface BuildTargetSpec {
  os: string
  arch: string
  abi?: string
}

function opentuiPackageNameForTarget(target: BuildTargetSpec) {
  return `@opentui/core-${target.os}-${target.arch}${target.abi === "musl" ? "-musl" : ""}`
}

function isCurrentNativeTarget(target: BuildTargetSpec, currentTarget: BuildTargetSpec) {
  return target.os === currentTarget.os && target.arch === currentTarget.arch && target.abi === currentTarget.abi
}

export function collectBuildDependencyPackages(
  opentuiOptionalDependencies?: Record<string, string>,
  packageDevDependencies?: Record<string, string>,
  targets: BuildTargetSpec[] = [],
  currentTarget: BuildTargetSpec = { os: process.platform, arch: process.arch },
) {
  const buildDependencies = new Map<string, string>()
  const requiredOpentuiPackages = new Set(
    targets
      .filter((target) => !isCurrentNativeTarget(target, currentTarget))
      .map((target) => opentuiPackageNameForTarget(target)),
  )

  for (const [name, version] of Object.entries(opentuiOptionalDependencies ?? {})) {
    if (OPENTUI_TARGET_PACKAGE.test(name) && requiredOpentuiPackages.has(name)) {
      buildDependencies.set(name, version)
    }
  }

  for (const [name, version] of Object.entries(packageDevDependencies ?? {})) {
    if (PARCEL_WATCHER_TARGET_PACKAGE.test(name)) {
      buildDependencies.set(name, version)
    }
  }

  return [...buildDependencies.entries()]
    .map(([name, version]) => ({ name, version }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function resolveInstalledPackagePath(nodeModulesDir: string, packageName: string) {
  const parts = packageName.split("/")
  return path.join(nodeModulesDir, ...parts)
}
