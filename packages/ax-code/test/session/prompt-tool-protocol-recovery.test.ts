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
      const model: Provider.Model = {
        id: ModelID.make("tiel-coder-35b-axq-mxfp4"),
        providerID: ProviderID.make(row.provider),
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
