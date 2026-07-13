/**
 * System-prompt render helpers for execution modes (ADR-049).
 */

import type { ModePolicy } from "./policy"

export namespace ModeProtocol {
  export function renderExecutionModes(input?: {
    defaultMode?: ModePolicy.ModeId
    councilEnabled?: boolean
    arenaEnabled?: boolean
    localAvailable?: boolean
  }): string {
    const defaultMode = input?.defaultMode ?? "hybrid"
    const council = input?.councilEnabled !== false
    const arena = input?.arenaEnabled === true
    const local = input?.localAvailable === true

    const lines = [
      `<execution_modes>`,
      `  Modes: local | cloud | hybrid | council | arena.`,
      `  Effective default mode: ${defaultMode}.`,
      local
        ? `  Local inference (AX Engine) is available — hybrid may place work locally for low/medium complexity.`
        : `  Local inference is not available — prefer cloud placement.`,
      council
        ? `  Use the council tool for multi-provider code-quality, security, or design review (advisory only).`
        : `  Council mode is disabled in config.`,
      arena
        ? `  Arena mode is enabled for multi-model contestants; rank by verification and diversity, not popularity.`
        : `  Arena mode is experimental/off unless enabled in config; prefer single-path implement + verify.`,
      `  Ensemble priority: when the user asks for council or arena, call that tool within the first 1–2 tool rounds.`,
      `  Do NOT run task_parallel or multi-explore monorepo digs before council/arena — put a short brief in the tool context instead.`,
      `  task_parallel is for parallel file digs only; it is not a multi-provider ensemble and must not replace council/arena.`,
      `  Never treat multi-model agreement on a patch as proof of correctness — run tests / verify_project.`,
      `  Do not fan out concurrent writers on the main workspace; use explore parallelism or worktree implement arena.`,
      `</execution_modes>`,
    ]
    return lines.join("\n")
  }
}
