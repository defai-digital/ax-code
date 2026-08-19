import { expect, test } from "vitest"
import path from "node:path"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { tmpdir } from "../fixture/fixture"

async function withIsolatedGlobalConfig(run: (projectDirectory: string) => Promise<void>) {
  await using globalTmp = await tmpdir()
  await using projectTmp = await tmpdir({ git: true })
  const previousConfigDirectory = Global.Path.config
  ;(Global.Path as { config: string }).config = globalTmp.path
  Config.global.reset()

  try {
    await Filesystem.write(
      path.join(globalTmp.path, "ax-code.jsonc"),
      JSON.stringify({
        $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
      }),
    )
    await run(projectTmp.path)
  } finally {
    await Instance.disposeAll()
    ;(Global.Path as { config: string }).config = previousConfigDirectory
    Config.global.reset()
  }
}

test("provider enablement updates preserve active instance state", async () => {
  await withIsolatedGlobalConfig(async (projectDirectory) => {
    await Instance.provide({
      directory: projectDirectory,
      fn: async () => {
        let promptStateDisposed = false
        const promptState = Instance.state(
          () => ({ active: true }),
          async () => {
            promptStateDisposed = true
          },
        )

        const active = promptState()
        expect((await Config.get()).disabled_providers).toBeUndefined()

        await Config.updateGlobal({ disabled_providers: ["ax-engine"] })

        expect(promptStateDisposed).toBe(false)
        expect(promptState()).toBe(active)
        expect((await Config.get()).disabled_providers).toEqual(["ax-engine"])
        expect(Instance.list()).toContain(projectDirectory)
      },
    })
  })
})

test("provider enablement refreshes config in every live project", async () => {
  await withIsolatedGlobalConfig(async (projectDirectory) => {
    await using peerProject = await tmpdir({ git: true })
    let peerStateDisposed = false

    await Instance.provide({
      directory: peerProject.path,
      fn: async () => {
        const peerState = Instance.state(
          () => ({ active: true }),
          async () => {
            peerStateDisposed = true
          },
        )
        peerState()
        expect((await Config.get()).disabled_providers).toBeUndefined()
      },
    })

    await Instance.provide({
      directory: projectDirectory,
      fn: () => Config.updateGlobal({ disabled_providers: ["ax-engine"] }),
    })

    await Instance.provide({
      directory: peerProject.path,
      fn: async () => {
        expect(peerStateDisposed).toBe(false)
        expect((await Config.get()).disabled_providers).toEqual(["ax-engine"])
      },
    })
  })
})

test("general global config updates retain full instance reload semantics", async () => {
  await withIsolatedGlobalConfig(async (projectDirectory) => {
    await Instance.provide({
      directory: projectDirectory,
      fn: async () => {
        let stateDisposed = false
        const state = Instance.state(
          () => ({ active: true }),
          async () => {
            stateDisposed = true
          },
        )
        state()

        await Config.updateGlobal({ autoupdate: false })

        expect(stateDisposed).toBe(true)
        expect(Instance.list()).not.toContain(projectDirectory)
      },
    })
  })
})
