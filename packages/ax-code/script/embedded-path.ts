export function compiledBunfsModulePath(bunfsRoot: string, sourcePath: string): string {
  const normalized = sourcePath.replaceAll("\\", "/").replace(/^\.\//, "")
  const runtimePath = normalized.replace(/\.(?:[cm]?ts|tsx)$/, ".js")
  return bunfsRoot + runtimePath
}
