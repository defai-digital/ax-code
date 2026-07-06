#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const nodeName = process.platform === "win32" ? "node.exe" : "node"
const ffiArgs = ["--experimental-ffi", "--disable-warning=ExperimentalWarning"]

function inspectNode(candidate) {
  const result = spawnSync(
    candidate,
    [
      ...ffiArgs,
      "-e",
      "require('node:ffi'); process.stdout.write([process.version, process.platform, process.arch].join('\\n'))",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    },
  )
  if (result.status !== 0) return
  const [version, platform, arch] = String(result.stdout).trim().split("\n")
  if (!version || !platform || !arch) return
  return { path: candidate, version, platform, arch }
}

function pathCandidates() {
  const common = process.platform === "darwin" ? ["/opt/homebrew/bin/node", "/usr/local/bin/node"] : []
  return [
    process.execPath,
    ...String(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry) => path.join(entry, nodeName)),
    ...common,
  ]
}

function uniqueExisting(candidates) {
  const seen = new Set()
  const out = []
  for (const candidate of candidates) {
    let real
    try {
      real = fs.realpathSync(candidate)
    } catch {
      continue
    }
    if (seen.has(real)) continue
    seen.add(real)
    out.push(candidate)
  }
  return out
}

function resolveFfiNode() {
  const explicit = process.env.AX_CODE_FFI_NODE
  if (explicit) {
    const runtime = inspectNode(explicit)
    if (!runtime) {
      throw new Error(`AX_CODE_FFI_NODE does not support node:ffi: ${explicit}`)
    }
    return runtime
  }

  const inspected = []
  for (const candidate of uniqueExisting(pathCandidates())) {
    const runtime = inspectNode(candidate)
    if (!runtime) {
      inspected.push(`${candidate} (no node:ffi support)`)
      continue
    }
    return runtime
  }

  throw new Error(
    [
      "AX Code TUI requires a Node runtime with node:ffi support.",
      "Install/use Node 26+, or set AX_CODE_FFI_NODE to a Node 26+ executable.",
      inspected.length ? `Inspected candidates:\n  - ${inspected.join("\n  - ")}` : "No Node candidates were found.",
    ].join("\n"),
  )
}

let runtime
try {
  runtime = resolveFfiNode()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const result = spawnSync(runtime.path, [...ffiArgs, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.signal) {
  process.kill(process.pid, result.signal)
}
process.exit(result.status ?? 1)
