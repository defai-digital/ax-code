// Per-session anchor ledger (ADR-139 D2). Successful provider responses with
// EXACT usage become "anchors": measured input-side token counts keyed by a
// content fingerprint (ordered message IDs + session revision + tool-schema
// and system-prompt hashes) in a bounded ring. Nothing is attached to
// assistant messages — compaction rewrites history, and message-attached
// state would silently corrupt. The ledger is derived state keyed by
// content, so fork/replay are safe.
//
// Anchors are INPUT-SIDE ONLY (input + cache read + cache write). Step totals
// that include output/reasoning must never anchor: they double-count the
// previous turn's generation and drift with every step.

import { createHash } from "node:crypto"
import type { ModelMessage } from "ai"
import { TokenEstimate } from "./token-estimate"
import { usageSource, type UsageSource } from "./usage"

export namespace TokenLedger {
  // `${providerID}/${resolvedModelID}` (+ endpoint origin for custom
  // OpenAI-compatible providers); see ObservedWindow.routeKeyFor.
  export type RouteKey = string

  export type Anchor = {
    prefixFingerprint: string
    measuredInputTokens: number
    routeKey: RouteKey
    at: number
  }

  export type LedgerBreakdown = {
    measured: number
    estimated: number
    cache: { read: number; write: number }
    media: number
    total: number
    strategy: "measured+estimated" | "measured" | "estimated"
    confidence: number
  }

  export const ANCHOR_RING_MAX = 8

  // EWMA drift coefficient per route (reported/predicted). Bounds the
  // estimator bias; in-memory only by design.
  export const DRIFT_ALPHA = 0.3
  export const DRIFT_MIN = 0.5
  export const DRIFT_MAX = 2.0

  export function sha256(input: string): string {
    return createHash("sha256").update(input).digest("hex")
  }

  export type FingerprintInput = {
    messageIDs: readonly string[]
    revision: string
    toolSchemaHash: string
    systemHash: string
  }

  /** Content fingerprint over message IDs + revision + hashes only — never bodies. */
  export function fingerprint(input: FingerprintInput): string {
    return sha256(
      [input.messageIDs.join("\n"), input.revision, input.toolSchemaHash, input.systemHash].join("\n"),
    )
  }

  export function systemHashFor(system: readonly string[]): string {
    return sha256(system.join("\n"))
  }

  export function toolSchemaHashFor(
    tools: Iterable<{ id: string; description?: string; inputSchema: unknown }>,
  ): string {
    let serialized = ""
    for (const tool of tools) {
      serialized += JSON.stringify({
        name: tool.id,
        description: tool.description ?? "",
        parameters: tool.inputSchema,
      })
    }
    return sha256(serialized)
  }

  /** Record-shaped variant for AI SDK `Tool` maps keyed by tool name. */
  export function toolSchemaHashForRecord(
    tools: Record<string, { description?: string; inputSchema?: unknown }>,
  ): string {
    return toolSchemaHashFor(
      Object.entries(tools).map(([id, tool]) => ({
        id,
        description: tool.description,
        inputSchema: tool.inputSchema ?? {},
      })),
    )
  }

  const driftByRoute = new Map<RouteKey, number>()

  /**
   * Update the per-route drift EWMA with one (predicted, reported) pair.
   * Ignores non-positive predictions and negative reports. Returns the new
   * coefficient, or the current one when the sample is unusable.
   */
  export function recordDrift(routeKey: RouteKey, predicted: number, reported: number): number {
    const current = driftByRoute.get(routeKey) ?? 1
    if (!Number.isFinite(predicted) || !Number.isFinite(reported) || predicted <= 0 || reported < 0) {
      return current
    }
    const ratio = reported / predicted
    const next = Math.min(DRIFT_MAX, Math.max(DRIFT_MIN, (1 - DRIFT_ALPHA) * current + DRIFT_ALPHA * ratio))
    driftByRoute.set(routeKey, next)
    return next
  }

  export function driftFor(routeKey: RouteKey): number {
    return driftByRoute.get(routeKey) ?? 1
  }

  /** Test-only: reset the in-memory per-route drift table. */
  export function _resetDrift(): void {
    driftByRoute.clear()
  }

  // Session revision: bumped when compaction rewrites history so pre-rewrite
  // anchors stop matching even if some message IDs survive.
  const revisions = new Map<string, number>()

