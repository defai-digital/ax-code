import { describe, expect, test } from "vitest"
import type { MessageV2 } from "../../src/session/message-v2"
import {
  STALE_TODO_STEP_THRESHOLD,
  interruptionNotice,
  modelSwitchNotice,
  staleTodoNotice,
  stepsSinceTodoWrite,
} from "../../src/session/prompt/prompt-notices"

function userMessage(id: string, model = { providerID: "prov-a", modelID: "model-a" }) {
  return {
    info: { id, sessionID: "s1", role: "user" as const, model },
    parts: [{ type: "text" as const, text: "hi" }],
  } as any as MessageV2.WithParts
}

function assistantMessage(
  id: string,
  input: {
    error?: { name: string; data?: Record<string, unknown> }
    model?: { providerID: string; modelID: string }
  } = {},
) {
  const model = input.model ?? { providerID: "prov-a", modelID: "model-a" }
  return {
    info: {
      id,
      sessionID: "s1",
      role: "assistant" as const,
      providerID: model.providerID,
      modelID: model.modelID,
      ...(input.error ? { error: input.error } : {}),
    },
    parts: [{ type: "text" as const, text: "done" }],
  } as any as MessageV2.WithParts
}

function todoWriteMessage(id: string, status: "completed" | "error" = "completed") {
  return {
    info: { id, sessionID: "s1", role: "assistant" as const },
    parts: [{ type: "tool" as const, tool: "todowrite", state: { status } }],
  } as any as MessageV2.WithParts
}

describe("interruptionNotice", () => {
  test("fires when the last assistant turn ended in a user abort", () => {
    const messages = [
      userMessage("u1"),
      assistantMessage("a1", { error: { name: "MessageAbortedError", data: { message: "aborted" } } }),
      userMessage("u2"),
    ]
    const notice = interruptionNotice(messages)
    expect(notice).toBeDefined()
    expect(notice).toContain("<turn_interrupted>")
    expect(notice).toContain("interrupted")
  })

  test("stays quiet for ordinary turns, other errors, and empty history", () => {
    expect(
      interruptionNotice([
        userMessage("u1"),
        assistantMessage("a1", { error: { name: "APIError" } }),
        userMessage("u2"),
      ]),
    ).toBeUndefined()
    expect(interruptionNotice([userMessage("u1"), assistantMessage("a1"), userMessage("u2")])).toBeUndefined()
    expect(interruptionNotice([userMessage("u1")])).toBeUndefined()
  })

  test("only the newest assistant turn counts", () => {
    const messages = [
      userMessage("u1"),
      assistantMessage("a1", { error: { name: "MessageAbortedError" } }),
      userMessage("u2"),
      assistantMessage("a2"),
      userMessage("u3"),
    ]
    expect(interruptionNotice(messages)).toBeUndefined()
  })

  test("a reverted abort no longer fires: the removed message is simply absent", () => {
    // Revert drops the aborted turn from the message list; the projection is
    // pure over that list, so nothing else is needed to skip the marker.
    const afterRevert = [userMessage("u1"), userMessage("u2")]
    expect(interruptionNotice(afterRevert)).toBeUndefined()
  })
})

describe("stepsSinceTodoWrite", () => {
  test("counts assistant steps after the last completed todowrite", () => {
    const messages = [
      userMessage("u1"),
      assistantMessage("a1"),
      todoWriteMessage("a2"),
      assistantMessage("a3"),
      assistantMessage("a4"),
      userMessage("u2"),
      assistantMessage("a5"),
    ]
    expect(stepsSinceTodoWrite(messages)).toBe(3)
  })

  test("a completed todowrite on the newest assistant message resets to zero", () => {
    const messages = [userMessage("u1"), assistantMessage("a1"), todoWriteMessage("a2")]
    expect(stepsSinceTodoWrite(messages)).toBe(0)
  })

  test("a failed todowrite does not reset the count", () => {
    // The failed todowrite ran during its own assistant step, and since it
    // never recorded a list, that step counts as elapsed too.
    const messages = [userMessage("u1"), todoWriteMessage("a1", "error"), assistantMessage("a2")]
    expect(stepsSinceTodoWrite(messages)).toBe(2)
  })

  test("no todowrite in the visible history counts every assistant step", () => {
    const messages = [userMessage("u1"), assistantMessage("a1"), assistantMessage("a2"), userMessage("u2")]
    expect(stepsSinceTodoWrite(messages)).toBe(2)
  })
})

describe("staleTodoNotice", () => {
  test("requires open todos", () => {
    for (const steps of [0, 5, 10, 25]) {
      expect(staleTodoNotice({ openTodos: 0, stepsSinceTodoWrite: steps })).toBeUndefined()
    }
  })

  test(`fires at ${STALE_TODO_STEP_THRESHOLD} steps and then every ${STALE_TODO_STEP_THRESHOLD} further steps`, () => {
    expect(staleTodoNotice({ openTodos: 2, stepsSinceTodoWrite: STALE_TODO_STEP_THRESHOLD - 1 })).toBeUndefined()
    for (let steps = STALE_TODO_STEP_THRESHOLD; steps < STALE_TODO_STEP_THRESHOLD * 4; steps++) {
      const notice = staleTodoNotice({ openTodos: 2, stepsSinceTodoWrite: steps })
      if (steps % STALE_TODO_STEP_THRESHOLD === 0) {
        expect(notice).toBeDefined()
        expect(notice).toContain(`<stale_todos steps="${steps}">`)
        expect(notice).toContain("2 open todos")
      } else {
        expect(notice).toBeUndefined()
      }
    }
  })
})

describe("modelSwitchNotice", () => {
  test("fires once per switch and names both models", () => {
    const messages = [
      userMessage("u1", { providerID: "prov-a", modelID: "model-a" }),
      assistantMessage("a1", { model: { providerID: "prov-a", modelID: "model-a" } }),
      userMessage("u2", { providerID: "prov-b", modelID: "model-b" }),
    ]
    const notice = modelSwitchNotice(messages)
    expect(notice).toContain('<model_switch previous="prov-a/model-a" current="prov-b/model-b">')
  })

  test("same model stays quiet, including provider-equal model-equal", () => {
    const same = [
      userMessage("u1", { providerID: "prov-a", modelID: "model-a" }),
      assistantMessage("a1", { model: { providerID: "prov-a", modelID: "model-a" } }),
      userMessage("u2", { providerID: "prov-a", modelID: "model-a" }),
    ]
    expect(modelSwitchNotice(same)).toBeUndefined()
  })

  test("stops once an assistant message on the new model exists (one note per switch)", () => {
    const settled = [
      userMessage("u1", { providerID: "prov-a", modelID: "model-a" }),
      assistantMessage("a1", { model: { providerID: "prov-a", modelID: "model-a" } }),
      userMessage("u2", { providerID: "prov-b", modelID: "model-b" }),
      assistantMessage("a2", { model: { providerID: "prov-b", modelID: "model-b" } }),
      userMessage("u3", { providerID: "prov-b", modelID: "model-b" }),
    ]
    expect(modelSwitchNotice(settled)).toBeUndefined()
  })

  test("needs both a user and an assistant message", () => {
    expect(modelSwitchNotice([userMessage("u1")])).toBeUndefined()
    expect(
      modelSwitchNotice([userMessage("u1"), assistantMessage("a1", { model: { providerID: "p", modelID: "m" } })]),
    ).toBeDefined()
  })
})
