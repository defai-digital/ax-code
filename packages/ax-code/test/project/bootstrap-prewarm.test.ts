import { afterEach, expect, test, vi } from "vitest"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Instance } from "../../src/project/instance"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

test.each([
  ["normal", undefined, false],
  ["normal", "1", true],
  ["low", "1", false],
])("bootstrap admits speculative LSP with profile=%s and opt-in=%s: %s", async (profile, optIn, expected) => {
  vi.stubEnv("AX_CODE_MEMORY_PROFILE", profile)
  vi.stubEnv("AX_CODE_LSP_PREWARM", optIn)
  vi.spyOn(ScheduledTask, "initScheduler").mockImplementation(() => {})
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Observe admission without starting providers, watchers or other services.
      const runtime = Instance.runtime()
      vi.spyOn(Instance, "runtime").mockReturnValue(runtime)
      const track = vi.spyOn(runtime, "track").mockResolvedValue(undefined)
      await InstanceBootstrap()
      const services = track.mock.calls.map(([input]) => input.service)
      expect(services).toContain("LSP.init")
      expect(services.includes("LSP.prewarmWorkspace")).toBe(expected)
    },
  })
})
