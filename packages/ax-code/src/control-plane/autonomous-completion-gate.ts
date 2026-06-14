import { Locale } from "@/util/locale"
import { asRecordOrUndefined } from "../util/record"
import { isActiveTodo } from "../session/todo-status"
export namespace AutonomousCompletionGate {
  export type Todo = {
    content: string
    status: string
    priority: string
  }

  export type Message = {
    info?: {
      role?: string
    }
    parts?: readonly unknown[]
  }

  export type EmptySubagentResult = {
    callID?: string
    taskID?: string
    description?: string
    failed?: boolean
    errorMessage?: string
    recoveredResultNeedsReview?: boolean
  }

  export type Decision =
    | {
        status: "allow"
      }
    | {
        status: "blocked"
        reason: "empty_subagent_result"
        signature: string
        message: string
        emptyResult: EmptySubagentResult
      }
    | {
        status: "blocked"
        reason: "unfinished_todos"
        signature: string
        message: string
        pendingTodos: Todo[]
      }
    | {
        status: "blocked"
        reason: "unexecutable_tool_text"
        signature: string
        message: string
        toolText: string
      }

  export function evaluate(input: { messages: readonly Message[]; pendingTodos: readonly Todo[] }): Decision {
    const unexecutableToolText = latestUnexecutableToolText(input.messages)
    if (unexecutableToolText) {
      return {
        status: "blocked",
        reason: "unexecutable_tool_text",
        signature: `unexecutable-tool-text:${hashSignature(unexecutableToolText)}`,
        message:
          `The model returned a tool call as plain text instead of an executable AX Code tool call. ` +
          `The session is stopped because no file, shell, or task action actually ran.`,
        toolText: unexecutableToolText,
      }
    }

    const emptyResult = latestEmptySubagentResult(input.messages)
    if (emptyResult) {
      const subject = emptyResult.taskID ? `Subagent ${emptyResult.taskID}` : "A subagent"
      const description = emptyResult.description ? ` for "${emptyResult.description}"` : ""
      const problem = emptyResult.failed
        ? "failed before returning usable evidence"
        : emptyResult.recoveredResultNeedsReview
          ? "returned recovered evidence that still needs review"
          : "completed without a usable final response"
      return {
        status: "blocked",
        reason: "empty_subagent_result",
        signature: `empty-subagent:${emptyResult.callID ?? ""}:${emptyResult.taskID ?? ""}:${
          emptyResult.description ?? ""
        }`,
        message: `${subject}${description} ${problem}.`,
        emptyResult,
      }
    }

    const pendingTodos = input.pendingTodos.filter(isActiveTodo)
    if (pendingTodos.length > 0) {
      return {
        status: "blocked",
        reason: "unfinished_todos",
        signature: `todos:${pendingTodos.map((todo) => `${todo.status}:${todo.content}`).join("|")}`,
        message: `${Locale.pluralize(pendingTodos.length, "{} todo remains", "{} todos remain")} unfinished.`,
        pendingTodos,
      }
    }

    return { status: "allow" }
  }

  function latestUnexecutableToolText(messages: readonly Message[]): string | undefined {
    let latest: string | undefined

    for (const message of messages) {
      if (!isAssistantMessage(message)) continue
      for (const part of message.parts ?? []) {
        const record = asRecord(part)
        if (!record) continue
        if (record["type"] !== "text" || typeof record["text"] !== "string") continue
        if (record["synthetic"] === true || record["ignored"] === true) continue
        if (looksLikeUnexecutableToolText(record["text"])) latest = record["text"]
      }
    }

    return latest
  }

  function looksLikeUnexecutableToolText(text: string) {
    return /<tool_call>[\s\S]{0,4000}<\/tool_call>/.test(text) || /<function=[A-Za-z0-9_-]+/.test(text)
  }

