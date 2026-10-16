import { describe, expect, test, vi } from "vitest"
import { Agent } from "../../src/agent/agent"
import type { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const model: Provider.Model = {
  id: "test-model" as any,
  providerID: "test" as any,
  name: "Test",
  family: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: {
    context: 128_000,
    output: 8_192,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

describe("session.processor step tool-result budget (ADR-211)", () => {
  test("spills the largest step results until the total fits; keeps ids, order, and errors intact", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        username: "testuser",
        tool_output: { step_budget_bytes: 8 * 1024 },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          tools: {},
          mode: "build",
        } as MessageV2.User)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: session.id,
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
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const smallOutput = "small-result\n".repeat(200) // ~2.8 KB, stays intact
        const largeOutput = "x".repeat(30 * 1024) // spilled to a ~2 KB preview
        const streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_small", toolName: "read" }
            yield { type: "tool-call", toolCallId: "call_small", toolName: "read", input: { path: "small.txt" } }
            yield {
              type: "tool-result",
              toolCallId: "call_small",
              input: { path: "small.txt" },
              output: { output: smallOutput, title: "Read", metadata: {}, attachments: [] },
            }
            yield { type: "tool-input-start", id: "call_large", toolName: "read" }
            yield { type: "tool-call", toolCallId: "call_large", toolName: "read", input: { path: "large.txt" } }
            yield {
              type: "tool-result",
              toolCallId: "call_large",
              input: { path: "large.txt" },
              output: { output: largeOutput, title: "Read", metadata: {}, attachments: [] },
            }
            yield { type: "tool-input-start", id: "call_error", toolName: "bash" }
            yield { type: "tool-call", toolCallId: "call_error", toolName: "bash", input: { command: "boom" } }
            yield {
              type: "tool-error",
              toolCallId: "call_error",
              input: { command: "boom" },
              error: new Error("boom failed"),
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }
            yield { type: "finish" }
          })(),
        } as any)
        try {
          const processor = SessionProcessor.create({
            assistantMessage: assistant as MessageV2.Assistant,
            sessionID: session.id,
            model,
            abort: AbortSignal.any([]),
          })
          const result = await processor.process({
            user: user as MessageV2.User,
            agent: await Agent.get("build"),
            abort: AbortSignal.any([]),
            sessionID: session.id,
            system: [],
            messages: [],
            tools: {},
            model,
          })
          expect(result).toBe("continue")

          const persisted = await MessageV2.get({ sessionID: session.id, messageID: processor.message.id })
          const toolParts = persisted.parts.filter((part) => part.type === "tool") as MessageV2.ToolPart[]
          // Call ids and result order are unchanged by the budget pass.
          expect(toolParts.map((part) => part.callID)).toEqual(["call_small", "call_large", "call_error"])

          const small = toolParts.find((part) => part.callID === "call_small")!
          const large = toolParts.find((part) => part.callID === "call_large")!
          const failed = toolParts.find((part) => part.callID === "call_error")!

          // The small result is under the step budget and stays intact.
          expect(small.state.status).toBe("completed")
          if (small.state.status === "completed") expect(small.state.output).toBe(smallOutput)

          // The largest result spills through the Truncate path: a bounded
          // preview plus the spill-file note naming how to read it back.
          expect(large.state.status).toBe("completed")
          if (large.state.status === "completed") {
            const output = large.state.output as string
            expect(output).toContain("bytes truncated")
            expect(output).toContain("Full output saved to")
            expect(Buffer.byteLength(output, "utf-8")).toBeLessThan(6 * 1024)
          }

          // Errors are never spilled.
          expect(failed.state.status).toBe("error")
          if (failed.state.status === "error") {
            expect(failed.state.error).toContain("boom failed")
          }
        } finally {
          streamSpy.mockRestore()
        }
      },
    })
  })

  test("under-budget steps leave every result untouched", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        username: "testuser",
        tool_output: { step_budget_bytes: 64 * 1024 },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          tools: {},
          mode: "build",
        } as MessageV2.User)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: session.id,
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
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const output = "y".repeat(10 * 1024)
        const streamSpy = vi.spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_only", toolName: "read" }
            yield { type: "tool-call", toolCallId: "call_only", toolName: "read", input: { path: "file.txt" } }
            yield {
              type: "tool-result",
              toolCallId: "call_only",
              input: { path: "file.txt" },
              output: { output, title: "Read", metadata: {}, attachments: [] },
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }
            yield { type: "finish" }
          })(),
        } as any)
        try {
          const processor = SessionProcessor.create({
            assistantMessage: assistant as MessageV2.Assistant,
            sessionID: session.id,
            model,
            abort: AbortSignal.any([]),
          })
          const result = await processor.process({
            user: user as MessageV2.User,
            agent: await Agent.get("build"),
            abort: AbortSignal.any([]),
            sessionID: session.id,
            system: [],
            messages: [],
            tools: {},
            model,
          })
          expect(result).toBe("continue")

          const persisted = await MessageV2.get({ sessionID: session.id, messageID: processor.message.id })
          const toolPart = persisted.parts.find((part) => part.type === "tool") as MessageV2.ToolPart
          expect(toolPart.state.status).toBe("completed")
          if (toolPart.state.status === "completed") expect(toolPart.state.output).toBe(output)
        } finally {
          streamSpy.mockRestore()
        }
      },
    })
  })
})
