/**
 * Memory threat-pattern scanner (ADR-206).
 *
 * Memory entries persist across sessions and are injected into later system
 * prompts, so a hostile or manipulated entry can smuggle instructions into
 * future sessions. This scanner is a heuristic tripwire over the known
 * prompt-injection shapes: instruction overrides, role reassignment,
 * concealment from the user, secret exfiltration to URLs, and hidden
 * Unicode. A flagged entry is stored but excluded from injection and listed
 * by `memory doctor` — nothing is silently dropped, and a false positive
 * only hides an entry until the user edits it.
 *
 * These are heuristics: they reduce, never remove, injection risk, and must
 * not be documented as a security guarantee.
 */

import { detectHiddenUnicode } from "../util/untrusted-content"
import type { MemoryEntry } from "./types"

export interface MemoryThreatMatch {
  /** Stable pattern id, persisted with the entry and shown by doctor. */
  pattern: string
  /** Human-readable reason — static text, never entry content. */
  reason: string
}

interface ThreatPattern {
  pattern: string
  reason: string
  test: RegExp
}

// Leading word boundaries live INSIDE the group: the `\.env` alternative
// starts with a dot and typically follows a space, where `\b` would never
// hold (a boundary needs a word character on one side).
const SECRET_WORDS = String.raw`(?:\b(?:api\s*keys?|tokens?|secrets?|passwords?|passphrases?|credentials?|private\s+keys?)|\.env\s+files?)`
const URL_WORDS = String.raw`https?:\/\/`

const THREAT_PATTERNS: ThreatPattern[] = [
  {
    pattern: "instruction_override",
    reason: "attempts to override or discard prior instructions",
    test: new RegExp(
      String.raw`\b(?:ignore|disregard|forget|discard)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|earlier|above|preceding)\s+(?:instructions?|prompts?|rules?|directions?|directives?|guardrails?)\b`,
      "i",
    ),
  },
  {
    pattern: "role_reassignment",
    reason: "reassigns the assistant's role or persona",
    test: /\byou\s+are\s+now\s+(?:a|an|the)\s+\w|\bfrom\s+now\s+on\s+you\s+(?:are|will\s+be)\s+(?:a|an|the)\s+\w|\bpretend\s+to\s+be\b|\bact\s+as\s+if\s+you\s+(?:were|are)\b|\byour\s+new\s+(?:role|persona|identity)\s+(?:is|are)\b/i,
  },
  {
    pattern: "concealment",
    reason: "instructs hiding actions or information from the user",
    test: /\b(?:do\s+not|don't|never)\s+tell\s+the\s+user\b|\bwithout\s+telling\s+the\s+user\b|\bhide\s+(?:this|it|these)\s+from\s+the\s+user\b|\bkeep\s+(?:this|it)\s+secret\s+from\s+the\s+user\b/i,
  },
  {
    pattern: "exfiltration",
    reason: "sends secrets or credentials to an external URL",
    // One sentence-sized window between the action verb, the secret, and the
    // URL keeps ordinary "we keep tokens in the vault, see https://…" notes
    // from matching.
    test: new RegExp(
      String.raw`\b(?:send|sends|sent|post|posts|upload|uploads|transmit|transmits|exfiltrate|exfiltrates|fetch|fetches|curl|wget|include|includes|append|appends|embed|embeds|leak|leaks|forward|forwards)\b[^.]{0,80}${SECRET_WORDS}\b[^.]{0,80}${URL_WORDS}`,
      "i",
    ),
  },
]

/** Scan arbitrary memory text for threat patterns and hidden Unicode. */
export function scanMemoryText(text: string): MemoryThreatMatch[] {
  const matches: MemoryThreatMatch[] = []
  for (const { pattern, reason, test } of THREAT_PATTERNS) {
    if (test.test(text)) matches.push({ pattern, reason })
  }
  if (detectHiddenUnicode(text) > 0) {
    matches.push({
      pattern: "hidden_unicode",
      reason: "contains hidden Unicode characters that can disguise or reorder text",
    })
  }
  return matches
}

/**
 * Scan every field of a memory entry that is injected into prompts
 * (name, body, why, howToApply). Metadata like tags and path globs is
 * rendered too, but never as free prose, and stays out of the scan.
 */
export function scanMemoryEntry(entry: Pick<MemoryEntry, "name" | "body" | "why" | "howToApply">): MemoryThreatMatch[] {
  return scanMemoryText([entry.name, entry.body, entry.why ?? "", entry.howToApply ?? ""].join("\n"))
}
