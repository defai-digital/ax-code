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
      return {
        status: "blocked",
        reason: "empty_subagent_result",
        signature: `empty-subagent:${emptyResult.callID ?? ""}:${emptyResult.taskID ?? ""}:${
          emptyResult.description ?? ""
        }`,
        message: `${subject}${description} completed without a usable final response.`,
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
    let latest: EmptySubagentResult | undefined

    for (const message of messages) {
      for (const part of message.parts ?? []) {
        const record = asRecord(part)
        if (!record || record["type"] !== "tool" || record["tool"] !== "task") continue

        const state = asRecord(record["state"])
        if (!state || state["status"] !== "completed") continue

        const metadata = asRecord(state["metadata"])
        const output = typeof state["output"] === "string" ? state["output"] : ""
        const emptyResult =
          metadata?.["emptyResult"] === true || output.includes("Subagent completed without a final response.")

        if (!emptyResult) {
          latest = undefined
          continue
        }

        const input = asRecord(state["input"])
        latest = {
          callID: typeof record["callID"] === "string" ? record["callID"] : undefined,
          taskID: typeof metadata?.["sessionId"] === "string" ? metadata["sessionId"] : undefined,
          description: typeof input?.["description"] === "string" ? input["description"] : undefined,
        }
      }
    }

    return latest
  }

  function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  }
}
