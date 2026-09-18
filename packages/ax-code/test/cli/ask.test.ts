import { afterEach, beforeEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import yargs from "yargs"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { tmpdir } from "../fixture/fixture"
import { parseJsonStrict } from "../../src/util/json-value"

const state = vi.hoisted(() => ({
  management: "ax-trust",
  axTrust: undefined as boolean | undefined,
  allow: "allow",
  calls: 0,
  loads: 0,
  bodies: [] as unknown[],
}))
vi.mock("../../src/cli/bootstrap", () => ({ bootstrapReadonly: async (_: string, cb: () => Promise<unknown>) => cb() }))
vi.mock("../../src/config/config", () => ({
  Config: {
    get: async () => ({ provider: { fixture: { management: state.management, options: { axTrust: state.axTrust } } } }),
  },
}))
vi.mock("../../src/agent/agent", () => ({
  Agent: { defaultAgent: async () => "build", get: async () => ({ permission: [] }) },
}))
vi.mock("../../src/permission", () => ({ Permission: { evaluate: () => ({ action: state.allow }) } }))
vi.mock("../../src/provider/provider", () => ({
  Provider: {
    parseModel: () => ({ providerID: "fixture", modelID: "public/model" }),
    getModel: async () => ({ api: { id: "public/model", npm: "@ai-sdk/openai-compatible" } }),
    getLanguage: async () => {
      state.loads++
      return createOpenAICompatible({
        name: "fixture",
        baseURL: "https://gateway.invalid/v1",
        fetch: async (_, init) => {
          state.calls++
          state.bodies.push(parseJsonStrict(String(init?.body)))
          return new Response(
            JSON.stringify({
              id: "chatcmpl-new",
              object: "chat.completion",
              created: 123,
              model: "public/model",
              choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "It returns 42." } }],
            }),
            { headers: { "content-type": "application/json", "x-ax-semantic-cache": "HIT" } },
          )
        },
      }).chatModel("public/model")
    },
  },
}))
import { AskCommand } from "../../src/cli/cmd/ask"

const cwd = process.cwd()
beforeEach(() => {
  state.management = "ax-trust"
  state.axTrust = undefined
  state.allow = "allow"
  state.calls = 0
  state.loads = 0
  state.bodies = []
})
afterEach(() => {
  process.chdir(cwd)
  vi.restoreAllMocks()
})
function run(args: string[]) {
  return yargs()
    .command(AskCommand as never)
    .exitProcess(false)
    .parseAsync(args)
}

test("ask parses repeatable files and emits answer/cache metadata with no usage fabrication", async () => {
  await using tmp = await tmpdir()
  process.chdir(tmp.path)
  await fs.writeFile(path.join(tmp.path, "value.py"), "def value(): return 42")
  await fs.writeFile(path.join(tmp.path, "README.md"), "A pure function.")
  let output = ""
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk)
    return true
  })
  await run([
    "ask",
    "--file",
    "value.py",
    "--file",
    "README.md",
    "--model",
    "fixture/public/model",
    "--format",
    "json",
    "What does this function return?",
  ])
  expect(state.calls).toBe(1)
  expect(parseJsonStrict(output)).toMatchObject({
    answer: "It returns 42.",
    cache: { status: "HIT" },
    providerID: "fixture",
    modelID: "public/model",
  })
  expect(parseJsonStrict(output)).not.toHaveProperty("usage")
  expect(state.bodies[0]).toMatchObject({ model: "public/model", temperature: 0, max_tokens: 512 })
})

test.each(["deny", "ask"])("read permission %s stops before model transport initialization", async (action) => {
  await using tmp = await tmpdir()
  process.chdir(tmp.path)
  await fs.writeFile(path.join(tmp.path, "value.py"), "private source")
  state.allow = action
  await expect(run(["ask", "-f", "value.py", "-m", "fixture/public/model", "Explain the source?"])).rejects.toThrow(
    "permission",
  )
  expect(state.calls).toBe(0)
  expect(state.loads).toBe(0)
})

test("non-AX Trust provider is rejected without opening transport", async () => {
  state.management = "custom-api"
  await expect(run(["ask", "-f", "missing", "-m", "fixture/public/model", "Explain the source?"])).rejects.toThrow(
    "AX Trust",
  )
  expect(state.loads).toBe(0)
})

test("disabling session affinity does not disable fixed-context questions", async () => {
  await using tmp = await tmpdir()
  process.chdir(tmp.path)
  await fs.writeFile(path.join(tmp.path, "value.py"), "def value(): return 42")
  state.axTrust = false
  vi.spyOn(process.stdout, "write").mockReturnValue(true)
  vi.spyOn(process.stderr, "write").mockReturnValue(true)
  await run(["ask", "-f", "value.py", "-m", "fixture/public/model", "--max-tokens", "1024", "Explain the source?"])
  expect(state.calls).toBe(1)
  expect(state.bodies[0]).toMatchObject({ max_tokens: 1024 })
})

test("session affinity opt-in does not identify a generic provider as AX Trust", async () => {
  state.management = "custom-api"
  state.axTrust = true
  await expect(run(["ask", "-f", "missing", "-m", "fixture/public/model", "Explain the source?"])).rejects.toThrow(
    "Select a connected AX Trust provider",
  )
  expect(state.loads).toBe(0)
})
