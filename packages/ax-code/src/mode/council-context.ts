import { createHash } from "node:crypto"

/** Admission for opaque caller evidence; this does not select or summarize sources. */
export namespace CouncilContext {
  export const MAX_CONTEXT_CHARACTERS = 24_000
  export const MAX_PROMPT_BYTES = 128_000
  export const FRAMING_RESERVE_TOKENS = 2_048

  export type Admission = {
    /** The local context-length gate only; PromptBudget separately admits the full request. */
    status: "accepted" | "rejected"
    suppliedCharacters: number
    suppliedBytes: number
    sha256: string
    maxCharacters: number
  }

  export function admit(context = ""): Admission {
    return {
      status: context.length <= MAX_CONTEXT_CHARACTERS ? "accepted" : "rejected",
      suppliedCharacters: context.length,
      suppliedBytes: Buffer.byteLength(context, "utf8"),
      sha256: createHash("sha256").update(context).digest("hex"),
      maxCharacters: MAX_CONTEXT_CHARACTERS,
    }
  }

  export function userPrompt(input: {
    kind: "review" | "design"
    question: string
    context?: string
    debateContext?: string
  }): string {
    return [
      `Kind: ${input.kind}`,
      `Question: ${input.question}`,
      input.context ? `\nContext:\n${input.context}` : "",
      input.debateContext ? `\n${input.debateContext}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  }

  export type MemberBudget = {
    memberId: string
    limit?: { input?: number; context?: number }
    maxOutputTokens: number
  }

  export type PromptBudget = {
    ok: boolean
    estimateMethod: "conservative_utf8_bytes"
    promptBytes: number
    estimatedInputTokens: number
    framingReserveTokens: number
    unknownLimitMembers: string[]
    reasons: string[]
  }

  function positive(value: number | undefined): value is number {
    return value !== undefined && Number.isFinite(value) && value > 0
  }

  export function checkPrompt(input: {
    system: string
    user: string
    fallbackInstruction: string
    members: MemberBudget[]
  }): PromptBudget {
    // Include the fallback suffix even for the structured path. Byte count plus
    // a framing/schema reserve is deliberately pessimistic, not a tokenizer or
    // a universal upper bound across provider-specific serialization.
    const promptBytes = Buffer.byteLength(input.system + input.user + "\n\n" + input.fallbackInstruction, "utf8")
    const estimatedInputTokens = promptBytes + FRAMING_RESERVE_TOKENS
    const reasons: string[] = []
    const unknownLimitMembers: string[] = []
    if (promptBytes > MAX_PROMPT_BYTES) {
      reasons.push(`Complete prompt uses ${promptBytes} bytes; local limit is ${MAX_PROMPT_BYTES} bytes.`)
    }
    for (const member of input.members) {
      const caps: number[] = []
      if (positive(member.limit?.input)) caps.push(member.limit.input)
      if (positive(member.limit?.context)) caps.push(Math.max(0, member.limit.context - member.maxOutputTokens))
      if (!caps.length) {
        unknownLimitMembers.push(member.memberId)
        continue
      }
      const cap = Math.min(...caps)
      if (estimatedInputTokens > cap) {
        reasons.push(
          `${member.memberId}: conservative input estimate ${estimatedInputTokens} exceeds ${cap} available tokens ` +
            `(requested output reserve ${member.maxOutputTokens}).`,
        )
      }
    }
    return {
      ok: reasons.length === 0,
      estimateMethod: "conservative_utf8_bytes",
      promptBytes,
      estimatedInputTokens,
      framingReserveTokens: FRAMING_RESERVE_TOKENS,
      unknownLimitMembers,
      reasons,
    }
  }
}
