import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import { parse as parseJsonc } from "jsonc-parser"

const { Config } = await import("../../src/config/config")
const { Instance } = await import("../../src/project/instance")
const { Global } = await import("../../src/global")
const { tmpdir } = await import("../fixture/fixture")

/** Global config is process-wide, so point it at a tmpdir for the test's life. */
async function withIsolatedGlobalConfig(run: () => Promise<void>) {
  await using globalTmp = await tmpdir()
  const previous = Global.Path.config
  ;(Global.Path as { config: string }).config = globalTmp.path
  Config.global.reset()
  try {
    await run()
  } finally {
    ;(Global.Path as { config: string }).config = previous
    Config.global.reset()
  }
}

afterEach(async () => {
  await Instance.disposeAll()
})

async function projectConfigFile(dir: string): Promise<Record<string, unknown> | undefined> {
  const file = path.join(dir, "ax-code.json")
  if (!existsSync(file)) return undefined
  return parseJsonc(await fs.readFile(file, "utf8")) as Record<string, unknown>
}

test("a config round-trip does not persist the injected webmcp default into the project config", async () => {
  await withIsolatedGlobalConfig(async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // The GET /config payload a client receives (server/routes/config.ts).
        const payload = await Config.get()
        expect(payload.mcp?.webmcp).toBeDefined()
        // The PATCH /config write path (server/routes/config.ts:182-183).
        await Config.update(payload)
      },
    })
    const written = await projectConfigFile(tmp.path)
    expect(written?.mcp).toBeUndefined()
  })
})
