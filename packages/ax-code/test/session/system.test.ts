import { describe, expect, test } from "vitest"
import path from "path"
import { writeFile, mkdir } from "node:fs/promises"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { EventQuery } from "../../src/replay/query"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { SystemPrompt } from "../../src/session/system"
import { tmpdir } from "../fixture/fixture"
import PROMPT_KIMI from "../../src/session/prompt/kimi.txt"
import PROMPT_DEFAULT from "../../src/session/prompt/default.txt"
import PROMPT_CRAFT from "../../src/session/prompt/craft.txt"
import PROMPT_BEAST from "../../src/session/prompt/beast.txt"
import PROMPT_TRINITY from "../../src/session/prompt/trinity.txt"
import PROMPT_ANTHROPIC from "../../src/session/prompt/anthropic.txt"
import PROMPT_GEMINI from "../../src/session/prompt/gemini.txt"

describe("session.system", () => {
  test("routes Kimi / Moonshot models to the Kimi action-first prompt", () => {
    const kimi = SystemPrompt.provider({
      id: "alibaba-pai/Kimi-K2.7-Code",
      providerID: "alibaba-pai",
      api: { id: "Kimi-K2.7-Code", url: "http://127.0.0.1/v1" },
    } as any)
    expect(kimi).toEqual([PROMPT_KIMI, PROMPT_CRAFT])
    expect(kimi[0]).toContain("treat it as a task")
    expect(kimi[0]).not.toContain("fewer than 4 lines")

    const moonshot = SystemPrompt.provider({
      id: "moonshotai/kimi-k2.7-code",
      providerID: "moonshotai",
      api: { id: "kimi-k2.7-code", url: "https://api.moonshot.ai/v1" },
    } as any)
    expect(moonshot).toEqual([PROMPT_KIMI, PROMPT_CRAFT])

    const qwen = SystemPrompt.provider({
      id: "alibaba-coding-plan/qwen3.7-max",
      providerID: "alibaba-coding-plan",
      api: { id: "qwen3.7-max", url: "https://dashscope.aliyuncs.com" },
    } as any)
    expect(qwen).toEqual([PROMPT_DEFAULT, PROMPT_CRAFT])
    expect(PROMPT_CRAFT).toContain("Compute. Do not estimate")
    expect(PROMPT_CRAFT).toContain("Search, then open the page")
    expect(PROMPT_CRAFT).toContain("You are the orchestrator")
    expect(PROMPT_CRAFT).toContain("Do not ask permission to delegate")
    expect(PROMPT_DEFAULT).not.toContain("fewer than 4 lines")
    expect(PROMPT_DEFAULT).not.toContain("One word answers are best")
    expect(PROMPT_DEFAULT).toContain("Default to doing the work")
    expect(PROMPT_KIMI).toContain("doing the work without asking questions")
  })

  test("family prompts stay action-first and reject over-process", () => {
    const gpt = SystemPrompt.provider({
      id: "openai/gpt-5",
      providerID: "openai",
      api: { id: "gpt-5", url: "https://api.openai.com" },
    } as any)
    expect(gpt).toEqual([PROMPT_BEAST, PROMPT_CRAFT])
    expect(PROMPT_BEAST).toContain("Default to doing the work")
    expect(PROMPT_BEAST).toContain("Don't over-engineer")
    expect(PROMPT_BEAST).not.toContain("EXTENSIVE INTERNET RESEARCH")
    expect(PROMPT_BEAST).not.toContain("Always read 2000 lines")
    expect(PROMPT_BEAST).not.toContain("sequential thinking")
    expect(PROMPT_BEAST).not.toContain("memory.instruction.md")
    expect(PROMPT_BEAST).toContain("Never ask permission questions")

    const trinity = SystemPrompt.provider({
      id: "custom/trinity-large",
      providerID: "custom",
      api: { id: "trinity-large", url: "http://127.0.0.1/v1" },
    } as any)
    expect(trinity).toEqual([PROMPT_TRINITY, PROMPT_CRAFT])
    expect(PROMPT_TRINITY).toContain("Default to doing the work")
    expect(PROMPT_TRINITY).not.toContain("fewer than 4 lines")
    expect(PROMPT_TRINITY).not.toContain("One word answers are best")
    expect(PROMPT_TRINITY).not.toContain("one tool per message")
    expect(PROMPT_TRINITY).not.toContain("Use exactly one tool per assistant message")

    const claude = SystemPrompt.provider({
      id: "anthropic/claude-sonnet-4-6",
      providerID: "anthropic",
      api: { id: "claude-sonnet-4-6", url: "https://api.anthropic.com" },
    } as any)
    expect(claude).toEqual([PROMPT_ANTHROPIC, PROMPT_CRAFT])
    expect(PROMPT_ANTHROPIC).toContain("Default to doing the work")
    expect(PROMPT_ANTHROPIC).toContain("avoid over-engineering")
    expect(PROMPT_ANTHROPIC).not.toContain("Use these tools VERY frequently")
    expect(PROMPT_ANTHROPIC).not.toContain("Always use the TodoWrite tool")
    expect(PROMPT_ANTHROPIC).toContain("Never ask permission questions")

    const gemini = SystemPrompt.provider({
      id: "google/gemini-3-pro",
      providerID: "google",
      api: { id: "gemini-3-pro", url: "https://generativelanguage.googleapis.com" },
    } as any)
    expect(gemini).toEqual([PROMPT_GEMINI, PROMPT_CRAFT])
    expect(PROMPT_GEMINI).toContain("Default to doing the work")
    expect(PROMPT_GEMINI).toContain("avoid over-engineering")
    expect(PROMPT_GEMINI).not.toContain("fewer than 3 lines")
    expect(PROMPT_GEMINI).not.toContain("Should I proceed with refactor_apply")
    expect(PROMPT_GEMINI).not.toContain("create-react-app")
    expect(PROMPT_GEMINI).not.toContain("Solicit Feedback")
    expect(PROMPT_GEMINI).toContain("Never ask permission questions")
  })

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

  test("environment includes autonomous PRD/ADR workflow when enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    const original = process.env.AX_CODE_AUTONOMOUS
    process.env.AX_CODE_AUTONOMOUS = "true"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await SystemPrompt.environment({
            api: { id: "test-model" },
            providerID: "test-provider",
          } as any)

          const text = result.join("\n")
          expect(text).toContain("<autonomous_workflow>")
          expect(text).toContain("avoid over-engineering")
          expect(text).toContain("plan → implement → verify")
          expect(text).toContain("task_parallel")
          expect(text).toContain("<verification_protocol>")
          expect(text).toContain("verify_project")
        },
      })
    } finally {
      if (original === undefined) delete process.env.AX_CODE_AUTONOMOUS
      else process.env.AX_CODE_AUTONOMOUS = original
    }
  })

  test("skills output includes recommendations when messages match skill paths", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".ax-code", "skill", "ts-skill")
        await mkdir(skillDir, { recursive: true })
        await writeFile(
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
          const session = await Session.create({})
          const messages = [
            {
              info: { id: "m1", sessionID: session.id, role: "assistant" as const },
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

          Recorder.begin(session.id)
          const result = await SystemPrompt.skills(build!, messages)
          Recorder.flushAll()
          const events = EventQuery.bySessionAndType(session.id, "skill.recommended")
          await Recorder.end(session.id)
          EventQuery.deleteBySession(session.id)
          await Session.remove(session.id)

          expect(result).toContain(`recommended="true"`)
          expect(result).toContain("ts-skill")
          expect(result).toContain("recommended for loading")
          expect(events).toHaveLength(1)
          expect(events[0]).toMatchObject({
            type: "skill.recommended",
            agent: "build",
            source: "path_match",
            filePaths: ["src/index.ts"],
            skills: [{ name: "ts-skill", paths: ["**/*.ts"] }],
          })
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
        await mkdir(skillDir, { recursive: true })
          await writeFile(
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
