// `testing` subpath entry — in-memory fakes for injected builds and tests.
//
// These let a host run the wiki compiler with no filesystem, git, or network, and
// let consumers exercise truthful completeness states. They are intentionally simple.

import { emptyEvidenceBundle } from "./contracts.js"
import type { Completeness, EvidenceBundle, Provenance } from "./contracts.js"
import type { EvidenceProvider } from "./ports.js"

/**
 * `EvidenceProvider` returning a fixed bundle, or an empty-but-truthful bundle for a
 * given completeness state. Useful for asserting that unsupported/failed/zero-result
 * states propagate instead of being coerced to a silent empty success.
 */
export function createStaticEvidenceProvider(input: {
  bundle?: EvidenceBundle
  completeness?: Completeness
  provenance?: Provenance
}): EvidenceProvider {
  const provenance: Provenance = input.provenance ?? {
    producer: "ax-wiki-testing",
    producerVersion: "0.0.0",
    method: "injected",
  }
  return {
    async provide(ctx) {
      return (
        input.bundle ??
        emptyEvidenceBundle({ root: ctx.root, completeness: input.completeness ?? "complete", provenance })
      )
    },
  }
}
