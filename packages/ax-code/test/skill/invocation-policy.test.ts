import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { SkillInvocationPolicy } from "../../src/skill/invocation-policy"

const { normalize, read } = SkillInvocationPolicy

async function writeSidecar(dir: string, content: string) {
  await fs.mkdir(path.join(dir, "agents"), { recursive: true })
  await fs.writeFile(path.join(dir, "agents", "openai.yaml"), content)
}

describe("SkillInvocationPolicy.normalize", () => {
  test("defaults to both invocation modes when nothing is declared", () => {
    const result = normalize({})
    expect(result).toEqual({ modelInvocable: true, userInvocable: true, issues: [] })
  })

  test("disable-model-invocation disables only model invocation", () => {
    const result = normalize({ "disable-model-invocation": true })
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(true)
    expect(result.issues).toEqual([])
  })

  test("user-invocable false disables only user invocation", () => {
    const result = normalize({ "user-invocable": false })
    expect(result.modelInvocable).toBe(true)
    expect(result.userInvocable).toBe(false)
    expect(result.issues).toEqual([])
  })

  test("both frontmatter restrictions combine", () => {
    const result = normalize({ "disable-model-invocation": true, "user-invocable": false })
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(false)
    expect(result.issues).toEqual([])
  })

  test("sidecar allow_implicit_invocation false disables model invocation", () => {
    const result = normalize({}, { policy: { allow_implicit_invocation: false } })
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(true)
    expect(result.issues).toEqual([])
  })

  test("conflicting sources resolve to the restrictive value", () => {
    const permissiveFrontmatter = normalize(
      { "disable-model-invocation": false },
      {
        policy: { allow_implicit_invocation: false },
      },
    )
    expect(permissiveFrontmatter.modelInvocable).toBe(false)
    expect(permissiveFrontmatter.userInvocable).toBe(true)

    const restrictiveFrontmatter = normalize(
      { "disable-model-invocation": true },
      {
        policy: { allow_implicit_invocation: true },
      },
    )
    expect(restrictiveFrontmatter.modelInvocable).toBe(false)
    expect(restrictiveFrontmatter.userInvocable).toBe(true)
  })

  test("valid permissive sidecar keeps defaults", () => {
    const result = normalize({}, { policy: { allow_implicit_invocation: true } })
    expect(result).toEqual({ modelInvocable: true, userInvocable: true, issues: [] })
  })

  test("invalid boolean types on frontmatter flags fail closed", () => {
    for (const data of [
      { "disable-model-invocation": "true" },
      { "disable-model-invocation": 1 },
      { "disable-model-invocation": null },
      { "user-invocable": "yes" },
      { "user-invocable": 0 },
      { "user-invocable": null },
    ]) {
      const result = normalize(data)
      expect(result.modelInvocable, JSON.stringify(data)).toBe(false)
      expect(result.userInvocable, JSON.stringify(data)).toBe(false)
      expect(result.issues.length, JSON.stringify(data)).toBe(1)
      expect(result.issues[0], JSON.stringify(data)).toMatch(/must be a boolean/)
    }
  })

  test("invalid boolean type on sidecar allow_implicit_invocation fails closed", () => {
    const result = normalize({}, { policy: { allow_implicit_invocation: "no" } })
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(false)
    expect(result.issues).toEqual([`policy.allow_implicit_invocation must be a boolean`])
  })

  test("invalid sidecar root fails closed", () => {
    for (const sidecar of ["nope", [1, 2], null, 42, new Date("2026-09-08")]) {
      const result = normalize({}, sidecar)
      expect(result.modelInvocable, JSON.stringify(sidecar)).toBe(false)
      expect(result.userInvocable, JSON.stringify(sidecar)).toBe(false)
      expect(result.issues, JSON.stringify(sidecar)).toEqual([`agents/openai.yaml: root must be a mapping`])
    }
  })

  test("invalid sidecar policy fails closed", () => {
    const result = normalize({}, { policy: "nope" })
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(false)
    expect(result.issues).toEqual([`agents/openai.yaml: policy must be a mapping`])
  })
})