  export function revisionFor(sessionID: string): string {
    return String(revisions.get(sessionID) ?? 0)
  }

  export function bumpRevision(sessionID: string): void {
    revisions.set(sessionID, (revisions.get(sessionID) ?? 0) + 1)
  }

  // One ledger per session, mirroring the tool-cycle-ring registry pattern.
  // LRU-bounded so long-lived servers don't accumulate unbounded ledgers for
  // every session ever touched; disposeSession cleans up on session removal.
  const LEDGER_REGISTRY_MAX = 64
  const ledgers = new Map<string, SessionTokenLedger>()

  export function forSession(sessionID: string): SessionTokenLedger {
    const existing = ledgers.get(sessionID)
    if (existing) {
      // Refresh recency (insertion order is the LRU order).
      ledgers.delete(sessionID)
      ledgers.set(sessionID, existing)
      return existing
    }
    const created = new SessionTokenLedger()
    ledgers.set(sessionID, created)
    while (ledgers.size > LEDGER_REGISTRY_MAX) {
      const oldest = ledgers.keys().next().value
      if (oldest === undefined) break
      ledgers.delete(oldest)
    }
    return created
  }

  export function disposeSession(sessionID: string): void {
    ledgers.delete(sessionID)
    revisions.delete(sessionID)
  }

  /** Test-only: drop every session ledger and revision. */
  export function _resetSessions(): void {
    ledgers.clear()
    revisions.clear()
  }

  export type AnchorUsage = {
    input: number
    cacheRead: number
    cacheWrite: number
    source: UsageSource
  }

  type AnchorEntry = Anchor & {
    messageIDs: readonly string[]
    revision: string
    toolSchemaHash: string
    systemHash: string
    cacheRead: number
    cacheWrite: number
  }

  export class SessionTokenLedger {
    private anchors: AnchorEntry[] = []
    // Last computed breakdown total — the best known prompt size for the
    // session, used as the failure-size estimate when an overflow needs
    // calibration evidence.
    private last: { total: number; at: number } | undefined

    /**
     * Record one successful response as an anchor. Input-side exact usage
     * only: estimated or missing usage never anchors. Returns the anchor, or
     * undefined when the usage was not usable.
     */
    recordAnchor(input: {
      messageIDs: readonly string[]
      revision: string
      toolSchemaHash: string
      systemHash: string
      usage: AnchorUsage
      routeKey: RouteKey
      at?: number
    }): Anchor | undefined {
      if (input.usage.source !== "exact") return undefined
      const inputTokens = Math.max(0, input.usage.input)
      const cacheRead = Math.max(0, input.usage.cacheRead)
      const cacheWrite = Math.max(0, input.usage.cacheWrite)
      const entry: AnchorEntry = {
        prefixFingerprint: fingerprint(input),
        measuredInputTokens: inputTokens + cacheRead + cacheWrite,
        routeKey: input.routeKey,
        at: input.at ?? Date.now(),
        messageIDs: [...input.messageIDs],
        revision: input.revision,
        toolSchemaHash: input.toolSchemaHash,
        systemHash: input.systemHash,
        cacheRead,
        cacheWrite,
      }
      this.anchors.push(entry)
      while (this.anchors.length > ANCHOR_RING_MAX) this.anchors.shift()
      this.last = { total: entry.measuredInputTokens, at: entry.at }
      return {
        prefixFingerprint: entry.prefixFingerprint,
        measuredInputTokens: entry.measuredInputTokens,
        routeKey: entry.routeKey,
        at: entry.at,
      }
    }

