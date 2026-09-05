import { expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { ConfigMarkdown } from "../../src/config/markdown"
import { Skill } from "../../src/skill"

const CLOUD_SKILL_DIRS = [
  "cloud-ops-aws",
  "cloud-ops-gcp",
  "cloud-ops-cloudflare",
  "cloud-ops-digitalocean",
  "cloud-ops-runpod",
  "vyos-firewall",
  "junos-firewall",
] as const

const SKILLS_ROOT = path.resolve(import.meta.dirname, "../../skills")

for (const dir of CLOUD_SKILL_DIRS) {
  test(`builtin cloud skill ${dir} has valid frontmatter and body`, async () => {
    const location = path.join(SKILLS_ROOT, dir, "SKILL.md")
    const content = await fs.readFile(location, "utf8")

    const md = await ConfigMarkdown.parseText(location, content)
    const data = md.data as Record<string, unknown>

    // Name and description come from the same zod shape the loader requires.
    const parsed = Skill.Info.pick({ name: true, description: true }).safeParse(data)
    if (!parsed.success) throw new Error(`invalid frontmatter in ${location}: ${parsed.error.message}`)
    expect(parsed.data.name).toBe(dir)
    expect(parsed.data.description.length).toBeGreaterThan(0)
    expect(parsed.data.description).toContain("Use when")

    expect(data.agent).toBe("cloudops")
    expect(typeof data["argument-hint"]).toBe("string")
    expect((data["argument-hint"] as string).length).toBeGreaterThan(0)

    // Body guards: every skill documents a rollback path and a safe-execution keyword.
    expect(md.content).toContain("rollback")
    expect(md.content).toMatch(/dry-run|plan|read-only/i)
    expect(md.content).toContain("## Constraints")
  })
}

test("vyos-firewall mandates commit-confirm and junos-firewall mandates commit confirmed", async () => {
  const vyos = await fs.readFile(path.join(SKILLS_ROOT, "vyos-firewall", "SKILL.md"), "utf8")
  const vyosMd = await ConfigMarkdown.parseText("vyos-firewall/SKILL.md", vyos)
  expect(vyosMd.content).toContain("commit-confirm")

  const junos = await fs.readFile(path.join(SKILLS_ROOT, "junos-firewall", "SKILL.md"), "utf8")
  const junosMd = await ConfigMarkdown.parseText("junos-firewall/SKILL.md", junos)
  expect(junosMd.content).toContain("commit confirmed")
})
