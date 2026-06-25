import { afterEach, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Command } from "../../src/command"
import { commandTemplateText } from "../../src/session/prompt-command-template"
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

test("discovers project .agents file-backed commands", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const commandDir = path.join(dir, ".agents", "commands")
      await fs.mkdir(commandDir, { recursive: true })
      await fs.writeFile(
        path.join(commandDir, "review-branch.md"),
        `---
description: Review a named branch
agent: debug
model: test/model
subtask: true
---
Review branch $ARGUMENTS.
`,
      )
    },
  })

  await withTestHome(path.join(tmp.path, "home"), async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const command = await Command.get("review-branch")
        expect(command).toBeDefined()
        expect(command!.source).toBe("file")
        expect(command!.sourceTool).toBe("agents")
        expect(command!.scope).toBe("project")
        expect(command!.agent).toBe("debug")
        expect(command!.model).toBe("test/model")
        expect(command!.subtask).toBe(true)
        expect(command!.allowShell).toBe(false)
        expect(command!.hints).toEqual(["$ARGUMENTS"])
        expect(command!.location).toContain(path.join(".agents", "commands", "review-branch.md"))
      },
    })
  })
})

test("surfaces invalid file-backed command frontmatter", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const commandDir = path.join(dir, ".agents", "commands")
      await fs.mkdir(commandDir, { recursive: true })
      await fs.writeFile(
        path.join(commandDir, "bad.md"),
        `---
<<: *unsupported
---
This command should fail discovery.
`,
      )
    },
  })

  await withTestHome(path.join(tmp.path, "home"), async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Command.get("bad")).rejects.toMatchObject({
          name: "ConfigFrontmatterError",
          data: { path: path.join(tmp.path, ".agents", "commands", "bad.md") },
        })
      },
    })
  })
})

test.skipIf(process.platform === "win32")("surfaces unreadable file-backed command files", async () => {
  const commandPath = path.join(".agents", "commands", "blocked.md")
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const fullPath = path.join(dir, commandPath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, "Blocked command\n")
      await fs.chmod(fullPath, 0)
    },
    dispose: async (dir) => {
      await fs.chmod(path.join(dir, commandPath), 0o600).catch(() => undefined)
    },
  })

  await withTestHome(path.join(tmp.path, "home"), async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fullPath = path.join(tmp.path, commandPath)
        await expect(Command.get("blocked")).rejects.toMatchObject({
          name: "ConfigFrontmatterError",
          data: { path: fullPath },
        })
      },
    })
  })
})

test("exposes skill agent metadata on skill-backed commands", async () => {
  await using tmp = await tmpdir({ git: true })

  await withTestHome(path.join(tmp.path, "home"), async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const command = await Command.get("debug-n-fix")
        expect(command).toBeDefined()
        expect(command!.source).toBe("skill")
        expect(command!.agent).toBe("debug")
      },
    })
  })
})

test("discovers global .opencode commands and reports unsupported shell interpolation", async () => {
  await using tmp = await tmpdir({ git: true })
  const home = path.join(tmp.path, "home")
  const commandDir = path.join(home, ".opencode", "commands")
  await fs.mkdir(commandDir, { recursive: true })
  await fs.writeFile(
    path.join(commandDir, "snapshot.md"),
    `---
description: Snapshot status
---
Snapshot $ARGUMENTS
!` +
      "`echo should-not-run`" +
      `
`,
  )

  await withTestHome(home, async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const command = await Command.get("snapshot")
        expect(command).toBeDefined()
        expect(command!.source).toBe("file")
        expect(command!.sourceTool).toBe("opencode")
        expect(command!.scope).toBe("user")
        expect(command!.allowShell).toBe(false)
        expect(command!.warnings?.map((warning) => warning.code)).toContain("unsupported_shell_interpolation")

        const text = await commandTemplateText({
          template: await command!.template,
          arguments: "before commit",
          allowShell: command!.allowShell,
          run: async () => {
            throw new Error("shell interpolation should not run")
          },
        })
        expect(text).toContain("Snapshot before commit")
        expect(text).toContain("!`echo should-not-run`")
      },
    })
  })
})

test("keeps built-in commands protected from file-backed overrides", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const commandDir = path.join(dir, ".agents", "commands")
      await fs.mkdir(commandDir, { recursive: true })
      await fs.writeFile(
        path.join(commandDir, "review.md"),
        `---
description: Override review
---
This should not replace the built-in review command.
`,
      )
    },
  })

  await withTestHome(path.join(tmp.path, "home"), async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const command = await Command.get("review")
        expect(command).toBeDefined()
        expect(command!.sourceTool).toBe("builtin")
        expect(command!.scope).toBe("builtin")
        expect(command!.description).toContain("review changes")
      },
    })
  })
})

test("marks .ax-code commands loaded through config as file-backed and shell-disabled", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const commandDir = path.join(dir, ".ax-code", "commands")
      await fs.mkdir(commandDir, { recursive: true })
      await fs.writeFile(
        path.join(commandDir, "local.md"),
        `---
description: Local command
---
Local template
!` +
          "`echo should-not-run`" +
          `
`,
      )
    },
  })

  await withTestHome(path.join(tmp.path, "home"), async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const command = await Command.get("local")
        expect(command).toBeDefined()
        expect(command!.source).toBe("file")
        expect(command!.sourceTool).toBe("ax-code")
        expect(command!.scope).toBe("project")
        expect(command!.allowShell).toBe(false)
        expect(command!.warnings?.map((warning) => warning.code)).toContain("unsupported_shell_interpolation")
      },
    })
  })
})