    /**
     * Find the newest anchor whose message IDs still form a prefix of the
     * current request (same order, same revision). `toolSchemaHash` and
     * `systemHash` further constrain the match when the caller knows them;
     * callers that cannot supply them (e.g. context_status) match on IDs and
     * revision only. Hash-checking callers get full invalidation on system or
     * tool-surface changes.
     *
     * The match also reports `hashVerified`: true only when the caller
     * supplied `systemHash` and it equals the entry's (plus `toolSchemaHash`
     * when supplied). A verified match proves the anchored measurement saw
     * the SAME system prompt and tool surface as the current request, so its
     * `measuredInputTokens` already covers them; an IDs-only match may hide a
     * system change underneath, so callers must treat the measurement as
     * covering messages only and keep estimating the system prompt.
     */
    private findEntry(input: {
      messageIDs: readonly string[]
      revision: string
      toolSchemaHash?: string
      systemHash?: string
    }): { entry: AnchorEntry; index: number; hashVerified: boolean } | undefined {
      for (let i = this.anchors.length - 1; i >= 0; i--) {
        const entry = this.anchors[i]!
        if (entry.revision !== input.revision) continue
        if (input.toolSchemaHash !== undefined && entry.toolSchemaHash !== input.toolSchemaHash) continue
        if (input.systemHash !== undefined && entry.systemHash !== input.systemHash) continue
        if (entry.messageIDs.length > input.messageIDs.length) continue
        let matches = true
        for (let j = 0; j < entry.messageIDs.length; j++) {
          if (entry.messageIDs[j] !== input.messageIDs[j]) {
            matches = false
            break
          }
        }
        if (!matches) continue
        const hashVerified =
          input.systemHash !== undefined &&
          entry.systemHash === input.systemHash &&
          (input.toolSchemaHash === undefined || entry.toolSchemaHash === input.toolSchemaHash)
        return { entry, index: entry.messageIDs.length - 1, hashVerified }
      }
      return undefined
    }

    findAnchor(input: {
      messageIDs: readonly string[]
      revision: string
      toolSchemaHash?: string
      systemHash?: string
    }): { anchor: Anchor; index: number; hashVerified: boolean } | undefined {
      const found = this.findEntry(input)
      if (!found) return undefined
      const { entry, index, hashVerified } = found
      return {
        anchor: {
          prefixFingerprint: entry.prefixFingerprint,
          measuredInputTokens: entry.measuredInputTokens,
          routeKey: entry.routeKey,
          at: entry.at,
        },
        index,
        hashVerified,
      }
    }

    /**
     * Breakdown for the current request prefix: measured tokens from the
     * newest matching anchor plus the drift-corrected estimate over the tail
     * after it. No match degrades to a fully estimated breakdown; the next
     * successful response re-anchors.
     *
     * System-prompt handling depends on match verification (see findEntry):
     * a hash-verified match proves the anchor's measured input already
     * covers the SAME system prompt and tool schemas, so the tail estimate
     * must pass `system: []` — counting system again would double-count it
     * against the measured share (and clamp completions too early). An
     * IDs-only match may hide a system change, so it keeps estimating the
     * system prompt conservatively.
     */
    current(input: {
      messageIDs: readonly string[]
      revision: string
      toolSchemaHash?: string
      systemHash?: string
      routeKey?: RouteKey
      tail: { system: string[]; messages: ModelMessage[] }
    }): LedgerBreakdown {
      const found = this.findEntry(input)
      const tailMessages = found ? input.tail.messages.slice(found.index + 1) : input.tail.messages
      const tailSystem = found?.hashVerified ? [] : input.tail.system
      const routeKey = input.routeKey ?? found?.entry.routeKey
      const base = TokenEstimate.requestTokens({ system: tailSystem, messages: tailMessages })
      const estimated = Math.round(base * (routeKey !== undefined ? driftFor(routeKey) : 1))
      const media = TokenEstimate.mediaTokenTotal(tailMessages)
      const measured = found?.entry.measuredInputTokens ?? 0
      const total = measured + estimated
      const strategy: LedgerBreakdown["strategy"] = found
        ? estimated > 0
          ? "measured+estimated"
          : "measured"
        : "estimated"
      const breakdown: LedgerBreakdown = {
        measured,
        estimated,
        cache: found ? { read: found.entry.cacheRead, write: found.entry.cacheWrite } : { read: 0, write: 0 },
        media,
        total,
        strategy,
        confidence: total > 0 ? measured / total : 0,
      }
      this.last = { total, at: Date.now() }
      return breakdown
    }

    /** Most recently computed prompt-size total for this session, if any. */
    lastTotal(): number | undefined {
      return this.last?.total
    }
  }

  /** Convenience: usage shape from the session-normalized step tokens. */
  export function anchorUsageFrom(input: {
    input: number
    cache: { read: number; write: number }
    source: UsageSource
  }): AnchorUsage {
    return {
      input: input.input,
      cacheRead: input.cache.read,
      cacheWrite: input.cache.write,
      source: input.source,
    }
  }

  /** Convenience: exact-only guard matching the anchoring rule. */
  export function isAnchorable(usage: unknown): boolean {
    return usageSource(usage) === "exact"
  }
}
