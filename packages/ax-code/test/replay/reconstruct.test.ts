import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Replay } from "../../src/replay/replay"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"
import { Agent } from "../../src/agent/agent"
import { MessageID } from "../../src/session/schema"
import type { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

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
  cost: { input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

let streamSpy: ReturnType<typeof spyOn> | undefined
afterEach(() => {
  streamSpy?.mockRestore()
  streamSpy = undefined
})

describe("replay.reconstructStream", () => {
  test("reconstructs steps from recorded events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)

        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({ type: "step.start", sessionID: sid, stepIndex: 0 })
        Recorder.emit({
          type: "llm.output",
          sessionID: sid,
          stepIndex: 0,
          parts: [
            { type: "text", text: "Hello world" },
            { type: "tool_call", callID: "call_1", tool: "read", input: { file_path: "/tmp/test.ts" } },
          ],
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          tool: "read",
          callID: "call_1",
          status: "completed",
          output: "file contents",
          durationMs: 50,
          stepIndex: 0,
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: sid,
          stepIndex: 0,
          finishReason: "tool-calls",
          tokens: { input: 100, output: 50 },
        })
        Recorder.emit({ type: "step.start", sessionID: sid, stepIndex: 1 })
        Recorder.emit({
          type: "llm.output",
          sessionID: sid,
          stepIndex: 1,
          parts: [
            { type: "reasoning", text: "thinking about it" },
            { type: "text", text: "Done!" },
          ],
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: sid,
          stepIndex: 1,
          finishReason: "stop",
          tokens: { input: 150, output: 30 },
        })
        Recorder.emit({ type: "session.end", sessionID: sid, reason: "completed", totalSteps: 2 })

        Recorder.end(sid)

        // Wait for microtasks to flush
        await new Promise((r) => setTimeout(r, 50))

        const { steps } = Replay.reconstructStream(sid)
        expect(steps).toHaveLength(2)

        // Step 0: text + tool call
        expect(steps[0].stepIndex).toBe(0)
        expect(steps[0].parts).toHaveLength(2)
        expect(steps[0].parts[0]).toEqual({ type: "text", text: "Hello world" })
        expect(steps[0].parts[1]).toEqual({
          type: "tool_call",
          callID: "call_1",
          tool: "read",
          input: { file_path: "/tmp/test.ts" },
        })
        expect(steps[0].toolResults).toHaveLength(1)
        expect(steps[0].toolResults[0].status).toBe("completed")
        expect(steps[0].finishReason).toBe("tool-calls")

        // Step 1: reasoning + text
        expect(steps[1].stepIndex).toBe(1)
        expect(steps[1].parts).toHaveLength(2)
        expect(steps[1].parts[0]).toEqual({ type: "reasoning", text: "thinking about it" })
        expect(steps[1].parts[1]).toEqual({ type: "text", text: "Done!" })
        expect(steps[1].toolResults).toHaveLength(0)
        expect(steps[1].finishReason).toBe("stop")

        // Cleanup
        EventQuery.deleteBySession(sid)
      },
    })
  })

  test("toFullStream generates valid stream events", async () => {
    const steps: Replay.ReconstructedStep[] = [
      {
        stepIndex: 0,
        parts: [
          { type: "text", text: "Hello" },
          { type: "tool_call", callID: "c1", tool: "glob", input: { pattern: "*" } },
        ],
        toolResults: [{ callID: "c1", tool: "glob", status: "completed", output: "file.ts" }],
        finishReason: "tool-calls",
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ]

    const events: { type: string }[] = []
    for await (const event of Replay.toFullStream(steps)) {
      events.push(event as { type: string })
    }

    const types = events.map((e) => e.type)
    expect(types).toContain("start")
    expect(types).toContain("start-step")
    expect(types).toContain("text-start")
    expect(types).toContain("text-delta")
    expect(types).toContain("text-end")
    expect(types).toContain("tool-input-start")
    expect(types).toContain("tool-call")
    expect(types).toContain("tool-result")
    expect(types).toContain("finish-step")
    expect(types).toContain("finish")
  })

  test("toFullStream handles tool errors", async () => {
    const steps: Replay.ReconstructedStep[] = [
      {
        stepIndex: 0,
        parts: [{ type: "tool_call", callID: "c1", tool: "read", input: { file_path: "/bad" } }],
        toolResults: [{ callID: "c1", tool: "read", status: "error", error: "ENOENT" }],
        finishReason: "stop",
        usage: { inputTokens: 50, outputTokens: 10 },
      },
    ]

    const events: { type: string }[] = []
    for await (const event of Replay.toFullStream(steps)) {
      events.push(event as { type: string })
    }

    expect(events.map((e) => e.type)).toContain("tool-error")
  })

  test("empty session returns empty steps", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { steps } = Replay.reconstructStream(session.id)
        expect(steps).toHaveLength(0)
      },
    })
  })

  test("R3: prepareExecution feeds mock stream into processor", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a session with recorded events
        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)

        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({ type: "step.start", sessionID: sid, stepIndex: 0 })
        Recorder.emit({
          type: "llm.output",
          sessionID: sid,
          stepIndex: 0,
          parts: [{ type: "text", text: "Replayed response" }],
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: sid,
          stepIndex: 0,
          finishReason: "stop",
          tokens: { input: 100, output: 20 },
        })
        Recorder.emit({ type: "session.end", sessionID: sid, reason: "completed", totalSteps: 1 })
        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        // Prepare execution — get reconstructed mock stream
        const { steps, stream } = Replay.prepareExecution(sid)
        expect(steps).toHaveLength(1)

        // Mock LLM.stream to use the reconstructed stream
        streamSpy = spyOn(LLM, "stream").mockResolvedValue({ fullStream: stream } as any)

        // Create processor and run
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: sid,
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
          sessionID: sid,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: sid,
          model,
          abort: AbortSignal.any([]),
        })

        const result = await processor.process({
          user: user as MessageV2.User,
          agent: (await Agent.get("build"))!,
          abort: AbortSignal.any([]),
          sessionID: sid,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        // Verify: processor consumed the mock stream and produced a result
        expect(result).toBe("continue")
        expect(processor.message.finish).toBe("stop")
        expect(streamSpy.mock.calls.length).toBe(1)

        // Cleanup
        EventQuery.deleteBySession(sid)
      },
    })
  })
})
