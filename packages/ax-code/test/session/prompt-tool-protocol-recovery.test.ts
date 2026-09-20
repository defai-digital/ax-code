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
  { name: "synthesizes with tools retained", stubborn: false, fresh: false, mutation: false, expectedTurns: 3 },
  {
    name: "bounds alternating duplicate reads and malformed text",
    stubborn: true,
    fresh: false,
    mutation: false,
    expectedTurns: 7,
  },
  {
    name: "allows another recovery after changed evidence",
    stubborn: true,
    fresh: true,
    mutation: false,
    expectedTurns: 8,
  },
  {
    name: "allows implementation after synthesis and replenishes recovery",
    stubborn: true,
    fresh: false,
    mutation: true,
    expectedTurns: 9,
  },
])("local README convergence $name", async ({ stubborn, fresh, mutation, expectedTurns }) => {
  process.env.AX_CODE_AUTONOMOUS = "true"
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = fixtureModel("ax-engine")
      vi.spyOn(Provider, "getModel").mockResolvedValue(model)
      const requests: LLM.StreamInput[] = []
      vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
        requests.push(input)
        if (requests.length > 10) throw new Error("Unbounded convergence loop")
        const finishing = (fresh || mutation) && requests.length === expectedTurns
        const read = !finishing && input.toolChoice !== "none" && (stubborn || requests.length < 3)
        const callID = `read_${requests.length}`
        const toolName = mutation && requests.length === 5 ? "write" : "read"
        const toolInput = {
          filePath: `${tmp.path}/README.md`,
          ...(toolName === "write" ? { content: "Updated README" } : {}),
        }
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            if (read) {
              yield { type: "tool-input-start", id: callID, toolName }
              yield {
                type: "tool-call",
                toolCallId: callID,
                toolName,
                input: toolInput,
              }
              yield {
                type: "tool-result",
                toolCallId: callID,
                input: toolInput,
                output: {
                  output:
                    fresh && requests.length >= 5
                      ? "# README\nUpdated developer guide."
                      : "# README\nA developer guide.",
                  title: "README",
                  metadata: {},
                  attachments: [],
                },
              }
            } else {
              yield { type: "text-start", id: "text_1" }
              yield {
                type: "text-delta",
                id: "text_1",
                text:
                  stubborn && !finishing
                    ? malformed
                    : "The README needs a short project overview before the development instructions.",
              }
              yield { type: "text-end", id: "text_1" }
            }
            yield {
              type: "finish-step",
              finishReason: read ? "tool-calls" : "stop",
              usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
            }
            yield { type: "finish" }
          })(),
        } as unknown as LLM.StreamOutput
      })
      const session = await Session.create({ title: "README convergence regression" })
      await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: { providerID: model.providerID, modelID: model.id },
        parts: [{ type: "text", text: "Review README.md and suggest improvements" }],
      })
      expect(requests).toHaveLength(expectedTurns)
      expect(requests.slice(0, 3).every((request) => request.toolChoice !== "none")).toBe(true)
      expect(Object.keys(requests[2].tools)).toEqual(Object.keys(requests[1].tools))
      expect(requests[2].system).toEqual(requests[1].system)
      expect(requests[2].toolChoice).toBe(requests[1].toolChoice)
      expect(JSON.stringify(requests[2].messages)).toContain("Local-engine synthesis checkpoint")
      const messages = await Session.messages({ sessionID: session.id })
      const assistants = messages.filter((message) => message.info.role === "assistant")
      const last = assistants.at(-1)!.info
      expect(last.role === "assistant" && !!last.error).toBe(stubborn && !fresh && !mutation)
      const tools = messages.flatMap((message) => message.parts).filter((part) => part.type === "tool")
      expect(tools.every((part) => part.tool === "read" || (mutation && part.tool === "write"))).toBe(true)
      if (mutation) expect(tools.filter((part) => part.tool === "write")).toHaveLength(1)
      if (stubborn) expect(requests.filter((request) => request.toolChoice === "none")).toHaveLength(2)
      await Session.remove(session.id)
    },
  })
})
