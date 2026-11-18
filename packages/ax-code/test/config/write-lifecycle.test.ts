import path from "node:path"
import { expect, test } from "vitest"
import { GlobalBus, type GlobalBusEvent } from "../../src/bus/global"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { FileLock } from "../../src/util/filelock"
import { Filesystem } from "../../src/util/filesystem"
import { Lock } from "../../src/util/lock"
import { tmpdir } from "../fixture/fixture"

const LOCK_TEST_TIMEOUT_MS = 100

async function withIsolatedConfig(run: (project: string, config: string) => Promise<void>): Promise<void> {
  await using global = await tmpdir()
  await using project = await tmpdir({ git: true })
  const previous = Global.Path.config
  ;(Global.Path as { config: string }).config = global.path
  Config.global.reset()
  try {
    await run(project.path, path.join(global.path, "ax-code.jsonc"))
  } finally {
    await Instance.disposeAll()
    ;(Global.Path as { config: string }).config = previous
    Config.global.reset()
  }
}

test.each(["project", "global"] as const)("%s updates release file locks before cleanup starts", async (mode) => {
  await withIsolatedConfig(async (project, globalFile) => {
    const filepath = mode === "global" ? globalFile : path.join(project, "ax-code.jsonc")
    await Filesystem.write(filepath, "{}")
    let processLockAvailable = false
    let fileLockAvailable = false
    const state = Instance.state(
      () => ({}),
      async () => {
        try {
          using _process = await Lock.write(filepath, { timeoutMs: LOCK_TEST_TIMEOUT_MS })
          processLockAvailable = true
        } catch (error) {
          if (!(error instanceof Error)) throw error
        }
        try {
          using _crossProcess = await FileLock.acquire(filepath, { timeoutMs: LOCK_TEST_TIMEOUT_MS })
          fileLockAvailable = true
        } catch (error) {
          if (!(error instanceof FileLock.TimeoutError)) throw error
        }
      },
    )
    await Instance.provide({
      directory: project,
      fn: async () => {
        state()
        if (mode === "project") await Config.update({ model: "updated/model" })
        else await Config.updateGlobal({ autoupdate: false })
      },
    })
    expect(processLockAvailable).toBe(true)
    expect(fileLockAvailable).toBe(true)
  })
})

test("global cleanup can persist a toggle before disposal reports ready", async () => {
  await withIsolatedConfig(async (project, file) => {
    let saved = false
    let savedAtReady: boolean | undefined
    const state = Instance.state(
      () => ({}),
      async () => {
        await Config.persistWebMcpToggle("fixture-bridge", { type: "local", command: ["node", "fixture.js"] }, true)
        saved = true
      },
    )
    const unsubscribe = Instance.onLifecycle((event) => {
      if (event.kind === "dispose.ready" && event.directory === project) savedAtReady = saved
    })
    try {
      await Instance.provide({
        directory: project,
        fn: async () => {
          state()
          await Config.updateGlobal({ autoupdate: false })
        },
      })
      expect(savedAtReady).toBe(true)
      expect((await Filesystem.readJson(file)).mcp["fixture-bridge"].enabled).toBe(true)
    } finally {
      unsubscribe()
    }
  })
})

test.each(["patch", "replace-provider", "remove-provider"] as const)(
  "global %s restores the raw config when a refresh listener fails",
  async (operation) => {
    await withIsolatedConfig(async (_project, filepath) => {
      const before = '{\n  // Keep the original layout\n  "provider": { "fixture": { "name": "Original" } }\n}\n'
      await Filesystem.write(filepath, before)
      const failure = new Error("Refresh listener failed")
      const listener = (event: GlobalBusEvent) => {
        if (event.directory !== "global") return
        GlobalBus.off("event", listener)
        throw failure
      }
      GlobalBus.on("event", listener)
      try {
        const update =
          operation === "patch"
            ? Config.updateGlobal({ autoupdate: false })
            : operation === "replace-provider"
              ? Config.setGlobalProvider("fixture", { name: "Replacement" })
              : Config.removeGlobalProvider("fixture")
        await expect(update).rejects.toBe(failure)
        expect(await Filesystem.readText(filepath)).toBe(before)
        expect((await Config.getGlobal()).provider?.fixture?.name).toBe("Original")
      } finally {
        GlobalBus.off("event", listener)
      }
    })
  },
)

test("a failed global refresh preserves a newer write made during cleanup", async () => {
  await withIsolatedConfig(async (project, filepath) => {
    await Filesystem.write(filepath, '{ "autoupdate": true }\n')
    const state = Instance.state(
      () => ({}),
      async () => {
        await Config.persistWebMcpToggle("peer-bridge", { type: "local", command: ["node", "fixture.js"] }, true)
      },
    )
    const failure = new Error("Refresh listener failed")
    const listener = (event: GlobalBusEvent) => {
      if (event.directory === "global") throw failure
    }
    GlobalBus.on("event", listener)
    try {
      await Instance.provide({
        directory: project,
        fn: async () => {
          state()
          await expect(Config.updateGlobal({ autoupdate: false })).rejects.toBe(failure)
        },
      })
      expect(await Config.getGlobal()).toMatchObject({
        autoupdate: false,
        mcp: { "peer-bridge": { enabled: true } },
      })
    } finally {
      GlobalBus.off("event", listener)
    }
  })
})
