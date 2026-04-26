import path from "path"

// Defaults shared by all detect-* scanners. The pattern set covers
// every TS/JS variant the codebase ships; the exclude list mirrors
// the dirs that other scan paths (grep, glob) ignore.
export const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"]
export const DEFAULT_EXCLUDE_DIRS = ["node_modules", "dist", "build", ".cache", ".git", ".next", "coverage"]
export const DEFAULT_MAX_FILES = 500
export const DEFAULT_MAX_PER_FILE = 20

export function isTestFile(file: string): boolean {
  return /(^|\/)(test|tests|__tests__|__mocks__|spec)\//.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file)
}

export function isExcludedDir(file: string, cwd: string): boolean {
  const rel = path.relative(cwd, file)
  const segments = rel.split(path.sep)
  return segments.some((seg) => DEFAULT_EXCLUDE_DIRS.includes(seg))
}
