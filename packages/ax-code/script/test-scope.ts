import path from "node:path"

export function testScanDirectory(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") break
    if (argv[i] === "--dir") return argv[i + 1]
    if (argv[i]?.startsWith("--dir=")) return argv[i].slice(6)
  }
}

const normalize = (file: string) => file.split(path.sep).join("/")
const outside = (file: string) => file === ".." || file.startsWith("../") || path.isAbsolute(file)

/** Vitest resolves include/exclude patterns against dir, not the package root. */
export function testScope(input: {
  root: string
  scanDir?: string
  files?: readonly string[]
  excluded: readonly string[]
}) {
  if (input.excluded.some((file) => /[*?{[\\]/.test(file)))
    throw new Error("Test scope exclusions must be literal package-relative paths")
  const scan = path.resolve(input.root, input.scanDir ?? ".")
  const relative = (file: string) => normalize(path.relative(scan, path.resolve(input.root, file)))
  const tests = relative("test")
  const withinTests = !outside(normalize(path.relative(path.resolve(input.root, "test"), scan)))
  const include = input.files
    ? input.files.map(relative).filter((file) => !outside(file))
    : withinTests
      ? ["**/*.test.{ts,tsx}"]
      : !outside(tests)
        ? [`${tests}/**/*.test.{ts,tsx}`]
        : []
  const excluded = input.excluded.filter((file) => !input.files?.includes(file)).map(relative)
  return {
    include,
    exclude: ["**/node_modules/**", relative("test-vitest/**"), ...excluded],
  }
}
