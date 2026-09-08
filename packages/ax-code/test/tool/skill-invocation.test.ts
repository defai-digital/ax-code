import { afterEach, expect, test, vi } from "vitest"
import path from "path"
import fs from "fs/promises"
import { Skill } from "../../src/skill"
import { buildSkillDoctorReport, buildSkillValidationReport } from "../../src/skill/authoring"
import { Agent } from "../../src/agent/agent"
import { Command } from "../../src/command"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { SkillTool } from "../../src/tool/skill"
import type { Tool } from "../../src/tool/tool"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

function context(): Tool.Context {
  return {
    sessionID: SessionID.make("ses_skill_policy"),
    messageID: MessageID.make("msg_skill_policy"),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    ask: vi.fn(async () => {}),
  }
}

async function writeSkill(root: string, name: string, policy = "", sidecar?: string) {
  const dir = path.join(root, ".agents", "skills", name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Policy fixture ${name}.\n${policy}\n---\nPRIVATE BODY ${name}\n`,
  )
  if (sidecar !== undefined) {
    await fs.mkdir(path.join(dir, "agents"))
    await fs.writeFile(path.join(dir, "agents", "openai.yaml"), sidecar)
  }
}

test("manual-only skills stay explicit commands but cannot be advertised, searched or model-loaded", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await writeSkill(dir, "manual-claude", "disable-model-invocation: true")
      await writeSkill(dir, "manual-codex", "", "policy:\n  allow_implicit_invocation: false\n")
      await writeSkill(dir, "automatic-fixture")
      await writeSkill(dir, "agent-only", "user-invocable: false")
      await writeSkill(dir, "invalid-policy", "disable-model-invocation: perhaps")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("build")
      const prompt = await SystemPrompt.skills(agent!)
      const tool = await SkillTool.init({ agent })
      const ctx = context()
      for (const name of ["manual-claude", "manual-codex"]) {
        expect(prompt).not.toContain(name)
        expect(tool.description).not.toContain(name)
        expect((await Skill.all()).some((skill) => skill.name === name)).toBe(true)
        const command = await Command.get(name)
        expect(command?.source).toBe("skill")
        expect(await command?.template).toContain(`PRIVATE BODY ${name}`)
        await expect(tool.execute({ name }, ctx)).rejects.toThrow("not available for model invocation")
        const search = await tool.execute({ query: name }, ctx)
        expect(search.output).not.toContain(name)
        expect(search.metadata.total).toBe(0)
      }
      expect(ctx.ask).not.toHaveBeenCalled()
      expect(await Command.get("agent-only")).toBeUndefined()
      expect(await Command.get("invalid-policy")).toBeUndefined()
      expect((await Skill.get("invalid-policy"))?.invocationIssues?.length).toBeGreaterThan(0)
      for (const report of [buildSkillDoctorReport(await Skill.all()), buildSkillValidationReport(await Skill.all())]) {
        expect(report.issues.find((entry) => entry.name === "invalid-policy")?.issues).toContain(
          "disable-model-invocation must be a boolean",
        )
      }
      expect(prompt).toContain("agent-only")
      expect(prompt).not.toContain("PRIVATE BODY")
      const search = await tool.execute({ query: "automatic-fixture" }, ctx)
      expect(search.metadata.total).toBe(1)
      expect(search.output).not.toContain("PRIVATE BODY")
      expect(ctx.ask).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "skill", patterns: ["automatic-fixture"] }),
      )
      const loaded = await tool.execute({ name: "automatic-fixture" }, ctx)
      expect(loaded.output).toContain("PRIVATE BODY automatic-fixture")
    },
  })
})

test("permission-denied skills are absent from discovery and guessed-name loads", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { permission: { skill: { "*": "allow", "private-fixture": "deny" } } },
    init: async (dir) => {
      await writeSkill(dir, "private-fixture")
      await writeSkill(dir, "public-fixture")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("build")
      const tool = await SkillTool.init({ agent })
      const ctx = context()
      expect(tool.description).not.toContain("private-fixture")
      const search = await tool.execute({ query: "fixture" }, ctx)
      expect(search.output).not.toContain("private-fixture")
      expect(search.output).toContain("public-fixture")
      await expect(tool.execute({ name: "private-fixture" }, ctx)).rejects.toThrow("not available")
      await expect(tool.execute({ name: "absent" }, ctx)).rejects.toThrow("Use query")
      const blocked = context()
      blocked.ask = async () => {
        throw new Error("Permission rejected")
      }
      await expect(tool.execute({ name: "public-fixture" }, blocked)).rejects.toThrow("Permission rejected")
      await expect(tool.execute({ query: "public-fixture" }, blocked)).rejects.toThrow("Permission rejected")
    },
  })
})

test("tool validates discovery mode and returns bounded pages with continuation", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      for (let i = 0; i < 250; i++) await writeSkill(dir, `page-fixture-${String(i).padStart(3, "0")}`)
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const tool = await SkillTool.init()
      expect(tool.parameters.safeParse({}).success).toBe(false)
      expect(tool.parameters.safeParse({ name: "a", query: "b" }).success).toBe(false)
      expect(tool.parameters.safeParse({ name: "a", offset: 0 }).success).toBe(false)
      expect(tool.parameters.safeParse({ query: "", offset: -1 }).success).toBe(false)
      expect(tool.parameters.safeParse({ query: "x".repeat(257) }).success).toBe(false)
      let offset: number | undefined = 0
      let shown = 0
      let pages = 0
      do {
        const page = await tool.execute({ query: "page-fixture", offset }, context())
        expect(page.output.length).toBeLessThanOrEqual(8000)
        expect(page.output).not.toContain("PRIVATE BODY")
        shown += page.metadata.shown ?? 0
        if (page.metadata.nextOffset !== undefined) expect(page.metadata.nextOffset).toBeGreaterThan(offset!)
        offset = page.metadata.nextOffset
        pages++
      } while (offset !== undefined)
      expect(pages).toBeGreaterThan(1)
      expect(shown).toBe(250)
    },
  })
})
