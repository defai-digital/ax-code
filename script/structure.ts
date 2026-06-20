import fs from "fs"
import path from "path"
import { spawnSync } from "node:child_process"
import { V4Guardrails } from "../packages/ax-code/script/check-no-effect-solid-in-v4"
import { exists, readText, scan, writeText } from "../packages/ax-code/script/fs-compat"

const root = path.resolve(import.meta.dirname, "..")

const note = [
  "packages/integration-github/ARCHITECTURE.md",
  "packages/integration-vscode/ARCHITECTURE.md",
  "packages/ax-code/ARCHITECTURE.md",
  "packages/util/ARCHITECTURE.md",
  "packages/plugin/ARCHITECTURE.md",
  "packages/sdk/js/ARCHITECTURE.md",
]

const rule = [] as { name: string; dir: string; bad: string[] }[]

const hot = ["packages/ax-code/src/cli/cmd"]
const workspacePackageRoots = ["packages", "packages/sdk/js"]
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const
const axCodeSrcRoot = path.join(root, "packages/ax-code/src")
const runtimeBoundaryAllowedFiles = new Set([
  "packages/ax-code/src/index.ts",
  "packages/ax-code/src/index-compiled.ts",
  // Node runtime entry points — boot the CLI exactly like index.ts does.
  "packages/ax-code/src/index-node.ts",
  "packages/ax-code/src/index-node-tui.ts",
  "packages/ax-code/src/node.ts",
  "packages/ax-code/src/sdk/programmatic.ts",
  "packages/ax-code/src/runtime/local-client.ts",
  // Intentionally use the shared runtime HTTP/WS adapter (ADR-036 S1): these
  // are second servers, not domain code reaching into the CLI/server interface.
  "packages/ax-code/src/mcp/oauth-callback.ts",
  "packages/ax-code/src/control-plane/workspace-server/server.ts",
])

const ext = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"])
const old = ["ADRS", "PRDS", "BUGS", "TODOS", "specs", "sdks", "github", "scripts"]
const keep = [
  ".ax-code",
  ".ax-grok",
  ".claude",
  ".cursor",
  ".gemini",
  ".git",
  ".github",
  ".husky",
  "ax-internal",
  ".pnpm-store",
  ".qoder",
  ".ruff_cache",
  ".tmp",
  ".turbo",
  "crates",
  "debug-log",
  "docs",
  "logo",
  "planning",
  "nix",
  "node_modules",
  "packages",
  "patches",
  "script",
  "tools",
]

function rel(file: string) {
  return path.relative(root, file)
}

function skip(file: string) {
  return (
    file.includes("/node_modules/") || file.includes("/dist/") || file.includes("/.git/") || file.includes("/.turbo/")
  )
}

async function list(dir: string) {
  const out = [] as string[]
  const base = path.join(root, dir)
  for (const file of await scan("**/*", { cwd: base, absolute: true })) {
    if (skip(file)) continue
    if (!ext.has(path.extname(file))) continue
    out.push(file)
  }
  return out.sort()
}

function spec(text: string) {
  const out = [] as string[]
  for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) out.push(match[1])
  for (const match of text.matchAll(/import\s+["']([^"']+)["']/g)) out.push(match[1])
  for (const match of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(match[1])
  return out
}

function readJSON(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
}

async function docs() {
  const miss = [] as string[]
  for (const file of note) {
    const ok = await exists(path.join(root, file))
    if (!ok) miss.push(file)
  }
  return miss
}

async function deps() {
  const hit = [] as { name: string; file: string; bad: string; spec: string }[]

  for (const item of rule) {
    for (const file of await list(item.dir)) {
      const text = await readText(file)
      for (const name of spec(text)) {
        for (const bad of item.bad) {
          if (!name.includes(bad)) continue
          hit.push({
            name: item.name,
            file: rel(file),
            bad,
            spec: name,
          })
        }
      }
    }
  }

  return hit
}

async function deep() {
  const out = [] as { file: string; spec: string }[]
  for (const dir of [
    "packages/ax-code/src",
    "packages/plugin/src",
    "packages/sdk/js/src",
    "packages/integration-github",
    "packages/integration-vscode/src",
    "packages/util/src",
  ]) {
    for (const file of await list(dir)) {
      const text = await readText(file)
      for (const name of spec(text)) {
        if (name.includes("@ax-code/") && name.includes("/src/")) {
          out.push({ file: rel(file), spec: name })
          continue
        }
        if (name.includes("packages/") && name.includes("/src/")) {
          out.push({ file: rel(file), spec: name })
          continue
        }
        if (name.includes("../packages/") && name.includes("/src/")) {
          out.push({ file: rel(file), spec: name })
        }
      }
    }
  }
  return out
}

