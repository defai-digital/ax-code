import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { parse } from "yaml"
import { extractImportSpecifiers } from "./import-specifiers"

export type WorkspacePackage = {
  name: string
  dir: string
  manifest: string
  dependencies: Record<string, string>
}

export type BoundaryViolation = { file: string; spec: string }

const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"])
// These are distribution artifacts, external snapshots, or tooling rather than
// application/library source. AX TUI's additional generated files are listed in
// its renderer-artifacts.json receipt, not inferred from handwritten filenames.
const excludedDirectories = new Set(["node_modules", "dist", "vendor", ".git", ".turbo"])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readManifest(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"))
  if (!record(value)) throw new Error(`Invalid package manifest: ${file}`)
  return value
}

function posix(file: string): string {
  return file.split(path.sep).join("/")
}

export function workspaceConfigurationProblems(root: string): string[] {
  const manifest = readManifest(path.join(root, "package.json"))
  const policy = manifest.pnpm
  if (!record(policy)) return []
  return ["overrides", "patchedDependencies", "onlyBuiltDependencies", "peerDependencyRules"]
    .filter((field) => field in policy)
    .map((field) => `package.json pnpm.${field} belongs in pnpm-workspace.yaml`)
}

export function discoverWorkspacePackages(root: string): WorkspacePackage[] {
  const config: unknown = parse(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8"))
  if (
    !record(config) ||
    !Array.isArray(config.packages) ||
    !config.packages.every((item) => typeof item === "string")
  ) {
    throw new Error("pnpm-workspace.yaml must declare a packages list of glob patterns")
  }
  const patterns: string[] = config.packages
  const manifests = globSync(
    patterns.filter((item) => !item.startsWith("!")).map((item) => `${item}/package.json`),
    {
      cwd: root,
      exclude: [
        "**/node_modules/**",
        ...patterns.filter((item) => item.startsWith("!")).map((item) => `${item.slice(1)}/package.json`),
      ],
    },
  )
  const names = new Set<string>()
  return [...new Set(manifests)].sort().map((manifest) => {
    const json = readManifest(path.join(root, manifest))
    if (typeof json.name !== "string" || !json.name) throw new Error(`Missing package name: ${manifest}`)
    if (names.has(json.name)) throw new Error(`Duplicate workspace package name: ${json.name}`)
    names.add(json.name)
    const dependencies: Record<string, string> = {}
    for (const field of dependencyFields) {
      const entries = json[field]
      if (entries === undefined) continue
      if (!record(entries)) throw new Error(`Invalid ${field}: ${manifest}`)
      for (const [name, version] of Object.entries(entries)) {
        if (typeof version !== "string") throw new Error(`Invalid dependency ${name}: ${manifest}`)
        dependencies[name] = version
      }
    }
    return { name: json.name, dir: posix(path.dirname(manifest)), manifest: posix(manifest), dependencies }
  })
}

function dependencyName(name: string, version: string): string {
  // pnpm workspace aliases (for example ax-tui -> @defai-digital/ax-tui)
  // must participate in the graph under the target's real package identity.
  const alias = /^workspace:((?:@[^/]+\/)?[^@/]+)@/.exec(version)
  return alias?.[1] ?? name
}

export function workspaceDependencyCycles(packages: readonly WorkspacePackage[]): string[] {
  const names = new Set(packages.map((item) => item.name))
  const graph = new Map(
    packages.map((item) => [
      item.name,
      [...new Set(Object.entries(item.dependencies).map(([name, version]) => dependencyName(name, version)))]
        .filter((name) => names.has(name))
        .sort(),
    ]),
  )
  const cycles = new Set<string>()
  const visiting: string[] = []
  function visit(name: string): void {
    const start = visiting.indexOf(name)
    if (start !== -1) {
      const cycle = visiting.slice(start)
      const rotations = cycle.map((_, i) => [...cycle.slice(i), ...cycle.slice(0, i)])
      const canonical = rotations.sort((a, b) => a.join("\0").localeCompare(b.join("\0")))[0]!
      cycles.add([...canonical, canonical[0]].join(" -> "))
      return
    }
    visiting.push(name)
    for (const dep of graph.get(name) ?? []) visit(dep)
    visiting.pop()
  }
  for (const name of [...names].sort()) visit(name)
  return [...cycles].sort()
}

export function workspaceSourceFiles(root: string, pkg: WorkspacePackage): string[] {
  const directory = path.join(root, pkg.dir)
  const generated = new Set<string>()
  if (pkg.name === "@defai-digital/ax-tui") {
    const receipt = readManifest(path.join(directory, "renderer-artifacts.json"))
    if (!Array.isArray(receipt.files) || !receipt.files.every((file) => typeof file === "string")) {
      throw new Error("Invalid AX TUI renderer artifact receipt")
    }
    for (const file of receipt.files) generated.add(file)
  }
  return globSync("**/*", {
    cwd: directory,
    // Only package-root script/perf trees are tooling. Runtime src/perf and
    // regression tests under test/script must retain boundary coverage.
    exclude: ["script/**", "perf/**", ...[...excludedDirectories].map((name) => `**/${name}/**`)],
  })
    .filter((file) => {
      const relative = posix(file)
      if (!sourceExtensions.has(path.extname(file)) || /\.d\.[cm]?ts$/.test(file) || generated.has(relative))
        return false
      const parts = relative.split("/")
      // Root runtime modules and authored source/test trees. Build and benchmark
      // scripts intentionally have different cross-package access requirements.
      return parts.length === 1
        ? !/\.config\.[^.]+$/.test(file)
        : parts.some((part) => part === "src" || part === "source" || part === "test")
    })
    .map((file) => posix(path.join(pkg.dir, file)))
    .sort()
}

export function workspaceBoundaryViolations(root: string, packages: readonly WorkspacePackage[]): BoundaryViolation[] {
  const violations: BoundaryViolation[] = []
  for (const pkg of packages) {
    const packageNames = new Set([...packages.map((item) => item.name), ...Object.keys(pkg.dependencies)])
    for (const file of workspaceSourceFiles(root, pkg)) {
      const source = readFileSync(path.join(root, file), "utf8")
      for (const { specifier } of extractImportSpecifiers(source, file)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
        const escapes = specifier.startsWith(".") && target !== pkg.dir && !target.startsWith(`${pkg.dir}/`)
        const deep = [...packageNames].some((name) => specifier.startsWith(`${name}/src/`))
        if (escapes || deep || (specifier.includes("packages/") && specifier.includes("/src/"))) {
          violations.push({ file, spec: specifier })
        }
      }
    }
  }
  return violations
}
