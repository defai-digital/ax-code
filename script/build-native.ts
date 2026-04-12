#!/usr/bin/env bun
/**
 * Build native Rust addons (napi-rs) and wire them into the workspace.
 *
 * Usage:
 *   bun run script/build-native.ts          # release build (default)
 *   bun run script/build-native.ts --debug  # debug build
 *   bun run script/build-native.ts fs diff  # build only selected packages
 *
 * Each package in `packages/ax-code-*-native/` already has a `napi build`
 * script. This driver runs them in sequence and reports a summary. After
 * this completes, `ax-code doctor` reports native addons as installed.
 */

import { spawnSync } from "node:child_process"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { writeFileSync, existsSync } from "node:fs"

interface NativePkg {
  /** pnpm workspace package name (package.json "name") */
  pkgName: string
  /** directory under packages/ */
  dir: string
  /** short alias for CLI selection */
  alias: string
  /** napi binaryName (used for the .node filename and the index.js shim) */
  binaryName: string
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const PACKAGES: NativePkg[] = [
  { pkgName: "@ax-code/index-core", dir: "ax-code-index-core", alias: "index-core", binaryName: "index-core" },
  { pkgName: "@ax-code/fs", dir: "ax-code-fs-native", alias: "fs", binaryName: "ax-code-fs" },
  { pkgName: "@ax-code/diff", dir: "ax-code-diff-native", alias: "diff", binaryName: "ax-code-diff" },
  { pkgName: "@ax-code/parser", dir: "ax-code-parser-native", alias: "parser", binaryName: "ax-code-parser" },
]

function parseArgs(argv: string[]) {
  const flags = new Set<string>()
  const selected: string[] = []
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) flags.add(arg.slice(2))
    else selected.push(arg)
  }
  return { debug: flags.has("debug"), selected }
}

function buildPackage(pkg: NativePkg, debug: boolean): boolean {
  const script = debug ? "build:debug" : "build"
  console.log(`\n→ pnpm --filter ${pkg.pkgName} run ${script}`)
  const result = spawnSync("pnpm", ["--filter", pkg.pkgName, "run", script], {
    stdio: "inherit",
    cwd: ROOT,
  })
  if (result.status !== 0) {
    console.error(`✗ build failed for ${pkg.pkgName}`)
    return false
  }

  // napi-rs v3 with `--output-dir .` emits `<binaryName>.node` but skips the
  // `index.js` shim (that's only written when `--platform` publishes per-triple
  // subpackages). For local dev we generate a minimal CommonJS shim pointing at
  // the built .node file, matching the `main` field in package.json.
  const dir = join(ROOT, "packages", pkg.dir)
  const nodeFile = join(dir, `${pkg.binaryName}.node`)
  if (!existsSync(nodeFile)) {
    console.error(`✗ expected ${nodeFile} after build, but it is missing`)
    return false
  }
  writeFileSync(
    join(dir, "index.js"),
    `"use strict"\nmodule.exports = require("./${pkg.binaryName}.node")\n`,
  )

  console.log(`✓ ${pkg.pkgName}`)
  return true
}

function main() {
  const { debug, selected } = parseArgs(process.argv)
  const toBuild = selected.length > 0
    ? PACKAGES.filter((p) => selected.includes(p.alias) || selected.includes(p.pkgName) || selected.includes(p.dir))
    : PACKAGES

  if (toBuild.length === 0) {
    console.error(`No packages matched. Available aliases: ${PACKAGES.map((p) => p.alias).join(", ")}`)
    process.exit(1)
  }

  console.log(`Building ${toBuild.length} native package(s) in ${debug ? "debug" : "release"} mode...`)

  let failed = 0
  for (const pkg of toBuild) {
    if (!buildPackage(pkg, debug)) failed++
  }

  if (failed > 0) {
    console.error(`\n${failed} package(s) failed to build.`)
    process.exit(1)
  }

  console.log(`\nDone. Run \`ax-code doctor\` to verify.`)
}

main()
