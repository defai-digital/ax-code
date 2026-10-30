import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../", import.meta.url))

/** Operational coupling only; historical source attribution remains intact. */
export function hasUpstreamRuntimeCoupling(source: string): boolean {
  return /["']@opentui(?:\/|["'])|\bOPENTUI_|libopentui\.|opentui\.dll|opentui-notifications|i=opentui-/.test(source)
}

function sourceFiles(directory: string, nativeRoot = false): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if ([".zig-cache", "zig-out", "lib", "vendor"].includes(entry.name) && nativeRoot) return []
    const file = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return /\.(?:ts|tsx|zig)$/.test(entry.name) ? [file] : []
  })
}

/** The package no longer keeps its own lockfile; the monorepo lockfile is the graph. */
function readWorkspaceLockfile(root: string): string {
  let dir = root
  for (;;) {
    const candidate = join(dir, "pnpm-lock.yaml")
    if (existsSync(candidate)) return readFileSync(candidate, "utf8")
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`No pnpm-lock.yaml found from ${root}`)
    dir = parent
  }
}

export function checkIndependence(root = ROOT): string[] {
  const problems: string[] = []
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (/opentui/i.test(JSON.stringify(pkg[field] ?? {}))) problems.push(`OpenTUI dependency in ${field}`)
  }
  if (/opentui/i.test(readWorkspaceLockfile(root))) problems.push("OpenTUI dependency in lockfile")
  if (/opentui/i.test(readFileSync(join(root, "native/renderer/build.zig.zon"), "utf8"))) {
    problems.push("OpenTUI dependency or identity in native build configuration")
  }
  const files = ["src", "solid/source", "native/source", "native/renderer"].flatMap((dir) =>
    sourceFiles(join(root, dir), dir === "native/renderer"),
  )
  const artifacts = JSON.parse(readFileSync(join(root, "renderer-artifacts.json"), "utf8"))
  files.push(...artifacts.files.filter((file: string) => file.endsWith(".js")).map((file: string) => join(root, file)))
  for (const file of files) {
    if (hasUpstreamRuntimeCoupling(readFileSync(file, "utf8"))) problems.push(`OpenTUI runtime coupling: ${file}`)
  }
  const manifest = JSON.parse(readFileSync(join(root, "vendor/manifest.json"), "utf8"))
  for (const [target, entry] of Object.entries<{ lib: { file: string } }>(manifest.targets)) {
    if (!/^(?:libaxtui\.(?:so|dylib)|axtui\.dll)$/.test(entry.lib.file))
      problems.push(`Non-AX native library: ${target}`)
  }
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkIndependence()
  if (problems.length) throw new Error(problems.join("\n"))
  console.log("AX TUI dependency, native identity, and generated runtime independence checks passed")
}