async function sdkSourceImports() {
  const out = [] as { file: string; spec: string }[]
  const seen = new Set<string>()
  for (const file of await list("packages/ax-code/src")) {
    const text = await readText(file)
    for (const name of spec(text)) {
      if (name.includes("sdk/js/src/") || name.includes("@ax-code/sdk/src/")) {
        const item = { file: rel(file), spec: name }
        const key = `${item.file}\0${item.spec}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(item)
      }
    }
  }
  return out
}

function resolveAxCodeImport(file: string, name: string) {
  if (name.startsWith("@/")) return path.join(axCodeSrcRoot, name.slice(2))
  if (name.startsWith("./") || name.startsWith("../")) return path.resolve(path.dirname(file), name)
  return undefined
}

function isAxCodeInterfaceTarget(target: string) {
  const normalized = rel(target).split(path.sep).join("/")
  return (
    normalized === "packages/ax-code/src/cli" ||
    normalized.startsWith("packages/ax-code/src/cli/") ||
    normalized === "packages/ax-code/src/server" ||
    normalized.startsWith("packages/ax-code/src/server/")
  )
}

function isAxCodeInterfaceFile(file: string) {
  const normalized = rel(file).split(path.sep).join("/")
  return normalized.startsWith("packages/ax-code/src/cli/") || normalized.startsWith("packages/ax-code/src/server/")
}

async function runtimeInternalBoundaries() {
  const out = [] as { file: string; spec: string }[]
  const seen = new Set<string>()
  for (const file of await list("packages/ax-code/src")) {
    const relative = rel(file).split(path.sep).join("/")
    if (isAxCodeInterfaceFile(file)) continue
    if (runtimeBoundaryAllowedFiles.has(relative)) continue

    const text = await readText(file)
    for (const name of spec(text)) {
      const target = resolveAxCodeImport(file, name)
      if (!target || !isAxCodeInterfaceTarget(target)) continue
      const key = `${relative}\0${name}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ file: relative, spec: name })
    }
  }
  return out
}

async function lines(dir: string) {
  const out = [] as { file: string; lines: number }[]
  for (const file of await list(dir)) {
    const text = await readText(file)
    out.push({
      file: rel(file),
      lines: text.split(/\r?\n/).length,
    })
  }
  return out
}

async function size() {
  const out = await lines("packages/ax-code/src")
  return out.sort((a, b) => b.lines - a.lines)
}

async function count(dir: string) {
  let sum = 0
  for (const file of await scan("**/*", { cwd: path.join(root, dir), absolute: true })) {
    if (skip(file)) continue
    if (!ext.has(path.extname(file))) continue
    sum++
  }
  return sum
}

function workspacePackages() {
  const packages = [] as { name: string; dir: string; manifest: string; dependencies: string[] }[]
  const seen = new Set<string>()

  for (const rootDir of workspacePackageRoots) {
    const abs = path.join(root, rootDir)
    if (!fs.existsSync(abs)) continue

    const candidates = rootDir === "packages" ? fs.readdirSync(abs).map((name) => path.join(abs, name)) : [abs]
    for (const candidate of candidates) {
      const manifest = path.join(candidate, "package.json")
      if (seen.has(manifest) || !fs.existsSync(manifest)) continue
      seen.add(manifest)

      const json = readJSON(manifest)
      if (typeof json.name !== "string") continue
      const deps = new Set<string>()
      for (const field of dependencyFields) {
        const value = json[field]
        if (!value || typeof value !== "object" || Array.isArray(value)) continue
        for (const name of Object.keys(value)) deps.add(name)
      }

      packages.push({
        name: json.name,
        dir: rel(candidate),
        manifest: rel(manifest),
        dependencies: [...deps].sort(),
      })
    }
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name))
}

function dependencyCycles() {
  const packages = workspacePackages()
  const names = new Set(packages.map((item) => item.name))
  const graph = new Map<string, string[]>()
  for (const item of packages) {
    graph.set(item.name, item.dependencies.filter((name) => names.has(name)).sort())
  }

  const cycles = new Set<string>()
  const pathStack = [] as string[]
  const visiting = new Set<string>()

  function canonical(cycle: string[]) {
    const body = cycle.slice(0, -1)
    let best = body
    for (let i = 1; i < body.length; i++) {
      const rotated = body.slice(i).concat(body.slice(0, i))
      if (rotated.join("\0") < best.join("\0")) best = rotated
    }
    return best.concat(best[0]!).join(" -> ")
  }

  function visit(name: string) {
    if (visiting.has(name)) {
      const start = pathStack.indexOf(name)
      if (start >= 0) cycles.add(canonical(pathStack.slice(start).concat(name)))
      return
    }

    visiting.add(name)
    pathStack.push(name)
    for (const dep of graph.get(name) ?? []) visit(dep)
    pathStack.pop()
    visiting.delete(name)
  }

  for (const item of packages) visit(item.name)
  return [...cycles].sort()
}

function shape(dir: string) {
  let direct = 0
  let group = 0

  for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = path.join(root, dir, item.name)
    if (skip(file)) continue
    if (item.isDirectory()) {
      group++
      continue
    }
    if (ext.has(path.extname(item.name))) direct++
  }

  return { direct, group }
}

async function top() {
  const out = [] as { dir: string; files: number; direct: number; group: number }[]
  for (const dir of hot) {
    const view = shape(dir)
    out.push({
      dir,
      files: await count(dir),
      direct: view.direct,
      group: view.group,
    })
  }
  return out
}

