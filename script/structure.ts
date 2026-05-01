#!/usr/bin/env bun

import fs from "fs"
import path from "path"
import { V4Guardrails } from "../packages/ax-code/script/check-no-effect-solid-in-v4"

const root = path.resolve(import.meta.dir, "..")

const note = [
  "packages/integration-github/ARCHITECTURE.md",
  "packages/integration-vscode/ARCHITECTURE.md",
  "packages/ax-code/ARCHITECTURE.md",
  "packages/ui/ARCHITECTURE.md",
  "packages/util/ARCHITECTURE.md",
  "packages/plugin/ARCHITECTURE.md",
  "packages/sdk/js/ARCHITECTURE.md",
]

const rule = [
  {
    name: "ax-code",
    dir: "packages/ax-code/src",
    bad: ["@ax-code/ui"],
  },
  {
    name: "util",
    dir: "packages/util/src",
    bad: ["@ax-code/ui"],
  },
  {
    name: "plugin",
    dir: "packages/plugin/src",
    bad: ["@ax-code/ui"],
  },
  {
    name: "sdk",
    dir: "packages/sdk/js/src",
    bad: ["@ax-code/ui"],
  },
  {
    name: "integration-github",
    dir: "packages/integration-github",
    bad: ["@ax-code/ui"],
  },
  {
    name: "integration-vscode",
    dir: "packages/integration-vscode/src",
    bad: ["@ax-code/ui"],
  },
]

const hot = ["packages/ax-code/src/cli/cmd", "packages/ui/src/components"]

const ext = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"])
const old = ["ADRS", "PRDS", "BUGS", "TODOS", "specs", "sdks", "github", "scripts"]
const keep = [
  ".ax-grok",
  ".claude",
  ".cursor",
  ".gemini",
  ".git",
  ".github",
  ".husky",
  ".internal",
  ".pnpm-store",
  ".tmp",
  ".turbo",
  "crates",
  "debug-log",
  "docs",
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
  for await (const file of new Bun.Glob("**/*").scan({ cwd: base, absolute: true })) {
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
  return out
}

async function docs() {
  const miss = [] as string[]
  for (const file of note) {
    const ok = await Bun.file(path.join(root, file)).exists()
    if (!ok) miss.push(file)
  }
  return miss
}

async function deps() {
  const hit = [] as { name: string; file: string; bad: string; spec: string }[]

  for (const item of rule) {
    for (const file of await list(item.dir)) {
      const text = await Bun.file(file).text()
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
    "packages/ui/src",
    "packages/util/src",
  ]) {
    for (const file of await list(dir)) {
      const text = await Bun.file(file).text()
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

async function lines(dir: string) {
  const out = [] as { file: string; lines: number }[]
  for (const file of await list(dir)) {
    const text = await Bun.file(file).text()
    out.push({
      file: rel(file),
      lines: text.split(/\r?\n/).length,
    })
  }
  return out
}

async function size() {
  const out = [] as { file: string; lines: number }[]
  for (const dir of ["packages/ax-code/src", "packages/ui/src"]) {
    out.push(...(await lines(dir)))
  }
  return out.sort((a, b) => b.lines - a.lines)
}

async function count(dir: string) {
  let sum = 0
  for await (const file of new Bun.Glob("**/*").scan({ cwd: path.join(root, dir), absolute: true })) {
    if (skip(file)) continue
    if (!ext.has(path.extname(file))) continue
    sum++
  }
  return sum
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

async function main() {
  const miss = await docs()
  const hit = await deps()
  const raw = await deep()
  const v4 = await V4Guardrails.check(path.join(root, "packages/ax-code"))
  const all = await size()
  const top10 = all.slice(0, 10)
  const big = all.filter((item) => item.lines >= 800)
  const warm = all.filter((item) => item.lines >= 500).length
  const sums = await top()
  const drift = roots()
  const stale = old.filter((dir) => fs.existsSync(path.join(root, dir)))
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
  out.push(`- 500+ line files: ${warm}`)
  out.push(`- 800+ line files: ${big.length}`)
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
    const prev = await Bun.file(file)
      .text()
      .catch(() => "")
    await Bun.write(file, `${prev}${text}\n`)
  }

  if (miss.length || hit.length || raw.length || v4.length || stale.length || drift.length) process.exit(1)
}

await main()
