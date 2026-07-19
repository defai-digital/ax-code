import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { publishPromptFailure } from "./prompt-loop-failure"
import { truncatedModelTurnDecision } from "./prompt-autonomous-decisions"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

// Long-form continuations may repeat a heading or a short transition, so only
// treat a retry as stale when a substantial normalized prefix is identical.
// The observed local-engine failure restarts byte-for-byte from the beginning;
// retain only this bounded prefix between turns and never log its content.
const REPEATED_OUTPUT_PREFIX_CHARS = 256

function normalizedOutput(text: string | undefined) {
  return text?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? ""
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
  },
  deps: PromptLoopTruncatedTurnDeps = {},
): Promise<PromptLoopTruncatedTurnTransition> {
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
    ;(deps.warn ?? log.warn)(
      repeatedOutput
        ? "autonomous stopped after repeated truncated model output"
        : "autonomous stopped after repeated truncated model turn",
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
      message: decision.message,
    })
    return {
      action: "stop",
      reason: decision.reason,
      truncatedModelTurnRetries: input.truncatedModelTurnRetries,
    }
  }

  if (decision.action === "recover") {
    ;(deps.warn ?? log.warn)("autonomous truncated model turn recovery", {
      command: "session.prompt.loop",
      status: "retry",
      errorCode: "TRUNCATED_MODEL_TURN",
      sessionID: input.sessionID,
      attempt: decision.attempt,
      maxAttempts: input.maxTruncatedModelTurnRetries,
      pendingCount: input.pendingCount,
    })
    return {
      action: "recover",
      truncatedModelTurnRetries: decision.truncatedModelTurnRetries,
      text: AutonomousContinuationPrompt.truncatedModelTurnRecovery({
        attempt: decision.attempt,
        maxAttempts: input.maxTruncatedModelTurnRetries,
      }),
    }
  }

  return {
    action: "ignore",
    truncatedModelTurnRetries: decision.truncatedModelTurnRetries,
  }
}
