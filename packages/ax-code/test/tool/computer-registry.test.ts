import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import { ModelID, ProviderID } from "../../src/provider/schema"

const model = { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.6-sol") }

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("computer tool registry gating", () => {
  test("build omits computer tools when the experimental flag is on", async () => {
    vi.stubEnv("AX_CODE_EXPERIMENTAL_COMPUTER_AGENT", "1")
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = { name: "build", options: {}, permission: [], mode: "primary" } as unknown as Agent.Info
        const ids = (await ToolRegistry.tools(model, build)).map((tool) => tool.id)
        expect(ids).not.toContain("computer_snapshot")
        expect(ids).not.toContain("computer_action")
      },
    })
  })

  test("work agent with computer option receives computer tools when flagged", async () => {
    vi.stubEnv("AX_CODE_EXPERIMENTAL_COMPUTER_AGENT", "1")
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const work = {
          name: "work",
          options: { computer: true },
          permission: [],
          mode: "primary",
        } as unknown as Agent.Info
        const ids = (await ToolRegistry.tools(model, work)).map((tool) => tool.id)
        expect(ids).toContain("computer_snapshot")
        expect(ids).toContain("computer_action")
      },
    })
  })
})
