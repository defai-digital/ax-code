export const INTERNAL_ONLY_ROOTS = [".internal", "ax-internal"] as const

export function isInternalOnlyPath(file: string) {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "")
  return INTERNAL_ONLY_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}
