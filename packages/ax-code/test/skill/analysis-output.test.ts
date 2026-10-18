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
      // This is the presentation contract consumed by Desktop, not a permission grant.
      const fence = skill?.content.match(/```ax-code-app\n([^]*?)\n```/)
      expect(fence?.[1]).toBe('{"version":1,"kind":"streamlit","entrypoint":"streamlit_app.py"}')
    },
  })
})
