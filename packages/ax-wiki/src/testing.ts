// `testing` subpath entry — in-memory fakes for injected builds and tests.
//
// These let a host run the wiki compiler with no filesystem, git, or network, and
// let consumers exercise truthful completeness states. They are intentionally simple.

import { emptyEvidenceBundle } from "./contracts.js"
import type { Completeness, EvidenceBundle, Provenance, SourceCategory } from "./contracts.js"
import { sha256 } from "./hash.js"
import type { ArtifactStore, EvidenceProvider, SourceProvider } from "./ports.js"

const joinKey = (input: { root: string; relativePath: string }): string => `${input.root}\u0000${input.relativePath}`

/** In-memory `ArtifactStore` backed by a Map keyed by root + relative path. */
export function createInMemoryArtifactStore(): ArtifactStore & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    async read(input) {
      return files.get(joinKey(input))
    },
    async write(input) {
      files.set(joinKey(input), input.content)
    },
    async remove(input) {
      files.delete(joinKey(input))
    },
  }
}

/** In-memory `SourceProvider` over a path → content map. */
export function createInMemorySourceProvider(
  contents: Record<string, string>,
  categories: Record<string, SourceCategory> = {},
): SourceProvider {
  const entries = Object.entries(contents)
  return {
    async list() {
      return entries.map(([path, content]) => ({
        path,
        hash: sha256(content),
        bytes: Buffer.byteLength(content, "utf8"),
        category: categories[path] ?? ("code" as const),
      }))
    },
    async read(input) {
      const content = contents[input.path]
      if (content === undefined) return undefined
      const bytes = Buffer.byteLength(content, "utf8")
      const truncated = bytes > input.maxBytes
      return { text: truncated ? content.slice(0, input.maxBytes) : content, bytes, truncated }
    },
  }
}

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
