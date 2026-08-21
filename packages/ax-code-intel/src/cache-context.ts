// Cache-context fingerprinting for the LSP result cache.
//
// The result cache keys entries by (operation, file, content hash, position).
// A content hash alone is not a correct key: `references` results change when
// *other* files in the workspace change, and every result changes when the
// server set or the host's LSP configuration changes. This module computes
// the context that cache-probe folds into the key alongside the content hash:
//
//   <pinned-server fingerprint>:<lsp config fingerprint>[:gen<workspace generation>]
//
// The workspace generation is a monotonic counter bumped whenever a workspace
// file change is observed, through two channels:
//   - the host's file-watcher subscription (subscribeFileChange), the primary
//     channel
//   - the LSP clients themselves, when they push didChange / delete
//     notifications (covers environments where no watcher is running)
//
// Over-invalidation is safe — a cache miss just costs a live query.
// Under-invalidation is the bug this module exists to prevent.

import { createHash } from "node:crypto"
import { codeIntelHostMaybe } from "./host"
import { PINNED_GITHUB_LSP_RELEASES, PINNED_CHECKSUM_LSP_RELEASES, PINNED_DIRECT_LSP_RELEASES } from "./server-releases"

function fingerprintHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}

// Pinned server releases ship with the package, so this fingerprint only
// changes on a deliberate package update. Servers spawned from floating
// registry tools (e.g. `bun x typescript`) are not covered by it — the cache
// TTL bounds that residual staleness. User-configured server overrides *are*
// covered via the lspConfig fingerprint (the `lsp` section carries custom
// commands and initialization options).
const serverFingerprint = fingerprintHash(
  JSON.stringify({
    github: PINNED_GITHUB_LSP_RELEASES,
    checksum: PINNED_CHECKSUM_LSP_RELEASES,
    direct: PINNED_DIRECT_LSP_RELEASES,
  }),
)

let generation = 0

// Bump the workspace generation. Called by LSP clients when they observe a
// content change or deletion, and by the host file-watcher subscription.
export function noteWorkspaceChange(): void {
  generation += 1
}

// Per-workspace watcher subscription, held in the host's workspace-scoped
// state container so each active workspace gets its own subscription and
// teardown disposes it (the host bus keeps subscriptions per workspace).
let watcherState: ((() => unknown) & { invalidate: () => Promise<void> }) | undefined

function ensureWatcherSubscription(): void {
  const host = codeIntelHostMaybe()
  const subscribe = host?.subscribeFileChange
  if (!host || !subscribe) return
  watcherState ??= host.state(
    () => subscribe(() => noteWorkspaceChange()),
    async (unsubscribe) => {
      unsubscribe()
    },
  )
  try {
    watcherState()
  } catch {
    // No active workspace context (early boot, tests); the next call retries.
  }
}

// The context string cache-probe folds into cache keys. `references` is
// workspace-dependent, so its context includes the workspace generation;
// `documentSymbol` depends only on the file's own content (already hashed)
// plus the server/config environment, so unrelated edits don't bust it.
export async function contextFor(operation: string): Promise<string> {
  ensureWatcherSubscription()
  const host = codeIntelHostMaybe()
  const config = host
    ? await host
        .lspConfig()
        .then((cfg) => cfg.lsp)
        .catch(() => undefined)
    : undefined
  const parts = [serverFingerprint, fingerprintHash(JSON.stringify(config ?? null))]
  if (operation === "references") parts.push(`gen${generation}`)
  return parts.join(":")
}

// Compose the full cache-key hash the store sees: `<context>#<content-hash>`.
// The store treats it as opaque; rows written under an older context simply
// never match and age out via TTL.
export async function scopedHash(operation: string, contentHash: string): Promise<string> {
  return `${await contextFor(operation)}#${contentHash}`
}
