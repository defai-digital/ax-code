#!/usr/bin/env node
// Rebuild node-pty with a node-gyp that recognizes Visual Studio 2026.
//
// pnpm 10.33.4 runs package scripts with its bundled node-gyp 11.5.0 and
// strips a caller-supplied npm_config_node_gyp. That copy maps Visual Studio
// majors 15–17 only, so the windows-11-arm image (VS 18) fails with
// "unknown version undefined". Node 26 ships node-gyp 12.4 or newer, which
// accepts VS 2026. Invoke node-pty's own install.js (it still clears the
// Node 26 LTO flags) through a shim that points at Node's copy.

import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export function nodeGypSupportsVisualStudio2026(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "")
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 12 || (major === 12 && minor >= 1)
}

export function bundledNodeGypCandidates(execPath) {
  const binDir = dirname(execPath)
  return [
    join(binDir, "node_modules", "npm", "node_modules", "node-gyp", "bin", "node-gyp.js"),
    join(binDir, "..", "lib", "node_modules", "npm", "node_modules", "node-gyp", "bin", "node-gyp.js"),
    // Homebrew keeps npm under libexec rather than the standard Unix lib directory.
    join(binDir, "..", "libexec", "lib", "node_modules", "npm", "node_modules", "node-gyp", "bin", "node-gyp.js"),
  ]
}

export function readNodeGypVersion(gypPath, readFile = readFileSync) {
  const manifest = JSON.parse(readFile(join(dirname(gypPath), "..", "package.json"), "utf8"))
  return manifest.version
}

export function selectNodeGyp({
  execPath = process.execPath,
  env = process.env,
  exists = existsSync,
  readVersion = readNodeGypVersion,
} = {}) {
  const override = env.AX_CODE_NODE_GYP?.trim()
  if (override) return override
  for (const candidate of bundledNodeGypCandidates(execPath)) {
    if (!exists(candidate)) continue
    if (nodeGypSupportsVisualStudio2026(readVersion(candidate))) return candidate
  }
  return undefined
}

export function windowsNodeGypShim(nodePath, gypPath) {
  return `@echo off\r\n"${nodePath}" "${gypPath}" %*\r\n`
}

export function posixNodeGypShim(nodePath, gypPath) {
  return `#!/bin/sh\nexec "${nodePath}" "${gypPath}" "$@"\n`
}

export function rebuildNodePty({
  execPath = process.execPath,
  ptyDir = join(repoRoot, "packages", "ax-code", "node_modules", "node-pty-prebuilt-multiarch"),
  env = process.env,
  platform = process.platform,
  spawn = spawnSync,
  exists = existsSync,
  readVersion = readNodeGypVersion,
  mkdtemp = mkdtempSync,
  writeFile = writeFileSync,
  chmod = chmodSync,
  rm = rmSync,
} = {}) {
  const gypPath = selectNodeGyp({ execPath, env, exists, readVersion })
  if (!gypPath || !exists(gypPath)) {
    throw new Error(
      "Could not find a node-gyp that recognizes Visual Studio 2026 (12.1.0 or newer). Expected Node's bundled copy beside npm.",
    )
  }
  const version = readVersion(gypPath)
  if (!nodeGypSupportsVisualStudio2026(version)) {
    throw new Error(`node-gyp ${version} cannot detect Visual Studio 2026 (need 12.1.0 or newer): ${gypPath}`)
  }
  const install = join(ptyDir, "scripts", "install.js")
  if (!exists(install)) throw new Error(`node-pty install script is missing at ${install}`)

  const shimDir = mkdtemp(join(tmpdir(), "ax-code-node-gyp-"))
  try {
    const shimPath = join(shimDir, platform === "win32" ? "node-gyp.cmd" : "node-gyp")
    writeFile(
      shimPath,
      platform === "win32" ? windowsNodeGypShim(execPath, gypPath) : posixNodeGypShim(execPath, gypPath),
    )
    if (platform !== "win32") chmod(shimPath, 0o755)
    const pathKey = platform === "win32" ? "Path" : "PATH"
    const current = env[pathKey] || env.PATH || ""
    const pathValue = `${shimDir}${delimiter}${current}`
    const childEnv = { ...env, npm_config_node_gyp: gypPath, [pathKey]: pathValue }
    if (platform === "win32") childEnv.PATH = pathValue
    const result = spawn(execPath, [install], { cwd: ptyDir, env: childEnv, stdio: "inherit" })
    if (result.status !== 0) throw new Error(`node-pty native build failed (exit ${result.status ?? "null"})`)
    return { nodeGyp: gypPath, version }
  } finally {
    rm(shimDir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const built = rebuildNodePty()
    console.log(`Rebuilt node-pty with node-gyp ${built.version}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
