/**
 * Reflection prompt builder for self-correction
 * Ported from ax-cli's reflection-prompts.ts
 *
 * Generates contextual prompts that help the LLM analyze failures and propose fixes
 */

import type { FailureSignal, RecoveryStrategy } from "./detector"

const STRATEGY_GUIDES: Record<RecoveryStrategy, string> = {
  retry: "Try the same operation again. If the error persists, consider a different approach.",
  reread_and_retry:
    "Re-read the file to get its current content, then retry the operation with the correct data. Do not guess — always verify before editing.",
  search_alternative:
    "The target was not found. Search for alternative paths or names. Use glob or grep to locate the correct file or content.",
  broaden_search:
    "The search returned no results. Try broader terms, partial matches, or search in parent directories. Consider alternative naming conventions.",
  simplify:
    "The operation was too broad or complex. Break it into smaller, simpler steps. Try a more specific pattern or smaller scope.",
  different_approach:
    "The current approach is not working. Step back and consider a fundamentally different strategy to achieve the same goal.",
  verify_first:
    "Check prerequisites before retrying. Verify the file exists, read its content, and confirm your assumptions match reality.",
  escalate:
    "This failure cannot be recovered automatically. Inform the user about the issue and suggest manual steps they can take.",
}

/**
 * Build a reflection prompt for the LLM to analyze a failure
 * Injected as a synthetic user message before the next LLM turn
 */
export function build(signal: FailureSignal, recentContext?: string): string {
  const parts: string[] = []

  parts.push(`[Self-Correction] The \`${signal.toolName}\` operation failed.`)
  parts.push("")
  parts.push(`**Error:** ${signal.error}`)
  parts.push(`**Attempt:** ${signal.attempt} of ${signal.maxRetries + 1}`)
  parts.push(`**Strategy:** ${signal.strategy}`)
  parts.push("")
  parts.push("**What to do:**")
  parts.push(STRATEGY_GUIDES[signal.strategy])

  if (signal.suggestion) {
    parts.push("")
    parts.push(`**Hint:** ${signal.suggestion}`)
  }

  if (recentContext) {
    parts.push("")
    parts.push("**Recent context:**")
    parts.push(recentContext)
  }

  parts.push("")
  parts.push("Analyze what went wrong, then take the corrected action. Do not repeat the exact same failing operation.")

  return parts.join("\n")
}

/**
 * Build a quick one-line reflection for simple retries
 */
export function quick(signal: FailureSignal): string {
  return `The \`${signal.toolName}\` operation failed: ${signal.error}. This has happened ${signal.attempt} time(s). ${signal.suggestion}`
}
