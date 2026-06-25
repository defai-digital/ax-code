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

const log = Log.create({ service: "session.prompt" })

const TITLE_CONTEXT_MAX_TOKENS = 3_000
const TITLE_CONTEXT_MAX_CHARS = TITLE_CONTEXT_MAX_TOKENS * 4

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

export async function ensureTitle(input: {
  session: Session.Info
  history: MessageV2.WithParts[]
  providerID: ProviderID
  modelID: ModelID
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

  const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
  const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

  const agent = await Agent.get("title")
  if (!agent) return
  const model = await iife(async () => {
    if (agent.model) return await Provider.getModel(agent.model.providerID, agent.model.modelID)
    return (
      (await Provider.getSmallModel(input.providerID)) ?? (await Provider.getModel(input.providerID, input.modelID))
    )
  })
  const result = await LLM.stream({
    agent,
    user: firstRealUser.info as MessageV2.User,
    system: [],
    small: true,
    tools: {},
    model,
    abort: input.abort ?? new AbortController().signal,
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
  // Return undefined explicitly on failure. The previous code relied on
  // log.error happening to return void, which works today but would silently
  // break if log.error ever returns something truthy.
  const text = await Promise.resolve(result.text).catch((err: unknown) => {
    log.error("failed to generate title", { error: DiagnosticLog.redactForLog(err) })
    return undefined
  })
  if (text) {
    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
      .split("\n")
      .map((line: string) => line.trim())
      .find((line: string) => line.length > 0)
    if (!cleaned) return

    const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
    return Session.setTitle({ sessionID: input.session.id, title }).catch((err) => {
      if (NotFoundError.isInstance(err)) return
      throw err
    })
  }
}
