import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { Config } from "../../src/config/config"
import { ModelID, ProviderID } from "../../src/provider/schema"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.registry", () => {
  test("includes the built-in list tool", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("list")
      },
    })
  })

  test("invalidates cached tool definitions when config-gated tools change", async () => {
    await using tmp = await tmpdir()
    let batchTool = false
    const configSpy = vi.spyOn(Config, "get").mockImplementation(
      async () =>
        ({
          experimental: { batch_tool: batchTool },
        }) as Awaited<ReturnType<typeof Config.get>>,
    )

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

          const withoutBatch = await ToolRegistry.tools(model)
          expect(withoutBatch.map((tool) => tool.id)).not.toContain("batch")

          batchTool = true
          const withBatch = await ToolRegistry.tools(model)
          expect(withBatch.map((tool) => tool.id)).toContain("batch")
        },
      })
    } finally {
      configSpy.mockRestore()
    }
  })

  test("loads tools from .ax-code/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".ax-code")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolDir = path.join(opencodeDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await fs.writeFile(
          path.join(toolDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  }, 60000)

  test("loads tools from .ax-code/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".ax-code")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await fs.writeFile(
          path.join(toolsDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  }, 60000)

  test("loads tools with external dependencies without crashing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".ax-code")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await fs.writeFile(
          path.join(opencodeDir, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@ax-code/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        )

        await fs.writeFile(
          path.join(toolsDir, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("cowsay")
      },
    })
  }, 60000)
})
