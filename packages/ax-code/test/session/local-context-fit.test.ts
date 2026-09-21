import { afterEach, describe, expect, test, vi } from "vitest"
import z from "zod"
import { Instance } from "../../src/project/instance"
import { Skill } from "../../src/skill"
import { SkillTool } from "../../src/tool/skill"
import { SystemPrompt } from "../../src/session/system"
import { ToolRegistry } from "../../src/tool/registry"
import { SessionCompaction } from "../../src/session/compaction"
import { estimateRequestTokens, estimateToolDefinitionTokens } from "../../src/session/prompt/prompt-request"
import { maybeSchedulePreflightCompaction } from "../../src/session/prompt/prompt-loop-compaction"
import { buildContext, getContext } from "../../src/memory/injector"
import * as store from "../../src/memory/store"
import { tmpdir } from "../fixture/fixture"

const agent = { name: "build", mode: "primary", permission: [], options: {} } as any
const model = {
  id: "tiel-coder-35b-axq-mxfp4",
  providerID: "ax-engine",
  name: "Tiel Coder",
  api: { id: "tiel-coder-35b-axq-mxfp4", npm: "@ai-sdk/openai-compatible", url: "http://localhost:31418/v1" },
  limit: { context: 16384, output: 768 },
  capabilities: { toolcall: true },
  options: {},
} as any
const skills = Array.from({ length: 22 }, (_, i) => ({
  name: `fixture-${String(i).padStart(2, "0")}`,
  description: `Workflow ${i}: ${"Preserve instructions and permissions. ".repeat(6)}`,
  location: `/skills/fixture-${i}/SKILL.md`,
  builtin: true,
})) as any

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  store._resetReadCache()
  await Instance.disposeAll()
})

describe("local context deduplication", () => {
  test("local skill schemas keep discovery and loading while cloud retains its catalog", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(Skill, "modelAvailable").mockResolvedValue(skills)
        const local = await SkillTool.init({ agent, model: { providerID: "ax-engine", modelID: model.id } })
        const cloud = await SkillTool.init({ agent, model: { providerID: "openai", modelID: "gpt-test" } })
        const defaultTool = await SkillTool.init({ agent })
        expect(local.description).toContain("<available_skills>")
        expect(local.description).toContain('query=""')
        expect(local.description).toContain("offset")
        expect(local.description).not.toContain("## Available Skills")
        expect(cloud.description).toBe(defaultTool.description)
        expect(cloud.description).toContain("**fixture-00**")
        expect(z.toJSONSchema(local.parameters)).toEqual(z.toJSONSchema(cloud.parameters))
        const catalog = await SystemPrompt.skills(agent)
        expect(catalog).toContain("<available_skills>")
        expect(catalog).toContain("fixture-00")
        // Query is metadata-only, still permission checked, and can find entries
        // omitted from the bounded initial system catalog.
        const ask = vi.fn(async () => {})
        const result = await local.execute({ query: "fixture-21" }, {
          sessionID: "ses_test",
          messageID: "msg_test",
          agent: "build",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => {},
          ask,
        } as any)
        expect(result.output).toContain("fixture-21")
        expect(ask).toHaveBeenCalledWith(expect.objectContaining({ permission: "skill", patterns: ["fixture-21"] }))
      },
    })
  })

  test.each([15826, 17268])(
    "reproduces fixed budget %i, then fits 16k without losing unique content",
    async (baseline) => {
      await using tmp = await tmpdir({ git: true })
      vi.stubEnv("AX_CODE_TEST_HOME", tmp.path)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          vi.spyOn(Skill, "modelAvailable").mockResolvedValue(skills)
          const local = await SkillTool.init({ agent, model: { providerID: "ax-engine", modelID: model.id } })
          const legacy = await SkillTool.init({ agent })
          const memory = {
            version: 1,
            created: "2026-09-21",
            updated: "2026-09-21",
            projectRoot: tmp.path,
            contentHash: "fixture",
            maxTokens: 10000,
            totalTokens: 2000,
            sections: {
              feedback: {
                tokens: 2000,
                entries: [{ name: "rules", body: "Keep all user rules. ".repeat(400), savedAt: "2026-09-21" }],
              },
            },
          }
          await store.save(tmp.path, memory)
          const oldMemory = buildContext(memory, { global: structuredClone(memory) })
          const newMemory = await getContext(tmp.path)
          const catalog = (await SystemPrompt.skills(agent))!
          const estimateTool = (t: typeof local) =>
            estimateToolDefinitionTokens([
              { id: "skill", description: t.description, inputSchema: z.toJSONSchema(t.parameters) },
            ])
          const oldFixed = estimateRequestTokens({ system: [catalog, oldMemory], messages: [] }) + estimateTool(legacy)
          // Calibrate only the unchanged fixture instructions to the recorded
          // incident total; this is a preflight regression, not a tokenizer claim.
          const instructions = "x".repeat((baseline - oldFixed - 4) * 4)
          const oldSystem = [catalog, oldMemory, instructions]
          const newSystem = [catalog, newMemory, instructions]
          const registry = vi.spyOn(ToolRegistry, "tools").mockResolvedValue([{ id: "skill", ...legacy }] as any)
          vi.spyOn(SessionCompaction, "budget").mockResolvedValue({ cap: 16384, reserved: 0, usable: 16384 })
          const compact = vi.spyOn(SessionCompaction, "create").mockResolvedValue({} as any)
          const request = {
            sessionID: "ses_test" as any,
            agent: "build",
            agentInfo: agent,
            userModel: { providerID: model.providerID, modelID: model.id },
            // Even an overstated separate input limit cannot override context-output.
            model: { ...model, limit: { ...model.limit, input: 65536 } },
            userParts: [{ type: "text", text: "Inspect the project" } as any],
            requestMessages: [{ role: "user" as const, content: "Inspect the project" }],
          }
          const blocked = await maybeSchedulePreflightCompaction({ ...request, system: oldSystem })
          expect(blocked).toMatchObject({ action: "block", fixedTokens: baseline, usableTokens: 15616 })
          if (blocked.action === "block") expect(blocked.message).toMatch(/\d+ system \+ \d+ tool schemas/)
          registry.mockResolvedValue([{ id: "skill", ...local }] as any)
          const fixed = estimateRequestTokens({ system: newSystem, messages: [] }) + estimateTool(local)
          expect(15616 - fixed).toBeGreaterThan(1000)
          expect(
            await maybeSchedulePreflightCompaction({
              ...request,
              system: newSystem,
              requestMessages: [{ role: "user", content: "x".repeat(4000) }],
            }),
          ).toEqual({ action: "continue" })
          expect(compact).not.toHaveBeenCalled()
          expect(newSystem[0]).toBe(oldSystem[0])
          expect(newSystem[2]).toBe(oldSystem[2])
          expect(model.limit).toEqual({ context: 16384, output: 768 })
        },
      })
    },
  )
})
