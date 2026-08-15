import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import type { MessageV2 } from "../../src/session/message-v2"
import { insertReminders } from "../../src/session/prompt-reminders"
import { systemPrompt } from "../../src/session/prompt-system"
import { buildTurnContext } from "../../src/session/prompt-turn-context"
import { Todo } from "../../src/session/todo"
import { tmpdir } from "../fixture/fixture"

// Pending todos are gated on autonomous mode (default on). Pin the flag
// explicitly so a leaked env value cannot flip these assertions.
const origAutonomous = process.env.AX_CODE_AUTONOMOUS
beforeEach(() => {
  process.env.AX_CODE_AUTONOMOUS = "1"
})
afterEach(() => {
  if (origAutonomous === undefined) {
    delete process.env.AX_CODE_AUTONOMOUS
  } else {
    process.env.AX_CODE_AUTONOMOUS = origAutonomous
  }
})

function userMessage(id: string, sessionID: string) {
  return {
    info: { id, sessionID, role: "user" as const },
    parts: [{ type: "text" as const, text: "hi" }],
  } as any as MessageV2.WithParts
}

function editToolMessage(id: string, sessionID: string, filePath: string) {
  return {
    info: { id, sessionID, role: "assistant" as const },
    parts: [
      {
        type: "tool" as const,
        callID: `c-${id}`,
        tool: "edit",
        state: {
          status: "completed" as const,
          input: { filePath },
          output: "",
          title: "Edit",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
    ],
  } as any as MessageV2.WithParts
}

describe("buildTurnContext", () => {
  test("returns undefined when no per-turn state is present", async () => {
    const result = await buildTurnContext({
      messages: [userMessage("m1", "s1")],
      sessionID: "s1" as any,
      decisionHints: async () => undefined,
    })
    expect(result).toBeUndefined()
  })

  test("passes session id and messages into the decision hint loader", async () => {
    let received: Parameters<NonNullable<Parameters<typeof buildTurnContext>[0]["decisionHints"]>>[0] | undefined
    const messages = [userMessage("m1", "s1")]

    const result = await buildTurnContext({
      messages,
      sessionID: "s1" as any,
      decisionHints: async (input) => {
        received = input
        return "decision hints"
      },
    })

    expect(result).toContain("<turn_context>")
    expect(result).toContain("decision hints")
    expect(received?.messages).toBe(messages)
    expect(String(received?.sessionID)).toBe("s1")
  })

  test("renders goal, todos, hints, and nudge in one block", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "ship the feature" })
        Todo.update({
          sessionID: session.id,
          todos: [{ content: "write tests", status: "pending", priority: "high" }],
        })
        const messages = [
          userMessage("m1", session.id),
          editToolMessage("m2", session.id, "/repo/a.ts"),
          editToolMessage("m3", session.id, "/repo/b.ts"),
        ]

        const result = await buildTurnContext({
          messages,
          sessionID: session.id,
          decisionHints: async () => "<decision-hints>hint</decision-hints>",
        })

        expect(result).toBeDefined()
        const text = result!
        expect(text.startsWith("<turn_context>")).toBe(true)
        expect(text.endsWith("</turn_context>")).toBe(true)
        expect(text).toContain("<decision-hints>hint</decision-hints>")
        expect(text).toContain("<intelligence_nudge>")
        expect(text).toContain('<session_goal status="active" tokens_used="0">')
        expect(text).toContain("Objective: ship the feature")
        expect(text).toContain('<pending_todos count="1">')
        expect(text).toContain("[PENDING] write tests")
        // Preserve the relative order the blocks had in the system prompt.
        expect(text.indexOf("<decision-hints>")).toBeLessThan(text.indexOf("<intelligence_nudge>"))
        expect(text.indexOf("<intelligence_nudge>")).toBeLessThan(text.indexOf("<session_goal"))
        expect(text.indexOf("<session_goal")).toBeLessThan(text.indexOf("<pending_todos"))
      },
    })
  })

  test("omits pending todos when autonomous mode is off", async () => {
    process.env.AX_CODE_AUTONOMOUS = "0"
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        Todo.update({
          sessionID: session.id,
          todos: [{ content: "write tests", status: "pending", priority: "high" }],
        })

        const result = await buildTurnContext({
          messages: [userMessage("m1", session.id)],
          sessionID: session.id,
          decisionHints: async () => "hint",
        })

        expect(result).toContain("hint")
        expect(result).not.toContain("<pending_todos")
      },
    })
  })
})

describe("insertReminders turn context", () => {
  test("appends goal/todo state as a synthetic part on the last user message without mutating the input", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "ship the feature" })
        Todo.update({
          sessionID: session.id,
          todos: [{ content: "write tests", status: "pending", priority: "high" }],
        })
        const user = userMessage("m1", session.id)
        const messages = [user]
        const partCount = user.parts.length

        const result = await insertReminders({ messages, agent: { name: "build" } as any, session })

        const reminded = result.find((m) => m.info.id === user.info.id)!
        const synthetic = reminded.parts.filter((p) => p.type === "text" && p.synthetic)
        const turnContext = synthetic.find((p) => p.type === "text" && p.text.includes("<turn_context>"))
        expect(turnContext).toBeDefined()
        expect(turnContext!.type === "text" && turnContext!.text).toContain('<session_goal status="active"')
        expect(turnContext!.type === "text" && turnContext!.text).toContain('<pending_todos count="1">')
        // Request-only: the input message object and its parts are untouched,
        // so nothing is persisted into the durable transcript.
        expect(user.parts).toHaveLength(partCount)
      },
    })
  })

  test("adds no turn context part when no per-turn state is present", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messages = [userMessage("m1", session.id)]

        const result = await insertReminders({ messages, agent: { name: "build" } as any, session })

        const reminded = result.find((m) => m.info.id === "m1")!
        const hasTurnContext = reminded.parts.some(
          (p) => p.type === "text" && p.synthetic && p.text.includes("<turn_context>"),
        )
        expect(hasTurnContext).toBe(false)
      },
    })
  })
})

describe("system prompt cache stability", () => {
  const args = (cache: {}) =>
    ({
      agent: { name: "build" } as any,
      model: { providerID: ProviderID.make("openai"), api: { id: "gpt-5.2" } } as any,
      format: { type: "text" } as { type: string },
      cache,
      skills: async () => "skills",
      environment: async () => ["env"],
      instructions: async () => ["rules"],
      memory: async () => undefined,
    }) satisfies Parameters<typeof systemPrompt>[0]

  test("system array is byte-identical across changing goal and todo state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "ship the feature" })
        Todo.update({
          sessionID: session.id,
          todos: [{ content: "write tests", status: "pending", priority: "high" }],
        })

        const first = await systemPrompt(args({}))

        // Change the per-turn state that used to live in the system prompt.
        Todo.update({ sessionID: session.id, todos: [] })
        await SessionGoal.setStatus({ sessionID: session.id, status: "paused" })

        const second = await systemPrompt(args({}))

        expect(second).toEqual(first)
        const joined = second.join("\n")
        expect(joined).not.toContain("<session_goal")
        expect(joined).not.toContain("<pending_todos")
        expect(joined).not.toContain("<decision-hints>")
        expect(joined).not.toContain("<intelligence_nudge>")
      },
    })
  })
})
