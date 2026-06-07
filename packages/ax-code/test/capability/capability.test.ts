import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Capability } from "../../src/capability"
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

test("lists commands, skills, agents, and workflow templates with stable metadata", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const commandDir = path.join(dir, ".agents", "commands")
      await fs.mkdir(commandDir, { recursive: true })
      await Bun.write(
        path.join(commandDir, "release-check.md"),
        `---
description: Check a release
---
Check release $ARGUMENTS.
`,
      )

      const skillDir = path.join(dir, ".opencode", "skills", "release-check")
      await fs.mkdir(skillDir, { recursive: true })
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: release-check
description: Review release readiness.
---

# Release Check
`,
      )
    },
  })

  await withTestHome(path.join(tmp.path, "home"), async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capabilities = await Capability.list()
        const keys = capabilities.map((capability) => `${capability.kind}:${capability.name}`)
        expect(keys).toEqual([...keys].sort())

        const command = capabilities.find((item) => item.kind === "command" && item.name === "release-check")
        expect(command).toMatchObject({
          kind: "command",
          name: "release-check",
          source: "file",
          sourceTool: "agents",
          scope: "project",
        })
        expect(command?.metadata).toMatchObject({
          hints: ["$ARGUMENTS"],
          allowShell: false,
        })

        const skill = capabilities.find((item) => item.kind === "skill" && item.name === "release-check")
        expect(skill).toMatchObject({
          kind: "skill",
          name: "release-check",
          sourceTool: "opencode",
          scope: "project",
        })
        expect(skill?.warnings?.map((warning) => warning.code)).toContain("duplicate_command_skill_name")

        const agent = capabilities.find((item) => item.kind === "agent" && item.name === "build")
        expect(agent).toMatchObject({
          kind: "agent",
          name: "build",
          source: "builtin",
          sourceTool: "builtin",
          scope: "builtin",
        })

        const workflow = capabilities.find((item) => item.kind === "workflow" && item.name === "builtin:noop-dry-run")
        expect(workflow).toMatchObject({
          kind: "workflow",
          name: "builtin:noop-dry-run",
          source: "builtin",
          sourceTool: "ax-code",
          scope: "builtin",
        })
      },
    })
  })
})

test("catalog warns when agent config still uses deprecated tools", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        legacy_worker: {
          description: "Legacy worker",
          tools: {
            bash: false,
          },
        },
      },
    },
  })

  await withTestHome(path.join(tmp.path, "home"), async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capabilities = await Capability.list()
        const agent = capabilities.find((item) => item.kind === "agent" && item.name === "legacy_worker")
        expect(agent?.warnings?.map((warning) => warning.code)).toContain("deprecated_agent_tools")
      },
    })
  })
})
