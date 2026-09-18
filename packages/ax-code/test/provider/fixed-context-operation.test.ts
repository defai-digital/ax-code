import { afterEach, beforeEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { FixedContextError } from "../../src/provider/fixed-context"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

const state = vi.hoisted(() => ({
  config: vi.fn(),
  model: vi.fn(),
  defaultAgent: vi.fn(),
  agent: vi.fn(),
  language: vi.fn(),
  fetch: vi.fn(),
}))
vi.mock("../../src/config/config", () => ({ Config: { get: state.config } }))
vi.mock("../../src/agent/agent", () => ({ Agent: { defaultAgent: state.defaultAgent, get: state.agent } }))
vi.mock("../../src/permission", () => ({ Permission: { evaluate: () => ({ action: "allow" }) } }))
vi.mock("../../src/provider/provider", () => ({
  Provider: { getModel: state.model, getLanguage: state.language },
}))
import { askFixedContext } from "../../src/provider/fixed-context-operation"

const input = {
  files: ["value.py"],
  question: "What does this function return?",
  providerID: ProviderID.make("fixture"),
  modelID: ModelID.make("public/model"),
}
const config = { provider: { fixture: { management: "ax-trust" } } }
const model = { api: { id: "public/model", npm: "@ai-sdk/openai-compatible" } }
const agent = { permission: [] }
function language() {
  return createOpenAICompatible({
    name: "fixture",
    baseURL: "https://gateway.invalid/v1",
    fetch: state.fetch,
  }).chatModel("public/model")
}

beforeEach(() => {
  state.config.mockResolvedValue(config)
  state.model.mockResolvedValue(model)
  state.defaultAgent.mockResolvedValue("build")
  state.agent.mockResolvedValue(agent)
  state.language.mockImplementation(async () => language())
  state.fetch.mockImplementation(async () => {
    return new Response(
      JSON.stringify({
        id: "chatcmpl-current",
        object: "chat.completion",
        created: 123,
        model: "public/model",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "42" } }],
      }),
      { headers: { "content-type": "application/json" } },
    )
  })
})
afterEach(() => vi.resetAllMocks())

test("pre-cancelled questions return the cancellation domain error before setup", async () => {
  await using tmp = await tmpdir()
  await expect(
    askFixedContext(input, tmp.path, AbortSignal.abort("private cancellation reason")),
  ).rejects.toBeInstanceOf(FixedContextError)
  expect(state.config).not.toHaveBeenCalled()
  expect(state.fetch).not.toHaveBeenCalled()
})

const stages = ["config", "model", "defaultAgent", "agent", "language"] as const
test.each(stages)("cancellation settles pending %s setup and never advances to another stage", async (stage) => {
  await using tmp = await tmpdir()
  await fs.writeFile(path.join(tmp.path, "value.py"), "def value(): return 42")
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<unknown>()
  state[stage].mockImplementation(async () => {
    started.resolve()
    return release.promise
  })
  const controller = new AbortController()
  let settled: unknown
  const pending = askFixedContext(input, tmp.path, controller.signal).then(
    (value) => (settled = value),
    (error: unknown) => (settled = error),
  )
  await started.promise
  controller.abort("private cancellation reason")
  try {
    await vi.waitFor(() => expect(settled).toBeInstanceOf(FixedContextError), { timeout: 200 })
    expect(settled).toMatchObject({ message: "The fixed-context question was cancelled or timed out." })
  } finally {
    release.resolve({ config, model, defaultAgent: "build", agent, language: language() }[stage])
    await pending
  }
  for (const later of stages.slice(stages.indexOf(stage) + 1)) expect(state[later]).not.toHaveBeenCalled()
  expect(state.fetch).not.toHaveBeenCalled()
})

test("successful setup retains the existing request and result contract", async () => {
  await using tmp = await tmpdir()
  await fs.writeFile(path.join(tmp.path, "value.py"), "def value(): return 42")
  const result = await askFixedContext(input, tmp.path, new AbortController().signal)
  expect(result).toMatchObject({ answer: "42", providerID: "fixture", modelID: "public/model" })
  expect(state.fetch).toHaveBeenCalledOnce()
})