  function hashSignature(value: string) {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
      hash = (hash * 31 + value.charCodeAt(i)) | 0
    }
    return Math.abs(hash).toString(36)
  }

  function latestEmptySubagentResult(messages: readonly Message[]): EmptySubagentResult | undefined {
    const unresolved = new Map<string, EmptySubagentResult>()
    // Counts substantive direct-work tool calls by the parent assistant that
    // occur AFTER each unresolved entry was recorded. Once a counter reaches
    // IMPLICIT_RESOLUTION_THRESHOLD, the parent has demonstrated it took over
    // the work itself and the entry is removed.
    const substantiveCallsAfter = new Map<string, number>()
    let anonymousIndex = 0

    for (const message of messages) {
      for (const part of message.parts ?? []) {
        const record = asRecord(part)
        if (!record) continue

        if (isAssistantMessage(message) && record["type"] === "text" && typeof record["text"] === "string") {
          // Skip system-injected ("synthetic") or filtered-out ("ignored")
          // text parts — TextPart marks these via boolean flags
          // (session/message-v2.ts). They are not the model's authentic
          // resolution intent and must not clear unresolved subagent state.
          if (record["synthetic"] === true || record["ignored"] === true) continue
          resolveWithAssistantText(unresolved, record["text"])
          for (const key of [...substantiveCallsAfter.keys()]) {
            if (!unresolved.has(key)) substantiveCallsAfter.delete(key)
          }
          continue
        }

        if (record["type"] !== "tool") continue

        const tool = record["tool"]

        if (isAssistantMessage(message) && typeof tool === "string" && tool !== "task" && isSubstantiveTool(tool)) {
          const state = asRecord(record["state"])
          if (state?.["status"] === "completed" && unresolved.size > 0) {
            for (const key of unresolved.keys()) {
              substantiveCallsAfter.set(key, (substantiveCallsAfter.get(key) ?? 0) + 1)
            }
            for (const [key, count] of [...substantiveCallsAfter.entries()]) {
              if (count >= IMPLICIT_RESOLUTION_THRESHOLD) {
                unresolved.delete(key)
                substantiveCallsAfter.delete(key)
              }
            }
          }
          continue
        }

        if (tool !== "task") continue

        const state = asRecord(record["state"])
        if (!state) continue
        const status = state["status"]
        if (status !== "completed" && status !== "error") continue

        const metadata = asRecord(state["metadata"])
        const output = typeof state["output"] === "string" ? state["output"] : ""
        const input = asRecord(state["input"])
        const callID = typeof record["callID"] === "string" ? record["callID"] : undefined
        const taskID = typeof metadata?.["sessionId"] === "string" ? metadata["sessionId"] : undefined
        const description = typeof input?.["description"] === "string" ? input["description"] : undefined
        const key = taskID ? `task:${taskID}` : callID ? `call:${callID}` : `anonymous:${anonymousIndex++}`
        if (status === "error") {
          // ToolStateError carries the failure detail in `state.error` (see
          // session/message-v2.ts ToolStateError schema). Some legacy/test
          // fixtures use `errorMessage`; accept that as a fallback so we
          // never silently drop the error text on either shape.
          const errorMessage =
            typeof state["error"] === "string"
              ? state["error"]
              : typeof state["errorMessage"] === "string"
                ? state["errorMessage"]
                : output || undefined
          const current = {
            callID,
            taskID,
            description,
            failed: true,
            errorMessage,
          }
          unresolved.delete(key)
          unresolved.set(key, current)
          substantiveCallsAfter.set(key, 0)
          continue
        }

        const recoveredResultNeedsReview = metadata?.["recoveredResultNeedsReview"] === true
        const emptyResult =
          metadata?.["emptyResult"] === true ||
          recoveredResultNeedsReview ||
          output.includes("Subagent completed without a final response.")

        if (!emptyResult) {
          unresolved.delete(key)
          substantiveCallsAfter.delete(key)
          continue
        }

        const current = {
          callID,
          taskID,
          description,
          recoveredResultNeedsReview,
        }
        unresolved.delete(key)
        unresolved.set(key, current)
        substantiveCallsAfter.set(key, 0)
      }
    }

    let latest: EmptySubagentResult | undefined
    for (const result of unresolved.values()) latest = result
    return latest
  }

  // K substantive direct-work tool calls by the parent after a subagent
  // failure is treated as the parent having taken over the work. The
  // screenshot trigger (3 Read calls on the three failed-subagent target
  // modules) lands exactly here.
  const IMPLICIT_RESOLUTION_THRESHOLD = 3

  // Tools that do NOT count as substantive direct work — they are state-only,
  // workflow markers, or the subagent itself. Anything else is treated as
  // real work for the purpose of implicit resolution.
  const NON_SUBSTANTIVE_TOOLS = new Set([
    "task",
    "todowrite",
    "todoread",
    "question",
    "plan_exit",
    "register_finding",
    "review_complete",
    "memory_save",
    "skill",
    "invalid",
  ])

  function isSubstantiveTool(tool: string) {
    return !NON_SUBSTANTIVE_TOOLS.has(tool)
  }

  function resolveWithAssistantText(unresolved: Map<string, EmptySubagentResult>, text: string) {
    if (unresolved.size === 0 || !isExplicitResolution(text)) return

    const matches = [...unresolved.entries()].filter(([, result]) => referencesResult(text, result))
    if (matches.length > 0) {
      for (const [key] of matches) unresolved.delete(key)
      return
    }

    if (unresolved.size === 1) {
      const [key] = unresolved.keys()
      unresolved.delete(key)
    }
  }

  // Past-tense and gerund/noun forms only — bare infinitives ("verify", "read",
  // "check") would also match future-intent phrasing ("I will verify this
  // directly") which is not a resolution. Existing canonical phrases like
  // "validate directly" remain covered by the explicit-phrase list below.
  const RESOLUTION_PATTERN =
    /\b(investigating|investigated|investigation|verifying|verified|validating|validated|checking|checked|reviewing|reviewed|examining|examined|inspecting|inspected|handling|handled|reading|resolving|resolved|addressing|addressed|covering|covered|auditing|audited)\b[ a-z0-9]{0,120}\b(directly|myself|ourselves)\b/

  function isExplicitResolution(text: string) {
    const normalized = normalize(text)
    if (!normalized.includes("subagent") && !normalized.includes("completion gate") && !normalized.includes("task")) {
      return false
    }

    const explicitPhrases = [
      "completion gate resolution",
      "no usable result can be recovered",
      "cannot recover a usable result",
      "cant recover a usable result",
      "can not recover a usable result",
      "i do not need",
      "i dont need",
      "not needed",
      "not required",
      "not necessary",
      "can verify directly",
      "verified directly",
      "validate directly",
      "validated directly",
      "handled directly",
      "reviewed the recovered",
      "validated the recovered",
    ]
    if (explicitPhrases.some((phrase) => normalized.includes(phrase))) return true

    // Natural-language fallback: model says it did the work itself / directly.
    // The prefilter above (subagent/task/completion gate) keeps this in the
    // resolution conversational context, so a past/in-progress work verb
    // followed by "directly" or "myself" is a reasonable resolution signal.
    return RESOLUTION_PATTERN.test(normalized)
  }

  const DESCRIPTION_STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "all",
    "any",
    "this",
    "that",
    "you",
    "are",
    "was",
    "were",
    "have",
    "has",
    "had",
    "but",
    "not",
    "out",
    "use",
    "via",
    "per",
    "into",
    "onto",
    "over",
    "than",
    "then",
    "when",
    "what",
    "which",
    "who",
    "how",
    "why",
  ])

  function referencesResult(text: string, result: EmptySubagentResult) {
    const normalized = normalize(text)
    if (result.taskID && normalized.includes(normalize(result.taskID))) return true
    if (result.callID && normalized.includes(normalize(result.callID))) return true
    if (!result.description) return false

    const description = normalize(result.description)
    if (description.length > 0 && normalized.includes(description)) return true

    const descriptionWords = new Set(
      description.split(" ").filter((word) => word.length >= 3 && !DESCRIPTION_STOPWORDS.has(word)),
    )
    if (descriptionWords.size === 0) return false
    let matched = 0
    for (const word of descriptionWords) {
      if (normalized.includes(word)) matched++
    }
    return matched >= Math.min(3, descriptionWords.size)
  }

  function isAssistantMessage(message: Message) {
    return message.info?.role === "assistant"
  }

  function normalize(value: string) {
    return value
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  }

  const asRecord = asRecordOrUndefined
}