function roots() {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .filter((name) => !keep.includes(name))
    .sort()
}

function trackedInternalFiles() {
  const result = spawnSync("git", ["ls-files", "ax-internal"], {
    cwd: root,
  })
  if (result.status !== 0) {
    const message = (result.stderr?.toString() ?? "").trim()
    throw new Error(message || "failed to inspect tracked ax-internal files")
  }
  return result.stdout
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function main() {
  const miss = await docs()
  const hit = await deps()
  const raw = await deep()
  const sdkRaw = await sdkSourceImports()
  const runtimeBoundary = await runtimeInternalBoundaries()
  const cycles = dependencyCycles()
  const v4 = await V4Guardrails.check(path.join(root, "packages/ax-code"))
  const all = await size()
  const top10 = all.slice(0, 10)
  const big = all.filter((item) => item.lines >= 800)
  const warm = all.filter((item) => item.lines >= 500).length
  const sums = await top()
  const drift = roots()
  const stale = old.filter((dir) => fs.existsSync(path.join(root, dir)))
  const trackedInternal = trackedInternalFiles()
  const out = [] as string[]
  out.push("# Repo Structure Report")
  out.push("")
  out.push("## Docs")
  out.push(miss.length ? `- missing: ${miss.join(", ")}` : "- ok: required architecture notes are present")
  out.push("")
  out.push("## Boundaries")
  if (hit.length) {
    for (const row of hit) out.push(`- ${row.name}: ${row.file} imports ${row.spec}`)
  } else {
    out.push("- ok: no package boundary violations found")
  }
  out.push("")
  out.push("## Deep Imports")
  if (raw.length) {
    for (const row of raw) out.push(`- ${row.file} imports ${row.spec}`)
  } else {
    out.push("- ok: no raw src imports across package boundaries found")
  }
  out.push("")
  out.push("## SDK Runtime Source Imports")
  if (sdkRaw.length) {
    out.push("- warning: runtime imports SDK source files directly; replace with stable SDK exports")
    for (const row of sdkRaw) out.push(`- ${row.file} imports ${row.spec}`)
  } else {
    out.push("- ok: runtime imports SDK contracts through package exports")
  }
  out.push("")
  out.push("## Runtime Internal Boundaries")
  if (runtimeBoundary.length) {
    out.push("- error: domain files import CLI/server interface modules directly")
    for (const row of runtimeBoundary) out.push(`- ${row.file} imports ${row.spec}`)
  } else {
    out.push("- ok: domain files do not import CLI or server interface modules directly")
  }
  out.push("")
  out.push("## Workspace Dependency Cycles")
  if (cycles.length) {
    out.push("- warning: workspace package manifest cycles found")
    for (const cycle of cycles) out.push(`- ${cycle}`)
  } else {
    out.push("- ok: no workspace package manifest cycles found")
  }
  out.push("")
  out.push("## Internal Files")
  if (trackedInternal.length) {
    out.push("- error: ax-internal files are tracked; remove them from git index before publishing")
    for (const file of trackedInternal) out.push(`- ${file}`)
  } else {
    out.push("- ok: no ax-internal files are tracked")
  }
  out.push("")
  out.push("## V4 Guardrails")
  if (v4.length) {
    for (const row of v4) out.push(`- ${V4Guardrails.format(row)}`)
  } else {
    out.push("- ok: no Effect, Solid, or OpenTUI imports found in v4 guarded directories")
  }
  out.push("")
  out.push("## Hotspots")
  for (const row of sums) {
    out.push(`- ${row.dir}: ${row.direct} direct files, ${row.group} child folders, ${row.files} total source files`)
  }
  out.push("")
  out.push("## Hotspot Thresholds")
  out.push(`- 500+ line files: ${warm}`)
  out.push(`- 800+ line files: ${big.length}`)
  if (big.length) {
    out.push(
      "- warning: existing 800+ line files should shrink through scoped extraction before new large surfaces are added",
    )
  }
  out.push("")
  out.push("## Largest Files")
  for (const row of top10) out.push(`- ${row.lines}: ${row.file}`)
  out.push("")
  out.push("## Legacy Root Folders")
  if (stale.length) for (const dir of stale) out.push(`- ${dir}: present`)
  else out.push("- ok: no legacy root folders found")
  out.push("")
  out.push("## Unexpected Root Folders")
  if (drift.length) {
    for (const dir of drift) out.push(`- ${dir}`)
  } else {
    out.push("- ok: no unexpected root folders found")
  }
  out.push("")

  const text = out.join("\n")
  console.log(text)

  const file = process.env["GITHUB_STEP_SUMMARY"]
  if (file) {
    const prev = await readText(file).catch(() => "")
    await writeText(file, `${prev}${text}\n`)
  }

  if (
    miss.length ||
    hit.length ||
    raw.length ||
    runtimeBoundary.length ||
    v4.length ||
    stale.length ||
    drift.length ||
    trackedInternal.length
  ) {
    process.exit(1)
  }
}

await main()
