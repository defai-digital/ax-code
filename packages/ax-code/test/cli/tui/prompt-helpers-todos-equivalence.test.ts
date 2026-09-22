import { describe, expect, test } from "vitest"
import { hasUnfinishedTodosInPromptParts } from "../../../src/cli/tui/component/prompt/prompt-helpers"
import { isActiveTodo } from "../../../src/session/todo-status"

// Reference: the previous forward scan that kept the last completed todowrite.
function forwardReference(messages: Array<{ id?: string }> | undefined, partsByMessage: Record<string, unknown[]>) {
  let latestTodos: Array<{ status?: unknown }> | undefined
  for (const message of messages ?? []) {
    if (!message.id) continue
    for (const part of partsByMessage[message.id] ?? []) {
      const toolPart = part as { type?: unknown; tool?: unknown; state?: { status?: unknown; metadata?: { todos?: unknown } } }
      if (toolPart.type !== "tool" || toolPart.tool !== "todowrite") continue
      if (toolPart.state?.status !== "completed") continue
      const todos = toolPart.state.metadata?.todos
      if (!Array.isArray(todos)) continue
      latestTodos = todos as Array<{ status?: unknown }>
    }
  }
  return latestTodos?.some(isActiveTodo) ?? false
}

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const STATUSES = ["pending", "in_progress", "completed", "cancelled", undefined, 42]

describe("hasUnfinishedTodosInPromptParts reverse scan", () => {
  test("matches the forward scan over randomized transcripts", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = rng(seed * 7919)
      const messageCount = Math.floor(next() * 6)
      const messages: Array<{ id?: string }> = []
      const partsByMessage: Record<string, unknown[]> = {}
      for (let index = 0; index < messageCount; index++) {
        const id = next() < 0.1 ? undefined : `m${index}`
        messages.push({ id })
        if (!id) continue
        const parts: unknown[] = []
        const partCount = Math.floor(next() * 5)
        for (let part = 0; part < partCount; part++) {
          const roll = next()
          if (roll < 0.3) parts.push({ type: "text", text: "x" })
          else if (roll < 0.4) parts.push({ type: "tool", tool: "bash", state: { status: "completed" } })
          else if (roll < 0.5) parts.push({ type: "tool", tool: "todowrite", state: { status: "running" } })
          else if (roll < 0.6) parts.push({ type: "tool", tool: "todowrite", state: { status: "completed", metadata: { todos: "nope" } } })
          else {
            const todos = Array.from({ length: Math.floor(next() * 4) }, () => ({
              status: STATUSES[Math.floor(next() * STATUSES.length)],
            }))
            parts.push({ type: "tool", tool: "todowrite", state: { status: "completed", metadata: { todos } } })
          }
        }
        if (next() < 0.9) partsByMessage[id] = parts
      }
      expect(hasUnfinishedTodosInPromptParts(messages, partsByMessage), `seed ${seed}`).toBe(
        forwardReference(messages, partsByMessage),
      )
    }
    expect(hasUnfinishedTodosInPromptParts(undefined, {})).toBe(false)
  })
})
