import { DiagnosticLog } from "@/debug/diagnostic-log"
import { stripThinkTags } from "@/provider/think-tags"
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
  return (
    message.info.role === "user" &&
    message.parts.some((part) =>
      part.type === "text" ? !part.synthetic && !part.ignored && !!part.text.trim() : part.type === "file",
    )
  )
}

/** Presentation history only: never recap work hidden by a pending rollback. */
export function recapMessages(
  messages: MessageV2.WithParts[],
  scope: "turn" | "conversation",
  revert?: Session.Info["revert"],
) {
  const boundary = revert ? messages.findIndex((message) => message.info.id === revert.messageID) : -1
  let visible = messages
  if (boundary >= 0) {
    visible = messages.slice(0, boundary)
    if (revert?.partID) {
      const target = messages[boundary]
      const partIndex = target.parts.findIndex((part) => part.id === revert.partID)
      if (partIndex >= 0) visible.push({ ...target, parts: target.parts.slice(0, partIndex) })
    }
  }
  let remaining = scope === "conversation" ? 8 : 1
  let start = -1
  for (let i = visible.length - 1; i >= 0; i--) {
    if (!isRealUserMessage(visible[i])) continue
    start = i
    if (--remaining === 0) break
  }
  return start < 0 ? [] : visible.slice(start)
}

/** Messages belonging to the most recent turn: from the last real
 *  (non-synthetic) user message onward. Undefined when no such turn exists. */
export function lastTurnMessages(messages: MessageV2.WithParts[]): MessageV2.WithParts[] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserMessage(messages[i])) return messages.slice(i)
  }
  return undefined
}

function shorten(text: string, budget: number) {
  if (text.length <= budget) return text
  const marker = " [...] "
  const head = Math.floor((budget - marker.length) / 2)
  const tail = budget - marker.length - head
  return (
    text.slice(0, head).replace(/[\uD800-\uDBFF]$/, "") + marker + text.slice(-tail).replace(/^[\uDC00-\uDFFF]/, "")
  )
}

/** Plain-text rendering of a turn for the recap model: user and assistant
 *  text parts only, truncated to the context budget. */
export function recapContextText(turn: MessageV2.WithParts[]): string {
  const chunks: { role: string; text: string }[] = []
  for (const message of turn) {
    if (message.info.role === "assistant" && message.info.summary) continue
    const texts: string[] = []
    for (const part of message.parts) {
      if (part.type !== "text" || part.synthetic || part.ignored || !part.text.trim()) continue
      texts.push(part.text)
    }
    const role = message.info.role === "user" ? "User" : "Assistant"
    if (texts.length) chunks.push({ role, text: texts.join(`\n\n${role}: `) })
  }
  const render = (chunk: (typeof chunks)[number]) => `${chunk.role}: ${chunk.text}`
  const full = chunks.map(render).join("\n\n").trim()
  if (full.length <= RECAP_CONTEXT_MAX_CHARS) return full

  const marker = "\n\n[Recap context truncated]"
  let remaining = RECAP_CONTEXT_MAX_CHARS - marker.length
  const selected = new Map<number, string>()
  // Reserve the latest request before filling from the newest outcomes backward.
  const userIndex = chunks.findLastIndex((chunk) => chunk.role === "User")
  if (userIndex >= 0) {
    const text = shorten(render(chunks[userIndex]), Math.floor(remaining / 3))
    selected.set(userIndex, text)
    remaining -= text.length + 2
  }
  for (let i = chunks.length - 1; i >= 0 && remaining >= 64; i--) {
    if (i === userIndex) continue
    const text = shorten(render(chunks[i]), remaining)
    selected.set(i, text)
    remaining -= text.length + 2
  }
  return (
    [...selected]
      .sort(([a], [b]) => a - b)
      .map(([, text]) => text)
      .join("\n\n") + marker
  )
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
  export async function generate(input: {
    sessionID: SessionID
    scope?: "turn" | "conversation"
  }): Promise<{ text: string } | undefined> {
    try {
      const history = await Session.messages({ sessionID: input.sessionID })
      const session = await Session.get(input.sessionID)
      const selected = recapMessages(history, input.scope ?? "turn", session.revert)
      const turn = lastTurnMessages(selected)
      if (!turn) return undefined
      const lastUser = turn[0].info as MessageV2.User
      if (shouldSkipAutomaticRecap({ providerID: lastUser.model.providerID })) return undefined
      if (turnEndedWithAssistantError(turn)) return undefined
      const lastAssistant = turn.findLast((message) => message.info.role === "assistant" && !message.info.summary)?.info
      if (lastAssistant?.role !== "assistant" || !lastAssistant.time.completed) return undefined

      const content = recapContextText(selected)
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
            content: `Recap the objective, confirmed progress, verification, and next step or blocker in this conversation excerpt:\n\n${content}`,
          },
        ],
      })
      const text = await Promise.resolve(result.text)
      const cleaned = text ? cleanGeneratedRecap(text) : undefined
      if (text && !cleaned) {
        log.warn("recap model returned no usable text", {
          sessionID: input.sessionID,
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
