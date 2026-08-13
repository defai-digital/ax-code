import { afterEach, describe, expect, test, vi } from "vitest"
import { existsSync } from "node:fs"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Flag } from "../../src/flag/flag"

const model = { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.6-sol") }

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("AX Work computer tools relocated", () => {
  test("computer source and flag are gone", () => {
    const root = path.join(import.meta.dirname, "../..")
    expect(existsSync(path.join(root, "src/visual/computer"))).toBe(false)
    expect(existsSync(path.join(root, "src/tool/computer"))).toBe(false)
    expect("AX_CODE_EXPERIMENTAL_COMPUTER_AGENT" in Flag).toBe(false)
  })

  test("registry never exposes computer tool IDs", async () => {
    vi.stubEnv("AX_CODE_EXPERIMENTAL_COMPUTER_AGENT", "1")
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).not.toContain("computer_snapshot")
        expect(ids).not.toContain("computer_action")

        const work = {
          name: "work",
          options: { computer: true },
          permission: [],
          mode: "primary",
        } as unknown as Agent.Info
        const workIds = (await ToolRegistry.tools(model, work)).map((tool) => tool.id)
        expect(workIds).not.toContain("computer_snapshot")
        expect(workIds).not.toContain("computer_action")
      },
    })
  })
})
