import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { withOwnedInstance, withReadonlyInstance, withTransientInstance } from "../../src/project/with-instance"
import { bootstrap, bootstrapOwned, bootstrapReadonly } from "../../src/cli/bootstrap"
import { tmpdir } from "../fixture/fixture"

const boot = vi.hoisted(() => ({
  loaded: vi.fn(),
  owned: vi.fn(async () => {}),
  transient: vi.fn(async () => {}),
  readonly: vi.fn(async () => {}),
}))

vi.mock("../../src/project/bootstrap", () => {
  boot.loaded()
  return {
    InstanceBootstrap: boot.owned,
    InstanceBootstrapTransient: boot.transient,
    InstanceBootstrapReadonly: boot.readonly,
  }
})

afterEach(async () => {
  await Instance.disposeAll()
  vi.clearAllMocks()
})

test("project lifecycle helpers stay lazy and preserve CLI entry points", () => {
  expect(boot.loaded).not.toHaveBeenCalled()
  expect(bootstrap).toBe(withTransientInstance)
  expect(bootstrapOwned).toBe(withOwnedInstance)
  expect(bootstrapReadonly).toBe(withReadonlyInstance)
})

test.each([
  { run: withTransientInstance, mode: "transient" as const },
  { run: withOwnedInstance, mode: "owned" as const },
  { run: withReadonlyInstance, mode: "readonly" as const },
])("$mode lifecycle selects its initializer and disposes callback resources", async ({ run, mode }) => {
  await using tmp = await tmpdir()
  const disposed = vi.fn(async () => {})
  const state = Instance.state(() => ({ ready: true }), disposed)
  expect(
    await run(tmp.path, async () => {
      expect(Instance.directory).toBe(tmp.path)
      expect(state().ready).toBe(true)
      return "callback result"
    }),
  ).toBe("callback result")
  expect(boot[mode]).toHaveBeenCalledTimes(1)
  expect(disposed).toHaveBeenCalledTimes(1)
})

test("callback failure still disposes resources and propagates the original error", async () => {
  await using tmp = await tmpdir()
  const failure = new Error("callback failed")
  const disposed = vi.fn(async () => {})
  const state = Instance.state(() => ({ ready: true }), disposed)
  await expect(
    withTransientInstance(tmp.path, async () => {
      state()
      throw failure
    }),
  ).rejects.toBe(failure)
  expect(disposed).toHaveBeenCalledTimes(1)
})
