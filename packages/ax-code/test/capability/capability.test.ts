import { afterEach, expect, test } from "vitest"
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
      await Bun.write(path.join(dir, "AGENTS.md"), "# Project Instructions\n")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: release-check
description: Review release readiness.
paths:
  - "releases/**/*.md"
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
        const capabilities = await Capability.list({ filePaths: ["releases/v1.md"] })
        const keys = capabilities.map((capability) => `${capability.kind}:${capability.name}`)
        expect(keys).toEqual([...keys].sort())

        const instruction = capabilities.find((item) => item.kind === "instruction" && item.name === "AGENTS.md")
        expect(instruction).toMatchObject({
          kind: "instruction",
          source: "instruction",
          sourceTool: "ax-code",
          scope: "project",
        })
        expect(instruction?.metadata).toMatchObject({
          permissionImpact: "instructions_only",
          recommended: true,
        })

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
          permissionImpact: "default_agent_permissions",
        })

        const skill = capabilities.find((item) => item.kind === "skill" && item.name === "release-check")
        expect(skill).toMatchObject({
          kind: "skill",
          name: "release-check",
          sourceTool: "opencode",
          scope: "project",
        })
        expect(skill?.warnings?.map((warning) => warning.code)).toContain("duplicate_command_skill_name")
        expect(skill?.metadata).toMatchObject({
          recommended: true,
          permissionImpact: "instructions_only",
        })

        const agent = capabilities.find((item) => item.kind === "agent" && item.name === "build")
        expect(agent).toMatchObject({
          kind: "agent",
          name: "build",
          source: "builtin",
          sourceTool: "builtin",
          scope: "builtin",
        })
        expect(agent?.metadata?.permissionImpact).toBeDefined()

        const workflow = capabilities.find((item) => item.kind === "workflow" && item.name === "builtin:noop-dry-run")
        expect(workflow).toMatchObject({
          kind: "workflow",
          name: "builtin:noop-dry-run",
          source: "builtin",
          sourceTool: "ax-code",
          scope: "builtin",
        })
        expect(workflow?.metadata).toMatchObject({
          trust: "trusted",
          requiresWorkflowRuntime: true,
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

test("keeps dotted project instruction paths relative in capability names", async () => {
  await using tmp = await tmpdir({
    config: {
      instructions: ["..instructions/AGENTS.md"],
    },
    init: async (dir) => {
      const instructionDir = path.join(dir, "..instructions")
      await fs.mkdir(instructionDir, { recursive: true })
      await Bun.write(path.join(instructionDir, "AGENTS.md"), "# Dotted Instructions\n")
    },
  })

  await withTestHome(path.join(tmp.path, "home"), async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const capabilities = await Capability.list()
        expect(capabilities.find((item) => item.kind === "instruction" && item.name === "..instructions/AGENTS.md"))
          .toBeDefined()
      },
    })
  })
})
