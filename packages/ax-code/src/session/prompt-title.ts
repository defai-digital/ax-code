import type { ModelMessage } from "ai"
import { NotFoundError } from "@/storage/db"
import { iife } from "@/util/iife"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { AX_ENGINE_PROVIDER_ID } from "../provider/ax-engine"
import { ModelID, ProviderID } from "../provider/schema"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Log } from "../util/log"
import { Token } from "../util/token"
import { Session } from "."
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { stripThinkTags } from "@/provider/think-tags"

const log = Log.create({ service: "session.prompt" })

const TITLE_CONTEXT_MAX_TOKENS = 3_000
const TITLE_CONTEXT_MAX_CHARS = TITLE_CONTEXT_MAX_TOKENS * 4
/** Title generation must not share the prompt-loop abort signal: loop
 *  completion always cancels that signal, which aborted in-flight titles
 *  (often mid-request on reasoning models) and left sessions titled
 *  "New session - …". Use a dedicated short timeout instead. */
const TITLE_TIMEOUT_MS = 30_000
const TITLE_MAX_LEN = 100
const FALLBACK_TITLE_MAX_LEN = 80

export function shouldSkipAutomaticTitle(input: { providerID: ProviderID }) {
  return input.providerID === AX_ENGINE_PROVIDER_ID
}

function titleFilePlaceholder(part: MessageV2.FilePart) {
  const filename = part.filename ?? "file"
  return `[Attached ${part.mime}: ${filename}]`
}

function truncateTitleContext(text: string) {
  if (Token.estimate(text) <= TITLE_CONTEXT_MAX_TOKENS) return text
  return `${text.slice(0, TITLE_CONTEXT_MAX_CHARS)}\n\n[Title context truncated]`
}

export function titleContextMessages(contextMessages: MessageV2.WithParts[]): ModelMessage[] {
  const summaryChunks: string[] = []
  const textChunks: string[] = []
  for (const message of contextMessages) {
    if (message.info.role !== "user") continue
    for (const part of message.parts) {
      if (part.type === "text" && !part.ignored) {
        textChunks.push(part.text)
        continue
      }
      if (part.type === "file") {
        summaryChunks.push(titleFilePlaceholder(part))
        continue
      }
      if (part.type === "subtask") {
        textChunks.push(part.prompt)
      }
    }
  }

  const chunks = [...summaryChunks, ...textChunks]
  const content = truncateTitleContext(chunks.join("\n\n").trim())
  if (!content) return []
  return [{ role: "user", content }]
}

/** Normalize model output into a single-line session title, or undefined if unusable. */
export function cleanGeneratedTitle(text: string): string | undefined {
  const withoutBlocks = stripThinkTags(text)
    .replace(/```[\s\S]*?```/g, "")
    .trim()
  if (!withoutBlocks) return undefined

  const line = withoutBlocks
    .split("\n")
    .map((raw) =>
      raw
        .trim()
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/^(title|thread title)\s*:\s*/i, "")
        .trim(),
    )
    .find((candidate) => candidate.length > 0 && !/^(here'?s|the)\s+(a\s+)?title\b/i.test(candidate))

  if (!line) return undefined
  return line.length > TITLE_MAX_LEN ? line.substring(0, TITLE_MAX_LEN - 3) + "..." : line
}

/** Deterministic fallback when the title model fails or returns empty text. */
export function fallbackTitleFromUserText(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((raw) => raw.trim())
    .find((candidate) => candidate.length > 0)
  if (!line) return undefined
  const collapsed = line.replace(/\s+/g, " ").trim()
  if (!collapsed) return undefined
  return collapsed.length > FALLBACK_TITLE_MAX_LEN ? collapsed.slice(0, FALLBACK_TITLE_MAX_LEN - 3) + "..." : collapsed
}

function firstUserText(contextMessages: MessageV2.WithParts[]): string {
  for (const message of contextMessages) {
    if (message.info.role !== "user") continue
    for (const part of message.parts) {
      if (part.type === "text" && !part.ignored && part.text.trim()) return part.text
      if (part.type === "subtask" && part.prompt.trim()) return part.prompt
    }
  }
  return ""
}

async function applyTitle(sessionID: Session.Info["id"], title: string) {
  return Session.setTitle({ sessionID, title }).catch((err) => {
    if (NotFoundError.isInstance(err)) return
    throw err
  })
}

export async function ensureTitle(input: {
  session: Session.Info
  history: MessageV2.WithParts[]
  providerID: ProviderID
  modelID: ModelID
  /** @deprecated Ignored. Title uses its own timeout so loop completion cancel cannot abort it. */
  abort?: AbortSignal
}) {
  if (!Session.isDefaultTitle(input.session.title)) return
  if (shouldSkipAutomaticTitle(input)) return

  const firstRealUserIdx = input.history.findIndex(
    (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
  )
  if (firstRealUserIdx === -1) return

  const isFirst =
    input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
      .length === 1
  if (!isFirst) return

  const contextMessages = input.history.slice(0, firstRealUserIdx + 1)
  const firstRealUser = contextMessages[firstRealUserIdx]
  const userText = firstUserText(contextMessages)

  const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
  const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

  // Apply a deterministic title immediately so MiniMax-style thinking (or a
  // hung title request that ignores abort) cannot leave "New session - …".
  let title = fallbackTitleFromUserText(userText)
  if (title) {
    log.info("using fallback session title", { sessionID: input.session.id, title })
    await applyTitle(input.session.id, title)
  }

  try {
    const agent = await Agent.get("title")
    if (!agent) {
      log.warn("title agent missing, using fallback title", { sessionID: input.session.id })
    } else {
      const model = await iife(async () => {
        if (agent.model) return await Provider.getModel(agent.model.providerID, agent.model.modelID)
        const small = await Provider.getSmallModel(input.providerID)
        if (small) return small
        log.info("no small model for provider; title uses the session model", {
          sessionID: input.session.id,
          providerID: input.providerID,
        })
        return await Provider.getModel(input.providerID, input.modelID)
      })
      // Dedicated timeout — do not share the prompt-loop abort controller.
      const titleAbort = AbortSignal.timeout(TITLE_TIMEOUT_MS)
      const result = await LLM.stream({
        agent,
        user: firstRealUser.info as MessageV2.User,
        system: [],
        small: true,
        tools: {},
        model,
        abort: titleAbort,
        sessionID: input.session.id,
        // No AI SDK retries for title generation: billing/quota 429s should
        // not burn 3 attempts. The prompt loop has its own retry logic.
        retries: 0,
        messages: [
          {
            role: "user",
            content: "Generate a title for this conversation:\n",
          },
          ...(hasOnlySubtaskParts
            ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
            : titleContextMessages(contextMessages)),
        ],
      })
      const text = await Promise.resolve(result.text)
      const generated = text ? cleanGeneratedTitle(text) : undefined
      if (text && !generated) {
        log.warn("title model returned no usable title text", {
          sessionID: input.session.id,
          preview: text.slice(0, 120),
        })
      }
      if (generated && generated !== title) {
        title = generated
        return applyTitle(input.session.id, generated)
      }
    }
  } catch (err: unknown) {
    log.warn("failed to generate title", {
      sessionID: input.session.id,
      error: DiagnosticLog.redactForLog(err),
    })
  }
}
