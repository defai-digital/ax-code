/**
 * Context Tier Classification — assigns a priority tier to each message/part
 * so that compaction removes the least-relevant content first.
 *
 * Tiers:
 * - Tier 1 (critical): Current task, recent tool results, active file content
 * - Tier 2 (supporting): Related symbols, caller/callee chains, dependency context
 * - Tier 3 (background): Historical conversation, old summaries, reference docs
 *
 * The compaction prune function uses these tiers to decide which parts to
 * remove first, rather than purely recency-based pruning.
 */

import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"
import { Log } from "../util/log"

export namespace ContextTier {
  const log = Log.create({ service: "context-tier" })

  export type Tier = 1 | 2 | 3

  export interface ClassifiedMessage {
    message: MessageV2.WithParts
    tier: Tier
    reason: string
  }

  /** Classify all messages in a session into tiers.
   *  Tier 1 = last 2 turns + tool results referencing currently open files
   *  Tier 2 = turns 3-5 + code intelligence results
   *  Tier 3 = everything else (compaction summaries, old tool results)
   */
  export function classify(
    messages: MessageV2.WithParts[],
    opts?: { recentTurns?: number; supportingTurns?: number },
  ): ClassifiedMessage[] {
    const recentTurns = opts?.recentTurns ?? 2
    const supportingTurns = opts?.supportingTurns ?? 3

    // Count turns from the end to determine tier boundaries
    const turnBoundaries = computeTurnBoundaries(messages, recentTurns, supportingTurns)

    return messages.map((msg, idx) => {
      const tier = classifyMessage(msg, idx, turnBoundaries)
      return { message: msg, tier, reason: tierReason(msg, tier) }
    })
  }

  interface TurnBoundaries {
    tier1Start: number // messages from this index onward are Tier 1
    tier2Start: number // messages from this index onward are Tier 2 (before tier1Start)
  }

  function computeTurnBoundaries(
    messages: MessageV2.WithParts[],
    recentTurns: number,
    supportingTurns: number,
  ): TurnBoundaries {
    let userTurnCount = 0
    let tier1Start = 0
    let tier2Start = 0

    // Count from the end
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].info.role === "user") {
        userTurnCount++
        if (userTurnCount === recentTurns) tier1Start = i
        if (userTurnCount === recentTurns + supportingTurns) tier2Start = i
      }
    }

    return { tier1Start, tier2Start }
  }

  function classifyMessage(msg: MessageV2.WithParts, idx: number, boundaries: TurnBoundaries): Tier {
    // Always Tier 1: messages within recent turns
    if (idx >= boundaries.tier1Start) return 1

    // Within supporting turns: check content type
    if (idx >= boundaries.tier2Start) {
      // Code intelligence results and file edits are Tier 2
      if (isCodeIntelligenceResult(msg) || isFileEditResult(msg)) return 2
      // Compaction summaries are Tier 3
      if (isCompactionSummary(msg)) return 3
      // Default to Tier 2 for supporting range
      return 2
    }

    // Beyond supporting turns: mostly Tier 3
    // But keep file edits and code intelligence as Tier 2 if they're important
    if (isFileEditResult(msg) || isCodeIntelligenceResult(msg)) return 2
    return 3
  }

  function isCodeIntelligenceResult(msg: MessageV2.WithParts): boolean {
    return msg.parts.some(
      (p) =>
        p.type === "tool" &&
        p.state.status === "completed" &&
        (p.tool === "code_intelligence" ||
          p.tool === "findSymbol" ||
          p.tool === "findReferences" ||
          p.tool === "findCallers"),
    )
  }

  function isFileEditResult(msg: MessageV2.WithParts): boolean {
    return msg.parts.some(
      (p) =>
        p.type === "tool" &&
        p.state.status === "completed" &&
        (p.tool === "edit" || p.tool === "write" || p.tool === "apply_patch"),
    )
  }

  function isCompactionSummary(msg: MessageV2.WithParts): boolean {
    return msg.parts.some((p) => p.type === "compaction") || (msg.info as any).summary === true
  }

  function tierReason(msg: MessageV2.WithParts, tier: Tier): string {
    if (tier === 1) return "within recent turns"
    if (tier === 2) {
      if (isCodeIntelligenceResult(msg)) return "code intelligence result"
      if (isFileEditResult(msg)) return "file edit result"
      return "within supporting turns"
    }
    return "historical content"
  }

  /** Get the tier distribution for a message set. */
  export function distribution(classified: ClassifiedMessage[]) {
    let tier1 = 0
    let tier2 = 0
    let tier3 = 0
    for (const c of classified) {
      if (c.tier === 1) tier1++
      else if (c.tier === 2) tier2++
      else tier3++
    }
    return { tier1, tier2, tier3, total: classified.length }
  }
}
