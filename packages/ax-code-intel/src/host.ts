// Host port for @ax-code/ax-code-intel.
//
// The package is a generic LSP client/server orchestration layer and must not
// depend on the ax-code core. Everything environment-specific (workspace
// paths, runtime executables, feature flags, file discovery, the graph-backed
// result cache) is injected through this port. The ax-code core wires a
// concrete implementation at boot; future projects provide their own.
//
// configureCodeIntelHost() must be called once before any LSP API is used.

export type LspCapabilityHints = {
  hover?: boolean
  definition?: boolean
  references?: boolean
  implementation?: boolean
  documentSymbol?: boolean
  workspaceSymbol?: boolean
  callHierarchy?: boolean
}

// Structural mirror of the core config `lsp` section (config schema). Kept
// structural so the package does not depend on the core config module.
export type LspServerOverride =
  | { disabled: true }
  | {
      command?: string[]
      extensions?: string[]
      languageId?: string
      disabled?: boolean
      semantic?: boolean
      priority?: number
      concurrency?: number
      capabilities?: LspCapabilityHints
      env?: Record<string, string>
      initialization?: Record<string, unknown>
    }

export type LspConfigSection = false | Record<string, LspServerOverride> | undefined

export type LspCacheCompleteness = "full" | "partial" | "empty"

export type LspCacheEnvelope<T> = {
  data: T
  source: "cache"
  completeness: LspCacheCompleteness
  timestamp: number
  serverIDs: string[]
  cacheKey?: string
  degraded?: boolean
}

export type LspCacheWritableEnvelope = {
  data: unknown
  completeness: LspCacheCompleteness
  serverIDs: string[]
}

export type LspCacheOperation = string

// Persistence port for LSP result envelopes. In ax-code this is backed by the
// code-intelligence graph database; other projects may omit it (the cache is
// then simply disabled) or provide their own store.
export type LspCacheStore = {
  enabled(override?: boolean): boolean
  hashFile(file: string): Promise<string | undefined>
  lookup<T>(input: {
    operation: LspCacheOperation
    filePath: string
    contentHash: string
    line: number
    character: number
    enabled: boolean
  }): LspCacheEnvelope<T> | undefined
  write(input: {
    operation: LspCacheOperation
    filePath: string
    contentHash: string
    line: number
    character: number
    envelope: LspCacheWritableEnvelope
    enabled: boolean
  }): void
}

export type KillableProcess = {
  pid?: number
  kill: (signal?: NodeJS.Signals | number) => boolean | void
}

export type CodeIntelRuntime = {
  // The active JS runtime executable (bun or node).
  executable(): string
  // Which package manager flavour the runtime uses.
  kind(): "bun" | "node"
  // Executable used to install packages (e.g. "npm").
  npmExecutable(): string
  // Command prefix for running published JS tools (npx --yes / bun x).
  toolRunner(): { command: string[]; environment?: Record<string, string> }
}

// All path/flag/config members are getters, not captured values: the host may
// serve multiple workspaces over its lifetime (the ax-code core resolves them
// from the active project-instance context), so they must be read on demand.
export type CodeIntelHost = {
  // Workspace root the LSP servers operate on.
  projectRoot(): string
  // Git worktree root (may equal projectRoot).
  worktreeRoot(): string
  // Directory where LSP server binaries are installed.
  binDir(): string
  // User home directory.
  homeDir(): string
  flags(): {
    disableLspDownload: boolean
    experimentalLspTy: boolean
  }
  // The host's LSP configuration section.
  lspConfig(): Promise<{ lsp?: LspConfigSection }>
  runtime: CodeIntelRuntime
  // Kill a process tree (graceful SIGTERM with escalation).
  killTree(proc: KillableProcess, opts?: { exited?: () => boolean; signal?: NodeJS.Signals | number }): Promise<void>
  // Enumerate workspace files (relative paths), used to probe languages.
  listFiles(input: { cwd: string; limit: number }): AsyncIterable<string>
  // Subscribe to project root marker file changes (package.json, lockfiles...).
  // Returns an unsubscribe function.
  subscribeRootMarkerChange(callback: (file: string) => void): () => void
  // Publish the "lsp.updated" event on the host's event bus. The host is
  // responsible for registering the event definition with its own bus so it
  // appears in event contracts (e.g. SSE/OpenAPI).
  publishUpdated(): void
  // Publish the "lsp.client.diagnostics" event on the host's event bus
  // (emitted whenever a language server pushes diagnostics for a file).
  publishClientDiagnostics(payload: { serverID: string; path: string }): void
  // Optional graph-backed result cache.
  cacheStore?: LspCacheStore
  // Per-workspace memoized state container (init runs once per workspace).
  state<S>(
    init: () => S,
    dispose?: (state: Awaited<S>) => Promise<void>,
  ): (() => S) & { invalidate: () => Promise<void> }
}

let current: CodeIntelHost | undefined

export function configureCodeIntelHost(host: CodeIntelHost): void {
  current = host
}

export function codeIntelHost(): CodeIntelHost {
  if (!current) {
    throw new Error("@ax-code/ax-code-intel is not configured: call configureCodeIntelHost() before using the LSP API")
  }
  return current
}

export function codeIntelHostMaybe(): CodeIntelHost | undefined {
  return current
}
