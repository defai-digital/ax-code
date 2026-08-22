import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { Config } from "../../src/config/config"
import { ModelID, ProviderID } from "../../src/provider/schema"
import z from "zod"

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

  test("keeps initialized tool caches isolated between live instances", async () => {
    const project = (tool: string) =>
      tmpdir({
        init: async (dir) => {
          const toolDir = path.join(dir, ".ax-code", "tool")
          await fs.mkdir(toolDir, { recursive: true })
          await fs.writeFile(
            path.join(toolDir, `${tool}.ts`),
            [
              "export default {",
              `  description: '${tool} tool',`,
              "  args: {},",
              `  execute: async () => '${tool}',`,
              "}",
              "",
            ].join("\n"),
          )
        },
      })
    await using alpha = await project("alpha")
    await using beta = await project("beta")
    const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("shared-model") }

    const alphaIDs = await Instance.provide({
      directory: alpha.path,
      fn: async () => (await ToolRegistry.tools(model)).map((tool) => tool.id),
    })
    const betaIDs = await Instance.provide({
      directory: beta.path,
      fn: async () => (await ToolRegistry.tools(model)).map((tool) => tool.id),
    })
    const alphaAgain = await Instance.provide({
      directory: alpha.path,
      fn: async () => (await ToolRegistry.tools(model)).map((tool) => tool.id),
    })

    expect(alphaIDs).toContain("alpha")
    expect(alphaIDs).not.toContain("beta")
    expect(betaIDs).toContain("beta")
    expect(betaIDs).not.toContain("alpha")
    expect(alphaAgain).toContain("alpha")
    expect(alphaAgain).not.toContain("beta")
  }, 60_000)

  test("returns exact idempotent disposers for stacked registrations", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const toolDir = path.join(dir, ".ax-code", "tool")
        await fs.mkdir(toolDir, { recursive: true })
        await fs.writeFile(
          path.join(toolDir, "layered.ts"),
          ["export default {", "  description: 'base',", "  args: {},", "  execute: async () => 'base',", "}", ""].join(
            "\n",
          ),
        )
      },
    })
    const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("layered-model") }
    const registration = (description: string) => ({
      id: "layered",
      init: async () => ({
        description,
        parameters: z.object({}),
        execute: async () => ({ title: "", output: description, metadata: {} }),
      }),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const description = async () =>
          (await ToolRegistry.tools(model)).find((tool) => tool.id === "layered")?.description
        expect(await description()).toBe("base")

        const disposeFirst = await ToolRegistry.register(registration("first"))
        const disposeSecond = await ToolRegistry.register(registration("second"))
        expect(await description()).toBe("second")

        disposeSecond()
        disposeSecond()
        expect(await description()).toBe("first")

        const disposeThird = await ToolRegistry.register(registration("third"))
        disposeFirst()
        expect(await description()).toBe("third")

        disposeThird()
        expect(await description()).toBe("base")
      },
    })
  }, 60_000)

  test("registration disposers retain their owner when called from another instance", async () => {
    await using owner = await tmpdir()
    await using caller = await tmpdir()
    const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("cross-instance-model") }
    let dispose!: () => void

    await Instance.provide({
      directory: owner.path,
      fn: async () => {
        dispose = await ToolRegistry.register({
          id: "owner-only",
          init: async () => ({
            description: "owner registration",
            parameters: z.object({}),
            execute: async () => ({ title: "", output: "owner", metadata: {} }),
          }),
        })
        expect((await ToolRegistry.tools(model)).some((tool) => tool.id === "owner-only")).toBe(true)
      },
    })

    await Instance.provide({ directory: caller.path, fn: async () => dispose() })

    await Instance.provide({
      directory: owner.path,
      fn: async () => {
        expect((await ToolRegistry.tools(model)).some((tool) => tool.id === "owner-only")).toBe(false)
      },
    })
  })

  test("a scoped registration replaces a built-in exactly once and restores it", async () => {
    await using tmp = await tmpdir()
    const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("override-model") }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const original = (await ToolRegistry.tools(model)).find((tool) => tool.id === "read")
        expect(original).toBeDefined()

        const dispose = await ToolRegistry.register({
          id: "read",
          init: async () => ({
            description: "scoped read",
            parameters: z.object({}),
            execute: async () => ({ title: "", output: "scoped", metadata: {} }),
          }),
        })
        const overridden = (await ToolRegistry.tools(model)).filter((tool) => tool.id === "read")
        expect(overridden).toHaveLength(1)
        expect(overridden[0]?.description).toBe("scoped read")

        dispose()
        const restored = (await ToolRegistry.tools(model)).filter((tool) => tool.id === "read")
        expect(restored).toHaveLength(1)
        expect(restored[0]?.description).toBe(original?.description)
      },
    })
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
