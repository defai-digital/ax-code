import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import type { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

// Kept in its own file so toggling AX_CODE_AUTONOMOUS off is isolated from the
// other (autonomous-on) goal integration tests. The assertion counts this
// session's own assistant messages (= turns) rather than the shared LLM.stream
// spy, so a stray async turn leaked by an earlier test can't perturb the count.
// The autonomous-ON continuation path is covered by goal.test.ts ("active goal
// continues until model marks it complete").

const model: Provider.Model = {
  id: "test-model" as any,
  providerID: "test" as any,
  name: "Test",
  family: "test",
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: { context: 128_000, output: 8_192 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const prevAutonomous = process.env.AX_CODE_AUTONOMOUS
let streamSpy: MockInstance | undefined
let modelSpy: MockInstance | undefined

afterEach(() => {
  streamSpy?.mockRestore()
  streamSpy = undefined
  modelSpy?.mockRestore()
  modelSpy = undefined
  if (prevAutonomous === undefined) delete process.env.AX_CODE_AUTONOMOUS
  else process.env.AX_CODE_AUTONOMOUS = prevAutonomous
})

async function assistantTurnCount(sessionID: SessionID) {
  const messages = await Session.messages({ sessionID })
  return messages.filter((message) => message.info.role === "assistant").length
}

describe("goal continuation respects the autonomous gate", () => {
  test("an active goal does NOT auto-continue when autonomous mode is off", async () => {
    // Goal auto-continuation is autonomy and must respect the autonomous gate
    // like every other continuation. With autonomous off the Super-Long ceiling
    // does not apply and `step` resets on each continuation, so an ungated goal
    // would loop with no time/step guardrail at all. Exactly one user-driven turn
    // must run; the goal still persists for the next user-driven turn.
    process.env.AX_CODE_AUTONOMOUS = "false"
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "keep working without autonomy" })
        modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        // The mock never marks the goal complete: if the goal were ungated it
        // would auto-continue forever, so this also guards against the loop hang.
        streamSpy = vi.spyOn(LLM, "stream").mockImplementation((async () => {
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: "text_1" }
              yield { type: "text-delta", id: "text_1", text: "one turn" }
              yield { type: "text-end", id: "text_1" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
              }
              yield { type: "finish" }
            })(),
          } as any
        }) as any)

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          parts: [{ type: "text", text: "start work" }],
        })

        expect(await assistantTurnCount(session.id)).toBe(1)
        expect((await SessionGoal.get(session.id))?.status).toBe("active")

        await Session.remove(session.id)
      },
    })
  })
})
