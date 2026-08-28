import { DiagnosticLog } from "@/debug/diagnostic-log"
import { stripThinkTags } from "@/provider/think-tags"
import { Token } from "@/util/token"
import { Agent } from "../agent/agent"
import { AX_ENGINE_PROVIDER_ID } from "../provider/ax-engine"
import { Provider } from "../provider/provider"
import { agentModel } from "./prompt-command-selection"
import { Log } from "../util/log"
import { Session } from "."
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.recap" })

const RECAP_CONTEXT_MAX_TOKENS = 3_000
const RECAP_CONTEXT_MAX_CHARS = RECAP_CONTEXT_MAX_TOKENS * 4
/** Recap generation must not share the prompt-loop abort signal (same
 *  rationale as title generation): loop completion cancels that signal. */
const RECAP_TIMEOUT_MS = 30_000
const RECAP_MAX_LEN = 400

export function shouldSkipAutomaticRecap(input: { providerID: MessageV2.User["model"]["providerID"] }) {
  return input.providerID === AX_ENGINE_PROVIDER_ID
}

/** Recap is for completed work. A failed/aborted last assistant turn should
 *  not fire the small-model recap lane — that looks like a sudden model switch
 *  right as the error banner appears. */
export function turnEndedWithAssistantError(turn: MessageV2.WithParts[]): boolean {
  for (let i = turn.length - 1; i >= 0; i--) {
    const info = turn[i].info
    if (info.role !== "assistant") continue
    return info.error !== undefined
  }
  return false
}

function isRealUserMessage(message: MessageV2.WithParts) {
  return message.info.role === "user" && !message.parts.every((p) => "synthetic" in p && p.synthetic)
}

/** Messages belonging to the most recent turn: from the last real
 *  (non-synthetic) user message onward. Undefined when no such turn exists. */
export function lastTurnMessages(messages: MessageV2.WithParts[]): MessageV2.WithParts[] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserMessage(messages[i])) return messages.slice(i)
  }
  return undefined
}

function truncateRecapContext(text: string) {
  if (Token.estimate(text) <= RECAP_CONTEXT_MAX_TOKENS) return text
  return `${text.slice(0, RECAP_CONTEXT_MAX_CHARS)}\n\n[Recap context truncated]`
}

/** Plain-text rendering of a turn for the recap model: user and assistant
 *  text parts only, truncated to the context budget. */
export function recapContextText(turn: MessageV2.WithParts[]): string {
  const chunks: string[] = []
  for (const message of turn) {
    for (const part of message.parts) {
      if (part.type !== "text" || part.synthetic) continue
      if (message.info.role === "user") {
        if (part.ignored) continue
        if (part.text.trim()) chunks.push(`User: ${part.text}`)
        continue
      }
      if (message.info.role === "assistant" && part.text.trim()) chunks.push(`Assistant: ${part.text}`)
    }
  }
  return truncateRecapContext(chunks.join("\n\n").trim())
}

/** Normalize model output into a short plain-text recap, or undefined if unusable. */
export function cleanGeneratedRecap(text: string): string | undefined {
  let cleaned = stripThinkTags(text)
    .replace(/```[\s\S]*?```/g, "")
    .trim()
  if (!cleaned) return undefined

  cleaned = cleaned.replace(/^(summary|recap)\s*:\s*/i, "").trim()
  if (!cleaned) return undefined

  return cleaned.length > RECAP_MAX_LEN ? cleaned.slice(0, RECAP_MAX_LEN - 3) + "..." : cleaned
}

export namespace SessionRecap {
  export async function generate(input: { sessionID: SessionID }): Promise<{ text: string } | undefined> {
    try {
      const history = await Session.messages({ sessionID: input.sessionID })
      const turn = lastTurnMessages(history)
      if (!turn) return undefined
      const lastUser = turn[0].info as MessageV2.User
      if (shouldSkipAutomaticRecap({ providerID: lastUser.model.providerID })) return undefined
      if (turnEndedWithAssistantError(turn)) return undefined

      const content = recapContextText(turn)
      if (!content) return undefined

      const agent = await Agent.get("recap")
      if (!agent) {
        log.warn("recap agent missing", { sessionID: input.sessionID })
        return undefined
      }
      const userModel = await Provider.resolveRequestedModel(lastUser.model)
      // Same precedence as the title agent: explicit model pin first, then
      // the provider's small tier, then the session model as fallback.
      const model = await (async () => {
        const pinned = await agentModel(agent)
        if (pinned) return Provider.getModel(pinned.providerID, pinned.modelID)
        const small = await Provider.getSmallModel(userModel.providerID)
        if (small) return small
        log.info("no small model for provider; recap uses the session model", {
          sessionID: input.sessionID,
          providerID: userModel.providerID,
        })
        return Provider.getModel(userModel.providerID, userModel.modelID)
      })()
      // Dedicated timeout — do not share the prompt-loop abort controller.
      const abort = AbortSignal.timeout(RECAP_TIMEOUT_MS)
      const result = await LLM.stream({
        agent,
        user: lastUser,
        system: [],
        small: true,
        tools: {},
        model,
        abort,
        sessionID: input.sessionID,
        // No AI SDK retries: a recap is best-effort and must never pile up
        // billing/quota attempts behind an idle user.
        retries: 0,
        messages: [
          {
            role: "user",
            content: `Recap what was accomplished in this turn:\n\n${content}`,
          },
        ],
      })
      const text = await Promise.resolve(result.text)
      const cleaned = text ? cleanGeneratedRecap(text) : undefined
      if (text && !cleaned) {
        log.warn("recap model returned no usable text", {
          sessionID: input.sessionID,
          preview: text.slice(0, 120),
        })
      }
      if (!cleaned) return undefined
      return { text: cleaned }
    } catch (err: unknown) {
      log.warn("failed to generate recap", {
        sessionID: input.sessionID,
        error: DiagnosticLog.redactForLog(err),
      })
      return undefined
    }
  }
}
