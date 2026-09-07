import { afterEach, expect, test, vi } from "vitest"
import z from "zod"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ToolRegistry } from "../../src/tool/registry"
import { SystemPrompt } from "../../src/session/system"
import type { Provider } from "../../src/provider/provider"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test("coding is opt-in, retains lifecycle and verification tools, and invalidates the effective provider cache", async () => {
  await using tmp = await tmpdir()
  let profile: "coding" | "full" | undefined
  vi.spyOn(Config, "get").mockImplementation(async () => ({
    provider: { test: { options: { toolProfile: profile } } },
  }))
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }
      const ids = async () => (await ToolRegistry.tools(model)).map((tool) => tool.id)
      const defaults = await ids()
      expect(defaults).toContain("ops_plan")
      profile = "coding"
      const coding = await ids()
      expect(coding).toEqual(
        expect.arrayContaining([
          "read",
          "write",
          "edit",
          "bash",
          "bash_output",
          "bash_input",
          "kill_shell",
          "monitor",
          "task",
          "task_parallel",
          "waitfor",
          "list_background_tasks",
          "message_background_task",
          "get_goal",
          "create_goal",
          "update_goal",
          "submit_goal_plan",
          "skill",
          "memory_save",
          "notebook_edit",
          "register_finding",
          "verify_project",
          "review_complete",
        ]),
      )
      for (const id of [
        "ops_plan",
        "council",
        "arena",
        "image_gen",
        "schedule_task",
        "debug_analyze",
        "code_intelligence",
      ])
        expect(coding).not.toContain(id)
      expect(coding.length).toBeLessThan(defaults.length)
      const unrelated = await ToolRegistry.tools({ ...model, providerID: ProviderID.make("other") })
      expect(unrelated.map((tool) => tool.id)).toContain("ops_plan")
      profile = "full"
      expect(await ids()).toEqual(defaults)
    },
  })
})

test("coding preserves registered tool ownership and gated feature admission", async () => {
  await using tmp = await tmpdir()
  vi.spyOn(Config, "get").mockResolvedValue({
    provider: { test: { options: { toolProfile: "coding" } } },
    experimental: { batch_tool: false },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dispose = await ToolRegistry.register({
        id: "custom_coding_tool",
        init: async () => ({
          description: "Custom",
          parameters: z.object({}),
          execute: async () => ({ title: "Custom", output: "Done", metadata: {} }),
        }),
      })
      const ids = async () =>
        (await ToolRegistry.tools({ providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") })).map(
          (tool) => tool.id,
        )
      expect(await ids()).toContain("custom_coding_tool")
      expect(await ids()).not.toContain("batch")
      expect(await ids()).not.toContain("computer_action")
      dispose()
      expect(await ids()).not.toContain("custom_coding_tool")
    },
  })
})

test("AX Engine retains core by default and coding prompts omit unavailable advanced workflows", async () => {
  await using tmp = await tmpdir()
  vi.spyOn(Config, "get").mockResolvedValue({ provider: { test: { options: { toolProfile: "coding" } } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const core = await ToolRegistry.tools({
        providerID: ProviderID.make("ax-engine"),
        modelID: ModelID.make("local"),
      })
      expect(core.map((tool) => tool.id)).toContain("submit_goal_plan")
      expect(core.map((tool) => tool.id)).not.toContain("task")
      const environment = (
        await SystemPrompt.environment({
          id: "test",
          providerID: "test",
          api: { id: "test", npm: "@ai-sdk/openai-compatible" },
        } as Provider.Model)
      ).join("\n")
      expect(environment).not.toContain("<debug_engine_workflow>")
      expect(environment).not.toContain("call council/arena within")
      expect(environment).toContain("verify_project")
    },
  })
})