describe("SkillInvocationPolicy.read", () => {
  test("missing sidecar defaults with no issues", async () => {
    await using tmp = await tmpdir()
    const result = await read(path.join(tmp.path, "SKILL.md"), { name: "demo" })
    expect(result).toEqual({ modelInvocable: true, userInvocable: true, issues: [] })
  })

  test("empty sidecar file defaults with no issues", async () => {
    await using tmp = await tmpdir()
    await writeSidecar(tmp.path, "")
    const result = await read(path.join(tmp.path, "SKILL.md"), {})
    expect(result).toEqual({ modelInvocable: true, userInvocable: true, issues: [] })
  })

  test("valid sidecar applies allow_implicit_invocation false", async () => {
    await using tmp = await tmpdir()
    await writeSidecar(tmp.path, "policy:\n  allow_implicit_invocation: false\n")
    const result = await read(path.join(tmp.path, "SKILL.md"), {})
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(true)
    expect(result.issues).toEqual([])
  })

  test("sidecar combines with frontmatter restrictions", async () => {
    await using tmp = await tmpdir()
    await writeSidecar(tmp.path, "policy:\n  allow_implicit_invocation: true\n")
    const result = await read(path.join(tmp.path, "SKILL.md"), { "disable-model-invocation": true })
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(true)
    expect(result.issues).toEqual([])
  })

  test("malformed YAML fails closed", async () => {
    await using tmp = await tmpdir()
    await writeSidecar(tmp.path, "policy: [unclosed\n  broken: {\n")
    const result = await read(path.join(tmp.path, "SKILL.md"), {})
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(false)
    expect(result.issues.length).toBe(1)
    expect(result.issues[0]).toMatch(/openai\.yaml/)
  })

  test("non-mapping YAML root fails closed", async () => {
    await using tmp = await tmpdir()
    await writeSidecar(tmp.path, "- a\n- b\n")
    const result = await read(path.join(tmp.path, "SKILL.md"), {})
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(false)
    expect(result.issues).toEqual([`agents/openai.yaml: root must be a mapping`])
  })

  test("YAML timestamps are not accepted as root or policy mappings", async () => {
    await using tmp = await tmpdir()
    for (const content of ["2026-09-08\n", "policy: 2026-09-08\n"]) {
      await writeSidecar(tmp.path, content)
      const result = await read(path.join(tmp.path, "SKILL.md"), {})
      expect(result.modelInvocable).toBe(false)
      expect(result.userInvocable).toBe(false)
      expect(result.issues[0]).toContain("must be a mapping")
    }
  })

  test("YAML anchors, aliases, and merge keys are rejected", async () => {
    await using tmp = await tmpdir()
    await writeSidecar(tmp.path, "base: &base\n  allow_implicit_invocation: false\npolicy:\n  <<: *base\n")
    const result = await read(path.join(tmp.path, "SKILL.md"), {})
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(false)
    expect(result.issues.length).toBe(1)
    expect(result.issues[0]).toMatch(/anchors, aliases/)
  })

  test("standalone delimiter lines are rejected", async () => {
    await using tmp = await tmpdir()
    await writeSidecar(tmp.path, "policy:\n  allow_implicit_invocation: false\n---\nname: injected\n")
    const result = await read(path.join(tmp.path, "SKILL.md"), {})
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(false)
    expect(result.issues.length).toBe(1)
    expect(result.issues[0]).toMatch(/'---' delimiter/)
  })

  test("oversized sidecar fails closed", async () => {
    await using tmp = await tmpdir()
    const padding = "# " + "x".repeat(70_000) + "\n"
    await writeSidecar(tmp.path, "policy:\n  allow_implicit_invocation: false\n" + padding)
    const result = await read(path.join(tmp.path, "SKILL.md"), {})
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(false)
    expect(result.issues.length).toBe(1)
    expect(result.issues[0]).toMatch(/exceeds the 65536 byte limit/)
  })

  test("unreadable sidecar path fails closed", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "agents", "openai.yaml"), { recursive: true })
    const result = await read(path.join(tmp.path, "SKILL.md"), {})
    expect(result.modelInvocable).toBe(false)
    expect(result.userInvocable).toBe(false)
    expect(result.issues.length).toBe(1)
    expect(result.issues[0]).toMatch(/failed to read/)
  })
})
