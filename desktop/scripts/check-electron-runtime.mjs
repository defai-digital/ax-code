#!/usr/bin/env node
import { readdirSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const desktopRoot = path.resolve(import.meta.dirname, "..")
const electronRoot = path.join(desktopRoot, "packages", "electron")
const targetRoots = [path.join(electronRoot, "src"), path.join(electronRoot, "scripts")]
const allowedExtensions = new Set([".js", ".mjs", ".cjs"])

function collectFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "resources") {
      continue
    }

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath))
      continue
    }

    if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

const files = targetRoots.flatMap((root) => collectFiles(root)).sort()
const failures = []

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: desktopRoot,
    encoding: "utf8",
  })

  if (result.status !== 0) {
    failures.push({
      file: path.relative(desktopRoot, file),
      output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    })
  }
}

if (failures.length > 0) {
  console.error(`Electron runtime syntax check failed: ${failures.length} file(s) failed.`)
  for (const failure of failures) {
    console.error(`\n${failure.file}`)
    if (failure.output) console.error(failure.output)
  }
  process.exit(1)
}

console.log(`Electron runtime syntax check passed (${files.length} file(s)).`)
