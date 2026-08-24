import { afterEach, describe, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
import { ListTool } from "../../src/tool/ls"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test-ls-session"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.list", () => {
  test("lists files in a directory", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        const result = await list.execute({}, ctx)

        expect(result.output).toContain(`${tmp.path}/`)
      },
    })
  })

  test("lists empty directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "empty"))
        await fs.mkdir(path.join(dir, "src"))
        await fs.writeFile(path.join(dir, "src", "app.ts"), "export const app = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        const result = await list.execute({}, ctx)

        expect(result.output).toContain("  empty/\n")
        expect(result.output).toContain("  src/\n")
        expect(result.output).toContain("    app.ts\n")
      },
    })
  })

  test("does not list ignored directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true })
        await fs.mkdir(path.join(dir, "src"))
        await fs.writeFile(path.join(dir, "node_modules", "pkg", "index.js"), "module.exports = {}\n")
        await fs.writeFile(path.join(dir, "src", "app.ts"), "export const app = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        const result = await list.execute({}, ctx)

        expect(result.output).toContain("  src/\n")
        expect(result.output).not.toContain("node_modules")
      },
    })
  })

  test("skips noise directories nested in monorepo subdirectories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "crates", "core", "src"), { recursive: true })
        await fs.mkdir(path.join(dir, "crates", "core", "target", "debug"), { recursive: true })
        await fs.mkdir(path.join(dir, "packages", "app", "node_modules", "dep"), { recursive: true })
        await fs.mkdir(path.join(dir, "packages", "app", "dist"), { recursive: true })
        await fs.writeFile(path.join(dir, "crates", "core", "src", "lib.rs"), "pub fn f() {}\n")
        await fs.writeFile(path.join(dir, "crates", "core", "target", "debug", "libcore.rlib"), "binary\n")
        await fs.writeFile(path.join(dir, "packages", "app", "node_modules", "dep", "index.js"), "export {}\n")
        await fs.writeFile(path.join(dir, "packages", "app", "dist", "bundle.js"), "bundled\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        const result = await list.execute({}, ctx)

        // Real source tree must be visible…
        expect(result.output).toContain("src/")
        expect(result.output).toContain("lib.rs\n")
        // …while nested noise directories are skipped at any depth, so the
        // DFS budget is not consumed by target/ and node_modules/ trees.
        expect(result.output).not.toContain("target")
        expect(result.output).not.toContain("node_modules")
        expect(result.output).not.toContain("dist")
        expect(result.metadata.truncated).toBe(false)
      },
    })
  })
})
