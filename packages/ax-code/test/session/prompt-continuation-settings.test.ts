import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { createUserMessage } from "../../src/session/prompt/prompt-user-message"
import { createShellTurnMessages } from "../../src/session/prompt/prompt-shell-turn"
import { createAutonomousTextContinuation } from "../../src/session/prompt/prompt-user-message"
import { executeSubtask } from "../../src/session/prompt/prompt-subtask"
import { PartID } from "../../src/session/schema"
import { SessionSteering } from "../../src/session/steering"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

const model = { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.4") }
const settings = {
  tools: { bash: false, edit: false },
  isolation: { mode: "read-only" as const, network: false },
  system: "Preserve the existing workspace.",
  format: { type: "text" as const },
  variant: "high",
  requestedDepth: "deep" as const,
}

afterEach(() => vi.restoreAllMocks())

test("command subtask summaries retain the parent user execution settings", async () => {
  await using tmp = await tmpdir({ git: true, config: { provider: { openai: { options: { apiKey: "test-key" } } } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const user = await createUserMessage({
        sessionID: session.id,
        agent: "build",
        model,
        ...settings,
        parts: [{ type: "text", text: "Inspect the workspace." }],
      })
      const tool = await TaskTool.init()
      vi.spyOn(TaskTool, "init").mockResolvedValue({
        ...tool,
        execute: async () => ({
          title: "Inspection",
          output: "Inspection complete.",
          metadata: {
            sessionId: session.id,
            model,
            emptyResult: false,
            finalizeAttempted: false,
            recoveredFromEmpty: false,
            recoveredResultNeedsReview: false,
            subagentError: false,
          },
        }),
      })
      await executeSubtask(
        {
          id: PartID.ascending(),
          messageID: user.info.id,
          sessionID: session.id,
          type: "subtask",
          agent: "general",
          description: "Inspect",
          prompt: "Inspect the workspace.",
          command: "inspect",
        },
        {
          sessionID: session.id,
          lastUser: user.info,
          model: await Provider.getModel(model.providerID, model.modelID),
          abort: new AbortController().signal,
          msgs: [user],
          session,
        },
      )
      const continuation = (await Session.messages({ sessionID: session.id }))
        .filter((m) => m.info.role === "user")
        .at(-1)!
      expect(continuation.info.id).not.toBe(user.info.id)
      expect(continuation.info).toMatchObject(settings)
      expect(continuation.parts).toEqual([expect.objectContaining({ type: "text", synthetic: true })])
    },
  })
})

test("steering applied by the prompt loop retains the active response and execution settings", async () => {
  await using tmp = await tmpdir({ git: true, config: { provider: { openai: { options: { apiKey: "test-key" } } } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      let submitted = false
      vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
        const firstBuildTurn = input.agent.name === "build" && !submitted
        if (firstBuildTurn) {
          submitted = true
          await SessionSteering.submit(
            session.id,
            {
              expectedGeneration: SessionSteering.view(session.id).generation!,
              clientID: "settings-regression",
              text: "Keep the same constraints and inspect the next file.",
            },
            async () => {},
          )
        }
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "response" }
            yield { type: "text-delta", id: "response", text: "Inspection complete." }
            yield { type: "text-end", id: "response" }
            yield {
              type: "finish-step",
              finishReason: firstBuildTurn ? "tool-calls" : "stop",
              usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
            }
            yield { type: "finish" }
          })(),
        } as unknown as Awaited<ReturnType<typeof LLM.stream>>
      })
      await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "build",
        model,
        ...settings,
        parts: [{ type: "text", text: "Inspect the workspace." }],
      })
      expect(submitted).toBe(true)
      const receipt = SessionSteering.view(session.id).receipts.find((r) => r.clientID === "settings-regression")
      expect(receipt?.status).toBe("applied")
      const users = (await Session.messages({ sessionID: session.id })).filter((m) => m.info.role === "user")
      expect(users).toHaveLength(2)
      expect(users[1]!.info).toMatchObject(settings)
    },
  })
})

test("user shell turns preserve restrictions for subsequent autonomous work", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      await createUserMessage({
        sessionID: session.id,
        agent: "build",
        model,
        ...settings,
        parts: [{ type: "text", text: "Inspect the workspace." }],
      })
      await createShellTurnMessages({ sessionID: session.id, agent: "build", model, command: "pwd" })
      const messages = await Session.messages({ sessionID: session.id })
      const shellUser = messages.filter((m) => m.info.role === "user").at(-1)!
      expect(shellUser.info).toMatchObject(settings)
      await createAutonomousTextContinuation({ sessionID: session.id, messages, text: "Continue the inspection." })
      const continued = (await Session.messages({ sessionID: session.id }))
        .filter((m) => m.info.role === "user")
        .at(-1)!
      expect(continued.info).toMatchObject(settings)
    },
  })
})
