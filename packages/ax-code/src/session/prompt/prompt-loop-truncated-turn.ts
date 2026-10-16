import { Log } from "../../util/log"
import type { MessageV2 } from "../message-v2"
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { SupervisedContinuationPrompt } from "./prompt-supervised-continuations"
import { publishPromptFailure } from "./prompt-loop-failure"
import { truncatedModelTurnDecision } from "./prompt-autonomous-decisions"
import type { SessionID } from "../schema"

const log = Log.create({ service: "session.prompt" })

// Long-form continuations may repeat a heading or a short transition, so only
// treat a retry as stale when a substantial normalized prefix is identical.
// The observed local-engine failure restarts byte-for-byte from the beginning;
// retain only this bounded prefix between turns and never log its content.
const REPEATED_OUTPUT_PREFIX_CHARS = 256
// Large in-chat code dumps that hit finish=length are a common local-engine
// failure mode: recovery then re-generates another multi-kB paste instead of
// writing a file. Detect enough substance to switch recovery strategy.
const LARGE_CODE_PASTE_MIN_CHARS = 1_500
const LARGE_CODE_FENCE_BODY_MIN_CHARS = 200

function normalizedOutput(text: string | undefined) {
  return text?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? ""
}

/** Which session mode the truncated turn happened in; selects wording only. */
export type TruncatedTurnRecoveryMode = "autonomous" | "supervised"

/**
 * Whether the prompt loop should run truncated-turn recovery for this turn.
 * Recovery runs in BOTH supervised and autonomous sessions: finish=length
 * means the provider cut an in-progress response at its output limit, and
 * the partial text must be continued with a bounded retry budget instead of
 * silently re-calling the model with no continuation instruction (the old
 * supervised behavior, which was bounded only by the generic step ceilings).
 * Provider errors own their own retry path, so an errored turn never enters
 * truncated recovery even when its finish reason is "length".
 */
export function truncatedTurnRecoveryEngaged(input: { truncatedModelTurn: boolean; messageError: boolean }): boolean {
  return input.truncatedModelTurn && !input.messageError
}

export function truncatedModelOutputPrefix(text: string | undefined): string | undefined {
  const normalized = normalizedOutput(text)
  if (normalized.length < REPEATED_OUTPUT_PREFIX_CHARS) return undefined
  return normalized.slice(0, REPEATED_OUTPUT_PREFIX_CHARS)
}

export function isRepeatedTruncatedModelOutput(input: { previousOutputPrefix?: string; currentOutputPrefix?: string }) {
  if (input.previousOutputPrefix?.length !== REPEATED_OUTPUT_PREFIX_CHARS) return false
  if (input.currentOutputPrefix?.length !== REPEATED_OUTPUT_PREFIX_CHARS) return false
  return input.previousOutputPrefix === input.currentOutputPrefix
}

