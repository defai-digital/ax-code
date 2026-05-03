export namespace AutonomousCompletionGate {
  export type Todo = {
    content: string
    status: string
    priority: string
  }

  export type Message = {
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
        if (!record || record["type"] !== "tool" || record["tool"] !== "task") continue

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

  function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  }
}
