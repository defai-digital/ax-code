import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

const previousAutonomous = process.env.AX_CODE_AUTONOMOUS
const malformed =
  '<tool_call>\n{"name":"bash","arguments":{"command":"printf should-not-run","description":"Count Python lines"}\n</tool_call>'

afterEach(async () => {
  vi.restoreAllMocks()
  if (previousAutonomous === undefined) delete process.env.AX_CODE_AUTONOMOUS
  else process.env.AX_CODE_AUTONOMOUS = previousAutonomous
  await Instance.disposeAll()
})

test.each([
  { provider: "ax-engine", recovery: malformed, turns: 2, failed: true },
  { provider: "ax-engine", recovery: "The earlier count found 238 Python code lines.", turns: 2, failed: false },
  { provider: "other", recovery: "unused", turns: 1, failed: true },
])("bounds persisted malformed-tool recovery: $provider failed=$failed", async (row) => {
  process.env.AX_CODE_AUTONOMOUS = "true"
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = fixtureModel(row.provider)
      vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      const requests: LLM.StreamInput[] = []
      vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
        requests.push(input)
        const text = requests.length === 1 ? malformed : row.recovery
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "text_1" }
            yield { type: "text-delta", id: "text_1", text }
            yield { type: "text-end", id: "text_1" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 75, totalTokens: 175 },
            }
            yield { type: "finish" }
          })(),
        } as unknown as LLM.StreamOutput
      })
      const session = await Session.create({ title: "Protocol recovery regression" })
      await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: { providerID: model.providerID, modelID: model.id },
        parts: [{ type: "text", text: "Count Python code only" }],
      })
      const messages = await Session.messages({ sessionID: session.id })
      const assistants = messages.filter((message) => message.info.role === "assistant")
      expect(assistants).toHaveLength(row.turns)
      expect(requests).toHaveLength(row.turns)
      expect(messages.flatMap((message) => message.parts).filter((part) => part.type === "tool")).toEqual([])
      const last = assistants.at(-1)!.info
      expect(last.role === "assistant" && !!last.error).toBe(row.failed)
      if (row.turns === 2) {
        expect(requests[1].toolChoice).not.toBe("none")
        expect(JSON.stringify(requests[1].messages)).toContain("No action from that markup ran")
        expect(JSON.stringify(requests[1].messages)).not.toContain("was forced text-only")
      }
      await Session.remove(session.id)
    },
  })
})

function fixtureModel(provider: string): Provider.Model {
  return {
    id: ModelID.make("tiel-coder-35b-axq-mxfp4"),
    providerID: ProviderID.make(provider),
    name: "Tiel protocol fixture",
    family: "tiel-coder-35b-axq-mxfp4",
    api: { id: "tiel-coder-35b-axq-mxfp4", url: "http://127.0.0.1:1/v1", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: { context: 65536, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-09-19",
  }
}

test.each([
  { name: "soft synthesis", steps: ["read", "read", "answer"], failed: false },
  { name: "truncated synthesis retries once", steps: ["read", "read", "read", "truncated", "answer"], failed: false },
  { name: "empty synthesis retries once", steps: ["read", "read", "read", "empty", "answer"], failed: false },
  {
    name: "retry remains bounded across pacing continuation",
    steps: ["read", "read", "read", "blocked", "blocked"],
    failed: true,
    pacing: true,
  },
  { name: "guarded synthesis", steps: ["read", "read", "read", "answer"], failed: false },
  { name: "blocked calls are bounded", steps: ["read", "read", "read", "blocked", "blocked"], failed: true },
  {
    name: "blocked call can recover without dropping schemas",
    steps: ["read", "read", "read", "blocked", "answer"],
    failed: false,
  },
  { name: "markup retry stays guarded", steps: ["read", "read", "read", "markup", "blocked"], failed: true },
  { name: "new evidence during soft synthesis", steps: ["read", "read", "fresh", "answer"], failed: false },
  { name: "mutation during soft synthesis", steps: ["read", "read", "write", "answer"], failed: false },
])("local convergence: $name", async ({ steps, failed, pacing }) => {
  process.env.AX_CODE_AUTONOMOUS = "true"
  await using tmp = await tmpdir({
    git: true,
    ...(pacing ? { config: { agent: { build: { steps: 5 } }, session: { max_continuations: 1 } } } : {}),
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = fixtureModel("ax-engine")
      vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      const requests: LLM.StreamInput[] = []
      vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
        requests.push(input)
        const step = steps[requests.length - 1]
        if (!step) throw new Error("Unbounded local synthesis")
        const isTool = ["read", "fresh", "write", "blocked"].includes(step)
        const toolName = step === "write" ? "write" : "read"
        const toolInput = {
          filePath: `${tmp.path}/README.md`,
          ...(step === "write" ? { content: "Updated README" } : {}),
        }
        const callID = `call_${requests.length}`
        if (step === "blocked") {
          // Exercise the actual resolved execution boundary, not only stream events.
          await expect(
            input.tools.read.execute!(toolInput, { toolCallId: callID, messages: input.messages }),
          ).rejects.toThrow("No tool ran")
        }
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            if (isTool) {
              yield { type: "tool-input-start", id: callID, toolName }
              yield { type: "tool-call", toolCallId: callID, toolName, input: toolInput }
              if (step === "blocked") {
                yield {
                  type: "tool-error",
                  toolCallId: callID,
                  toolName,
                  input: toolInput,
                  error: new Error("Local synthesis: No tool ran"),
                }
              } else {
                yield {
                  type: "tool-result",
                  toolCallId: callID,
                  input: toolInput,
                  output: {
                    output: step === "fresh" ? "Updated README evidence" : "# README\nA developer guide.",
                    title: "README",
                    metadata: {},
                    attachments: [],
                  },
                }
              }
            } else {
              yield { type: "text-start", id: "text_1" }
              yield {
                type: "text-delta",
                id: "text_1",
                text:
                  step === "markup"
                    ? malformed
                    : step === "empty"
                      ? ""
                      : "The README needs a project overview. Test coverage was not measured.",
              }
              yield { type: "text-end", id: "text_1" }
            }
            yield {
              type: "finish-step",
              finishReason: isTool
                ? "tool-calls"
                : step === "truncated"
                  ? "length"
                  : step === "empty"
                    ? "other"
                    : "stop",
              usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            }
            yield { type: "finish" }
          })(),
        } as unknown as LLM.StreamOutput
      })
      const session = await Session.create({ title: "Local synthesis regression" })
      await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: { providerID: model.providerID, modelID: model.id },
        parts: [{ type: "text", text: "Review README.md and suggest improvements" }],
      })
      expect(requests).toHaveLength(steps.length)
      for (const request of requests) {
        expect(request.toolChoice).toBeUndefined()
        expect(Object.keys(request.tools)).toEqual(Object.keys(requests[0].tools))
        expect(request.system).toEqual(requests[0].system)
      }
      expect(JSON.stringify(requests[2].messages)).toContain("previous turn repeated successful inspection")
      expect(JSON.stringify(requests[2].messages)).toContain("test-file counts do not measure coverage")
      if (steps.length === 5) expect(JSON.stringify(requests[4].messages)).toContain("Final local synthesis retry")
      const messages = await Session.messages({ sessionID: session.id })
      const last = messages.filter((message) => message.info.role === "assistant").at(-1)!.info
      expect(last.role === "assistant" && !!last.error).toBe(failed)
      if (failed && last.role === "assistant") expect(JSON.stringify(last.error)).toContain("task remains incomplete")
      await Session.remove(session.id)
    },
  })
})
