import { describe, expect, test } from "bun:test"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { tmpdir } from "../fixture/fixture"

describe("session.system", () => {
  test("extractFilePaths extracts paths from tool call inputs", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const messages = [
          {
            info: { id: "m1", sessionID: "s1", role: "assistant" as const },
            parts: [
              {
                type: "tool" as const,
                callID: "c1",
                tool: "read",
                state: {
                  status: "completed" as const,
                  input: { filePath: path.join(tmp.path, "src/index.ts") },
                  output: "file content",
                  title: "Read file",
                  metadata: {},
                  time: { start: 1, end: 2 },
                },
              },
              {
                type: "tool" as const,
                callID: "c2",
                tool: "edit",
                state: {
                  status: "completed" as const,
                  input: { filePath: path.join(tmp.path, "src/app.tsx") },
                  output: "edited",
                  title: "Edit file",
                  metadata: {},
                  time: { start: 1, end: 2 },
                },
              },
              {
                type: "tool" as const,
                callID: "c3",
                tool: "bash",
                state: {
                  status: "completed" as const,
                  input: { command: "ls" },
                  output: "files",
                  title: "Run bash",
                  metadata: {},
                  time: { start: 1, end: 2 },
                },
              },
            ],
          },
        ] as any

        const result = SystemPrompt.extractFilePaths(messages)
        expect(result).toContain("src/index.ts")
        expect(result).toContain("src/app.tsx")
        expect(result.length).toBe(2)
      },
    })
  })

  test("skills output includes recommendations when messages match skill paths", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".ax-code", "skill", "ts-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: ts-skill
description: TypeScript skill.
paths:
  - "**/*.ts"
---

# TS Skill
`,
        )
      },
    })

    const home = process.env.AX_CODE_TEST_HOME
    process.env.AX_CODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const messages = [
            {
              info: { id: "m1", sessionID: "s1", role: "assistant" as const },
              parts: [
                {
                  type: "tool" as const,
                  callID: "c1",
                  tool: "read",
                  state: {
                    status: "completed" as const,
                    input: { filePath: path.join(tmp.path, "src/index.ts") },
                    output: "content",
                    title: "Read",
                    metadata: {},
                    time: { start: 1, end: 2 },
                  },
                },
              ],
            },
          ] as any

          const result = await SystemPrompt.skills(build!, messages)
          expect(result).toContain(`auto_activated="true"`)
          expect(result).toContain("ts-skill")
          expect(result).toContain("recommended for loading")
        },
      })
    } finally {
      process.env.AX_CODE_TEST_HOME = home
    }
  })

  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".ax-code", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.AX_CODE_TEST_HOME
    process.env.AX_CODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await Agent.get("build")
          const first = await SystemPrompt.skills(build!)
          const second = await SystemPrompt.skills(build!)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.AX_CODE_TEST_HOME = home
    }
  })
})
