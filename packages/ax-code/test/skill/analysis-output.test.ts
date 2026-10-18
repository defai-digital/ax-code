import { afterEach, expect, test } from "vitest"
import { Skill } from "../../src/skill"
import { Command } from "../../src/command"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

test("analysis output is builtin, model eligible and explicitly invocable without a project install", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skill = await Skill.get("analysis-output")
      expect(skill).toMatchObject({ builtin: true, modelInvocable: true, userInvocable: true })
      expect(Skill.BUILTIN_NAMES.has("analysis-output")).toBe(true)
      expect(
        (await Skill.modelAvailable(await Agent.get("build"))).some((item) => item.name === "analysis-output"),
      ).toBe(true)
      const command = await Command.get("analysis-output")
      expect(command?.source).toBe("skill")
      expect(await command?.template).toBe(skill?.content)
      expect(skill?.content).toContain("AX BI MCP")
      expect(skill?.content).toContain("`dry_run: true`")
      expect(skill?.content).toContain("`save_charts: false`")
      expect(skill?.content).toContain("AX BI is optional")
      expect(skill?.content).toContain("Honor the requested framework")
      expect(skill?.content).toContain("Do not read an entire file into model context")
      expect(skill?.content).not.toContain("```ax-code-app")
      expect(skill?.content).not.toContain('"kind":"streamlit"')
    },
  })
})
