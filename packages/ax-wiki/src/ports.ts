// Injection ports for the AX Wiki compiler.
//
// The reusable `core` (buildPure + contracts) never touches the filesystem, git, or
// the network directly. All effects cross these ports, which the host (AX Code, a
// Node CLI, or an in-memory test) implements. This is what lets the compiler run
// fully injected and keeps the import-boundary invariant enforceable.

import type { EvidenceBundle } from "./contracts.js"
import type { WikiPlanPage, WikiSource } from "./types.js"

/**
 * Lists and reads repository sources. The Node implementation wraps `git ls-files`
 * (with a walk fallback) and bounded file reads; tests supply in-memory sources.
 */
export type SourceProvider = {
  list(input: { root: string; wikiDir: string }): Promise<WikiSource[]>
  read(input: {
    root: string
    path: string
    maxBytes: number
  }): Promise<{ text: string; bytes: number; truncated: boolean } | undefined>
}

/**
 * Reads and writes wiki artifacts (pages, manifest). Implementations must make
 * `write` atomic. `lock` is optional and, when provided, must follow the shared
 * host/PID/staleness advisory-lock contract (see code-intelligence/lockfile.ts).
 */
export type ArtifactStore = {
  read(input: { root: string; relativePath: string }): Promise<string | undefined>
  write(input: { root: string; relativePath: string; content: string }): Promise<void>
  remove(input: { root: string; relativePath: string }): Promise<void>
  lock?(input: { root: string }): Promise<{ release(): Promise<void> }>
}

/**
 * Supplies typed semantic evidence for a page. Replaces the legacy opaque
 * `graphContext?: string` callback: evidence crosses as an `EvidenceBundle` with
 * provenance, completeness, and freshness — never as an opaque string.
 */
export type EvidenceProvider = {
  provide(input: { root: string; page: WikiPlanPage; sources: WikiSource[] }): Promise<EvidenceBundle>
}
