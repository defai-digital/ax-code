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

  export function evaluate(input: { messages: readonly Message[]; pendingTodos: readonly Todo[] }): Decision {
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

    const pendingTodos = input.pendingTodos.filter((todo) => todo.status === "pending" || todo.status === "in_progress")
    if (pendingTodos.length > 0) {
      return {
        status: "blocked",
        reason: "unfinished_todos",
        signature: `todos:${pendingTodos.map((todo) => `${todo.status}:${todo.content}`).join("|")}`,
        message: `${pendingTodos.length} todo${pendingTodos.length === 1 ? "" : "s"} remain unfinished.`,
        pendingTodos,
      }
    }

    return { status: "allow" }
  }

  function latestEmptySubagentResult(messages: readonly Message[]): EmptySubagentResult | undefined {
    const unresolved = new Map<string, EmptySubagentResult>()
    let anonymousIndex = 0

    for (const message of messages) {
      for (const part of message.parts ?? []) {
        const record = asRecord(part)
        if (!record) continue

        if (isAssistantMessage(message) && record["type"] === "text" && typeof record["text"] === "string") {
          resolveWithAssistantText(unresolved, record["text"])
          continue
        }

        if (record["type"] !== "tool" || record["tool"] !== "task") continue

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
          const errorMessage = typeof state["errorMessage"] === "string" ? state["errorMessage"] : output || undefined
          const current = {
            callID,
            taskID,
            description,
            failed: true,
            errorMessage,
          }
          unresolved.delete(key)
          unresolved.set(key, current)
          continue
        }

        const recoveredResultNeedsReview = metadata?.["recoveredResultNeedsReview"] === true
        const emptyResult =
          metadata?.["emptyResult"] === true ||
          recoveredResultNeedsReview ||
          output.includes("Subagent completed without a final response.")

        if (!emptyResult) {
          unresolved.delete(key)
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
      }
    }

    let latest: EmptySubagentResult | undefined
    for (const result of unresolved.values()) latest = result
    return latest
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

  function isExplicitResolution(text: string) {
    const normalized = normalize(text)
    if (!normalized.includes("subagent") && !normalized.includes("completion gate") && !normalized.includes("task")) {
      return false
    }

    return [
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
    ].some((phrase) => normalized.includes(phrase))
  }

  function referencesResult(text: string, result: EmptySubagentResult) {
    const normalized = normalize(text)
    if (result.taskID && normalized.includes(normalize(result.taskID))) return true
    if (result.callID && normalized.includes(normalize(result.callID))) return true
    if (!result.description) return false

    const description = normalize(result.description)
    if (description.length > 0 && normalized.includes(description)) return true

    const descriptionWords = new Set(description.split(" ").filter((word) => word.length >= 4))
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

  function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  }
}
