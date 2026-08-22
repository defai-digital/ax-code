// Minimal CodeIntelHost implementation for the perf harness. The intel
// package is host-agnostic: everything environment-specific is injected
// through this port, so the harness can drive the real production spawn /
// client / query path without the ax-code core.
//
// Deliberate choices:
// - disableLspDownload: true — the harness measures what is installed, it
//   never auto-installs servers mid-run.
// - An optional in-memory cache store backs the cache-hit-rate scenario
//   (in ax-code this port is served by the code-intelligence graph DB).
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { configureCodeIntelHost } from "../../src/host"
import type { CodeIntelHost, LspCacheStore } from "../../src/host"
import { killTree } from "./spawn"

const IGNORED_DIRS = new Set([".git", "node_modules", "target", "dist", "__pycache__", ".venv"])

async function* walk(dir: string, root: string, state: { seen: number; limit: number }): AsyncIterable<string> {
  if (state.seen >= state.limit) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (state.seen >= state.limit) return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      yield* walk(full, root, state)
    } else if (entry.isFile()) {
      state.seen++
      yield path.relative(root, full)
    }
  }
}

// In-memory LspCacheStore. Key shape mirrors how the cache probe scopes
// entries; correctness of the keying itself is covered by the core cache
// tests — here we only need a faithful lookup/write port.
type LookupInput = Parameters<LspCacheStore["lookup"]>[0]
type WriteInput = Parameters<LspCacheStore["write"]>[0]

const cacheKey = (input: {
  operation: string
  filePath: string
  contentHash: string
  line: number
  character: number
}) => `${input.operation}:${input.filePath}:${input.contentHash}:${input.line}:${input.character}`

export function createMemoryCacheStore(): LspCacheStore {
  const entries = new Map<string, { envelope: WriteInput["envelope"]; timestamp: number }>()
  return {
    // Default-off: only callers that explicitly pass `cache: true` (the
    // hit-rate scenario) use the store. This keeps warm-query measurements
    // from accidentally collapsing into cache hits.
    enabled: (override) => override ?? false,
    async hashFile(file) {
      const content = await readFile(file).catch(() => undefined)
      if (!content) return undefined
      return createHash("sha256").update(content).digest("hex")
    },
    lookup<T>(input: LookupInput) {
      if (!input.enabled) return undefined
      const hit = entries.get(cacheKey(input))
      if (!hit) return undefined
      return {
        data: hit.envelope.data as T,
        source: "cache" as const,
        completeness: hit.envelope.completeness,
        timestamp: hit.timestamp,
        serverIDs: hit.envelope.serverIDs,
      }
    },
    write(input: WriteInput) {
      if (!input.enabled) return
      entries.set(cacheKey(input), { envelope: input.envelope, timestamp: Date.now() })
    },
  }
}

export function createPerfHost(root: string): CodeIntelHost {
  return {
    projectRoot: () => root,
    worktreeRoot: () => root,
    binDir: () => path.join(root, ".ax-code-perf", "bin"),
    homeDir: () => os.homedir(),
    flags: () => ({ disableLspDownload: true, experimentalLspTy: false }),
    lspConfig: async () => ({}),
    runtime: {
      executable: () => process.execPath,
      kind: () => "node",
      npmExecutable: () => "npm",
      toolRunner: () => ({ command: ["npx", "--yes"] }),
    },
    killTree: (proc, killOpts) => killTree(proc, killOpts),
    listFiles: (input) => walk(input.cwd, input.cwd, { seen: 0, limit: input.limit }),
    subscribeRootMarkerChange: () => () => {},
    subscribeFileChange: () => () => {},
    publishUpdated: () => {},
    publishClientDiagnostics: () => {},
    cacheStore: createMemoryCacheStore(),
    state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
      let value: S | undefined
      const fn = (() => (value ??= init())) as (() => S) & { invalidate: () => Promise<void> }
      fn.invalidate = async () => {
        if (value === undefined) return
        const current = value
        value = undefined
        await dispose?.(await current)
      }
      return fn
    },
  }
}

export function configurePerfHost(root: string): CodeIntelHost {
  const host = createPerfHost(root)
  configureCodeIntelHost(host)
  return host
}
