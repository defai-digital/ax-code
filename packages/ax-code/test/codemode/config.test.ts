import { afterEach, expect, test, vi } from "vitest"
import path from "node:path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { LIMITS } from "../../src/codemode/limits"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})
test("config validates opt-in and only lower hard ceilings", () => {
  expect(Config.Info.parse({}).code_mode).toBeUndefined()
  expect(Config.Info.parse({ code_mode: { enabled: true, max_steps: 50 } }).code_mode?.max_steps).toBe(50)
  for (const [name, ceiling] of Object.entries(LIMITS)) {
    expect(Config.Info.safeParse({ code_mode: { [name]: ceiling + 1 } }).success).toBe(false)
    expect(Config.Info.safeParse({ code_mode: { [name]: 0 } }).success).toBe(false)
  }
})
test("untrusted project cannot enable or replace code mode limits", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "0")
  await using tmp = await tmpdir({ config: { code_mode: { enabled: true, max_steps: 100 } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await Config.get()).code_mode).toBeUndefined()
    },
  })
})
test("trusted project may explicitly enable code mode", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  await using tmp = await tmpdir({ config: { code_mode: { enabled: true, max_steps: 100 } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await Config.get()).code_mode).toEqual({ enabled: true, max_steps: 100 })
    },
  })
})
test("managed false cannot be undone by another managed file", async () => {
  await using managed = await tmpdir()
  await using tmp = await tmpdir({ config: { code_mode: { enabled: true } } })
  const old = Config.managedConfigDir()
  Config.__setTestManagedConfigDir(managed.path)
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  try {
    await Filesystem.write(path.join(managed.path, "ax-code.json"), JSON.stringify({ code_mode: { enabled: false } }))
    await Filesystem.write(path.join(managed.path, "ax-code.jsonc"), JSON.stringify({ code_mode: { enabled: true } }))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect((await Config.get()).code_mode?.enabled).toBe(false)
      },
    })
  } finally {
    Config.__setTestManagedConfigDir(old)
  }
})
