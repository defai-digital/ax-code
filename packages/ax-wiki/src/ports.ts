// Injection ports for the AX Wiki compiler.
//
// The reusable `core` (buildPure + contracts) never touches the filesystem, git, or
// the network directly. All effects cross injected callbacks (`evidenceReader`,
// `readExistingPage`, `generator`) or these ports, which the host (AX Code, a
// Node CLI, or an in-memory test) implements. This is what lets the compiler run
// fully injected and keeps the import-boundary invariant enforceable.

import type { EvidenceBundle } from "./contracts.js"
import type { WikiPlanPage, WikiSource } from "./types.js"

/**
 * Supplies typed semantic evidence for a page. Replaces the legacy opaque
 * `graphContext?: string` callback: evidence crosses as an `EvidenceBundle` with
 * provenance, completeness, and freshness — never as an opaque string.
 */
export type EvidenceProvider = {
  provide(input: { root: string; page: WikiPlanPage; sources: WikiSource[] }): Promise<EvidenceBundle>
}
