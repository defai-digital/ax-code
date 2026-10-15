import { createHash } from "node:crypto"

// Local-only content fingerprint. The hash never leaves the process — it only
// keys the caches and compares previous text against the current text to skip
// redundant diagnostics work. We use a SHA-256 prefix instead of Bun.hash so
// the code path stays bun-runtime-agnostic; the algorithm choice does not
// affect correctness because both producer and comparer always use the same
// function.
export function fingerprintHash(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}
