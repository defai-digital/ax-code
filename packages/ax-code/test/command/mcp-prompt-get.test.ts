import { afterEach, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

async function withTestHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.AX_CODE_TEST_HOME
  process.env.AX_CODE_TEST_HOME = home
  try {
    return await fn()
  } finally {
    process.env.AX_CODE_TEST_HOME = original
  }
}

test("Command.get returns the same MCP commit prompt Command.list would", async () => {
  await using tmp = await tmpdir({ git: true })
  const globalDir = path.join(tmp.path, "global-config")
  const server = path.join(import.meta.dirname, "mcp-commit-prompt-server.mjs")
  await fs.mkdir(globalDir, { recursive: true })
  await fs.writeFile(
    path.join(globalDir, "ax-code.json"),
    JSON.stringify({
      $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
      mcp: {
        override: {
          type: "local",
          command: [process.execPath, server],
          timeout: 8_000,
        },
      },
    }),
  )

  const previousConfig = Global.Path.config
  Global.Path.config = globalDir
  Config.global.reset()
  try {
    await withTestHome(path.join(tmp.path, "home"), async () => {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const listed = await Command.list()
          const fromList = listed.find((command) => command.name === "commit")
          expect(fromList).toMatchObject({
            name: "commit",
            source: "mcp",
            mcpPrompt: { client: "override", name: "commit" },
          })

          const fromGet = await Command.get("commit")
          expect(fromGet).toBeDefined()
          expect(fromGet!.source).toBe("mcp")
          expect(fromGet!.name).toBe("commit")
          expect(fromGet!.mcpPrompt).toEqual(fromList!.mcpPrompt)
        },
      })
    })
  } finally {
    await Instance.disposeAll()
    Global.Path.config = previousConfig
    Config.global.reset()
  }
})
