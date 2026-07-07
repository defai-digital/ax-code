import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const FFI_ARGS = ["--experimental-ffi", "--disable-warning=ExperimentalWarning"]
const NODE_NAME = process.platform === "win32" ? "node.exe" : "node"

let cachedFfiNode: string | undefined

function inspectNode(candidate: string): boolean {
  const result = spawnSync(
    candidate,
    [
      ...FFI_ARGS,
      "-e",
      "require('node:ffi'); process.stdout.write([process.version, process.platform, process.arch].join('\\n'))",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    },
  )
  return result.status === 0
}

function pathCandidates(): string[] {
  const common = process.platform === "darwin" ? ["/opt/homebrew/bin/node", "/usr/local/bin/node"] : []
  return [
    process.env.AX_CODE_FFI_NODE,
    process.execPath,
    ...String(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry) => path.join(entry, NODE_NAME)),
    ...common,
  ].filter((candidate): candidate is string => !!candidate)
}

function uniqueExisting(candidates: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of candidates) {
    let real: string
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

export function resolveFfiNode(): string {
  if (cachedFfiNode) return cachedFfiNode
  const explicit = process.env.AX_CODE_FFI_NODE
  if (explicit) {
    if (!inspectNode(explicit)) {
      throw new Error(`AX_CODE_FFI_NODE does not support node:ffi: ${explicit}`)
    }
    cachedFfiNode = explicit
    return explicit
  }

  const inspected: string[] = []
  for (const candidate of uniqueExisting(pathCandidates())) {
    if (inspectNode(candidate)) {
      cachedFfiNode = candidate
      return candidate
    }
    inspected.push(`${candidate} (no node:ffi support)`)
  }
  throw new Error(
    [
      "AX Code native-render tests require a Node runtime with node:ffi support.",
      "Install/use Node 26+, or set AX_CODE_FFI_NODE to a Node 26+ executable.",
      inspected.length ? `Inspected candidates:\n  - ${inspected.join("\n  - ")}` : "No Node candidates were found.",
    ].join("\n"),
  )
}

export function runFfiNode(
  args: string[],
  options: {
    cwd: string
    env?: Record<string, string | undefined>
    timeout?: number
  },
): SpawnSyncReturns<string> {
  return spawnSync(resolveFfiNode(), [...FFI_ARGS, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    timeout: options.timeout,
  })
}
