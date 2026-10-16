/**
 * Continuation prompts injected by the prompt loop in SUPERVISED
 * (non-autonomous) sessions. Kept as a sibling of
 * `prompt-autonomous-continuations.ts` so the neutral supervised wording is
 * never confused with the autonomous checkpoint/recovery phrasing: a
 * supervised user is present, so these turns must read like a plain
 * "keep going" nudge and must not claim autonomous-mode context.
 */
export namespace SupervisedContinuationPrompt {
  /**
   * Injected after a finish=length turn in a supervised session. The partial
   * assistant text stays in the transcript; this continuation tells the model
   * to resume exactly at the cutoff without repeating what was already
   * shown. Bounded by maxTruncatedModelTurnRetries in the prompt loop.
   */
  export function truncatedTurnRecovery(input: { attempt: number; maxAttempts: number }) {
    return (
      `Your previous response was cut off by the provider output-token limit (finish=length) before it completed. ` +
      `Continue from the exact point where the text stopped — resume mid-sentence if that is where the cutoff ` +
      `happened — and write only the remaining content. Do not repeat, restate, or rewrite any text that is ` +
      `already in your previous response. This is continuation attempt ${input.attempt}/${input.maxAttempts}.`
    )
  }
}
