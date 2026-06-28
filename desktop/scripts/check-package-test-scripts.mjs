#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, "..")
const packagesRoot = path.join(desktopRoot, "packages")
const testFilePattern = /\.(test|spec)\.[cm]?[jt]sx?$/
const ignoredDirectories = new Set(["node_modules", "dist", "build", "coverage", ".turbo"])

function listPackageDirectories() {
  return fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesRoot, entry.name))
    .filter((packageDir) => fs.existsSync(path.join(packageDir, "package.json")))
    .sort()
}

function hasTestFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue

    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (hasTestFiles(entryPath)) return true
      continue
    }

    if (entry.isFile() && testFilePattern.test(entry.name)) {
      return true
    }
  }
  return false
}

function readPackageJson(packageDir) {
  const packageJsonPath = path.join(packageDir, "package.json")
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
}

const failures = []

for (const packageDir of listPackageDirectories()) {
  const packageJson = readPackageJson(packageDir)
  const packageName = packageJson.name ?? path.basename(packageDir)
  const packageHasTests = hasTestFiles(packageDir)
  const testScript = packageJson.scripts?.test

  if (packageHasTests && (typeof testScript !== "string" || testScript.trim().length === 0)) {
    failures.push(`${packageName} has test files but no scripts.test`)
  }
}

if (failures.length > 0) {
  console.error("Desktop package test script check failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log("Desktop package test script check passed.")
