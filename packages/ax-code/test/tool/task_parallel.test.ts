import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { TaskParallelTool } from "../../src/tool/task_parallel"
import { WriteIsolation } from "../../src/session/write-isolation"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

/**
 * task_parallel integration with LLM sessions is covered by smoke dogfood.
 * Unit coverage here locks the write-isolation gate the tool applies before
 * fan-out (ADR-048 Phase 1).
 */
describe("task_parallel write isolation contract", () => {
  test("parallel explore digs are permitted", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      {
        name: "explore",
        permission: [
          { permission: "*", pattern: "*", action: "deny" },
          { permission: "read", pattern: "*", action: "allow" },
        ],
      },
      {
        name: "explore",
        permission: [
          { permission: "*", pattern: "*", action: "deny" },
          { permission: "grep", pattern: "*", action: "allow" },
        ],
      },
    ])
    expect(decision.ok).toBe(true)
  })

  test("parallel build digs are rejected", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      {
        name: "build",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      {
        name: "test",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
    ])
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("expected multi_writer rejection")
    expect(decision.reason).toBe("multi_writer")
  })
})

describe("task_parallel prompt routing", () => {
  test("foreground parallel prompts preserve the requested agent when the prompt mentions a bug", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: parent.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test" as any, modelID: "test-model" as any },
          tools: {},
          mode: "build",
        } as any)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: parent.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: "test-model",
          providerID: "test",
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        let calls = 0
        const promptSpy = vi.spyOn(SessionPrompt, "prompt").mockImplementation((async (input: any) => {
          calls++
          return {
            info: {
              id: input.messageID,
              sessionID: input.sessionID,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: calls === 1 ? [] : [{ type: "text", text: "no bugs found" }],
          } as any
        }) as any)

        try {
          const result = await (
            await TaskParallelTool.init()
          ).execute(
            {
              tasks: [
                {
                  description: "Hunt bug in engines",
                  prompt: "find the bug in the slide engine",
                  subagent_type: "explore",
                },
              ],
            },
            {
              sessionID: parent.id,
              messageID: assistant.id,
              callID: "",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => {},
              ask: async () => {},
              extra: {},
            } as any,
          )

          expect(promptSpy).toHaveBeenCalledTimes(2)
          for (const [input] of promptSpy.mock.calls) {
            expect(input).toMatchObject({
              agent: "explore",
              agentRouting: "preserve",
            })
          }
          expect(result.output).toContain("no bugs found")
        } finally {
          promptSpy.mockRestore()
        }
      },
    })
  })
})