/** True when truncated assistant text looks like a large unfinished code paste. */
export function isLargeTruncatedCodePaste(text: string | undefined): boolean {
  if (!text) return false
  const trimmed = text.trim()
  if (trimmed.length < LARGE_CODE_PASTE_MIN_CHARS) return false
  if (new RegExp(`\`\`\`[\\s\\S]{${LARGE_CODE_FENCE_BODY_MIN_CHARS},}`).test(trimmed)) return true
  // Unfenced but still a long source-looking dump (common after a bad tool name).
  const codeyLines = trimmed
    .split("\n")
    .filter((line) =>
      /^(def |class |import |from |function |const |export |package |using |#include )/i.test(line.trim()),
    )
  return codeyLines.length >= 8
}

type PromptLoopTruncatedTurnTransition =
  | {
      action: "ignore"
      truncatedModelTurnRetries: number
    }
  | {
      action: "recover"
      truncatedModelTurnRetries: number
      text: string
    }
  | {
      action: "stop"
      reason: "stalled"
      truncatedModelTurnRetries: number
    }

type PromptLoopTruncatedTurnDeps = {
  warn?: (message: string, fields: Record<string, unknown>) => void
  publishFailure?: typeof publishPromptFailure
}

// Stop diagnostics for supervised sessions: same errorCodes and mechanics as
// the autonomous messages in prompt-autonomous-decisions.ts, but never claim
// autonomous mode — the failure must read as a provider/runtime limit in a
// session the user is watching.
const SUPERVISED_TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE =
  `The model turn was truncated: the provider returned finish=length before the response completed, and the ` +
  `continuation retry budget is exhausted. The partial response is preserved in the transcript, but the work ` +
  `should not be treated as complete.`

const SUPERVISED_REPEATED_TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE =
  `The session stopped because the provider repeated the same substantial output after a truncated-turn ` +
  `continuation instead of continuing from the cutoff point. This usually indicates stale provider or local ` +
  `model runtime state. Retry with a fresh provider connection, or restart the local model runtime, then ask ` +
  `the model to continue. The partial response is preserved, but the work should not be treated as complete.`

function supervisedStopMessage(errorCode: "TRUNCATED_MODEL_TURN" | "REPEATED_TRUNCATED_MODEL_TURN") {
  return errorCode === "REPEATED_TRUNCATED_MODEL_TURN"
    ? SUPERVISED_REPEATED_TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE
    : SUPERVISED_TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE
}

export async function handlePromptLoopTruncatedTurn(
  input: {
    sessionID: SessionID
    assistant: MessageV2.Assistant
    truncatedModelTurn: boolean
    truncatedModelTurnRetries: number
    maxTruncatedModelTurnRetries: number
    pendingCount: number
    previousOutputPrefix?: string
    currentOutputPrefix?: string
    /** Session mode; selects recovery wording and stop diagnostics. */
    mode?: TruncatedTurnRecoveryMode
  },
  deps: PromptLoopTruncatedTurnDeps = {},
): Promise<PromptLoopTruncatedTurnTransition> {
  const mode: TruncatedTurnRecoveryMode = input.mode ?? "autonomous"
  const decision = truncatedModelTurnDecision({
    truncatedModelTurn: input.truncatedModelTurn,
    truncatedModelTurnRetries: input.truncatedModelTurnRetries,
    maxTruncatedModelTurnRetries: input.maxTruncatedModelTurnRetries,
    repeatedOutput:
      input.truncatedModelTurn &&
      isRepeatedTruncatedModelOutput({
        previousOutputPrefix: input.previousOutputPrefix,
        currentOutputPrefix: input.currentOutputPrefix,
      }),
  })

  if (decision.action === "stop") {
    const repeatedOutput = decision.errorCode === "REPEATED_TRUNCATED_MODEL_TURN"
    const modeLabel = mode === "supervised" ? "supervised" : "autonomous"
    ;(deps.warn ?? log.warn)(
      repeatedOutput
        ? `${modeLabel} stopped after repeated truncated model output`
        : `${modeLabel} stopped after repeated truncated model turn`,
      {
        command: "session.prompt.loop",
        status: "stopped",
        errorCode: decision.errorCode,
        sessionID: input.sessionID,
        attempts: input.truncatedModelTurnRetries,
        maxAttempts: input.maxTruncatedModelTurnRetries,
        pendingCount: input.pendingCount,
      },
    )
    await (deps.publishFailure ?? publishPromptFailure)({
      sessionID: input.sessionID,
      assistant: input.assistant,
      message: mode === "supervised" ? supervisedStopMessage(decision.errorCode) : decision.message,
    })
    return {
      action: "stop",
      reason: decision.reason,
      truncatedModelTurnRetries: input.truncatedModelTurnRetries,
    }
  }

  if (decision.action === "recover") {
    ;(deps.warn ?? log.warn)(
      mode === "supervised" ? "supervised truncated model turn recovery" : "autonomous truncated model turn recovery",
      {
        command: "session.prompt.loop",
        status: "retry",
        errorCode: "TRUNCATED_MODEL_TURN",
        sessionID: input.sessionID,
        attempt: decision.attempt,
        maxAttempts: input.maxTruncatedModelTurnRetries,
        pendingCount: input.pendingCount,
      },
    )
    const text =
      mode === "supervised"
        ? SupervisedContinuationPrompt.truncatedTurnRecovery({
            attempt: decision.attempt,
            maxAttempts: input.maxTruncatedModelTurnRetries,
          })
        : AutonomousContinuationPrompt.truncatedModelTurnRecovery({
            attempt: decision.attempt,
            maxAttempts: input.maxTruncatedModelTurnRetries,
          })
    return {
      action: "recover",
      truncatedModelTurnRetries: decision.truncatedModelTurnRetries,
      text,
    }
  }

  return {
    action: "ignore",
    truncatedModelTurnRetries: decision.truncatedModelTurnRetries,
  }
}
