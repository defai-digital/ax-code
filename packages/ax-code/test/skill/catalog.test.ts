import { describe, expect, test } from "vitest"
import { SkillCatalog } from "../../src/skill/catalog"

function skills(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `skill-${String(index).padStart(4, "0")}`,
    description: "Database migration verification. ".repeat(40),
    location: `/workspace/skills/skill-${index}/SKILL.md`,
    content: "PRIVATE FULL INSTRUCTIONS",
  }))
}

describe("skill metadata budgets", () => {
  test("bounds both metadata formats and exposes omission recovery without skill bodies", () => {
    for (const verbose of [true, false]) {
      const page = SkillCatalog.page(skills(250), { verbose })
      expect(page.output.length).toBeLessThanOrEqual(SkillCatalog.MAX_CHARACTERS)
      expect(page.output).toContain("skills omitted")
      expect(page.output).toContain("query")
      expect(page.output).not.toContain("PRIVATE FULL INSTRUCTIONS")
      if (verbose) expect(page.output).toContain("</available_skills>")
      expect(page.shown).toBeGreaterThan(0)
      expect(page.shown + page.omitted).toBe(250)
    }
  })

  test("search and pagination reach every eligible entry exactly once", () => {
    const input = SkillCatalog.search(skills(90), "DATABASE")
    const seen: string[] = []
    let offset: number | undefined = 0
    do {
      const page = SkillCatalog.page(input, { verbose: false, paginate: true, offset, maxCharacters: 1500 })
      expect(page.output.length).toBeLessThanOrEqual(1500)
      seen.push(...page.names)
      if (page.nextOffset !== undefined) expect(page.nextOffset).toBeGreaterThan(offset!)
      offset = page.nextOffset
    } while (offset !== undefined)
    expect(seen).toEqual(input.map((skill) => skill.name))
    expect(SkillCatalog.search(input, "skill-0089").map((skill) => skill.name)).toEqual(["skill-0089"])
    expect(SkillCatalog.search(input, ".*")).toEqual([])
  })

  test("prioritizes recommendations when reducing a list and retains stable small lists", () => {
    const input = skills(100)
    const recommended = new Set([input[99].name])
    const page = SkillCatalog.page(input, { verbose: true, recommended })
    expect(page.names[0]).toBe(input[99].name)
    expect(page.output).toContain('recommended="true"')
    expect(SkillCatalog.page(input, { verbose: true, recommended })).toEqual(page)
    const small = input.slice(0, 3)
    expect(SkillCatalog.page(small, { verbose: true, recommended: new Set([small[2].name]) }).names).toEqual(
      small.map((skill) => skill.name),
    )
  })

  test("budgets escaped expansion and skips oversized entries without preventing continuation", () => {
    const input = skills(8)
    input[0].name = "x".repeat(9000)
    input[1].description = "<injected>".repeat(1000)
    input[2].location = "/workspace/a&b/SKILL.md"
    const page = SkillCatalog.page(input, { verbose: true, paginate: true })
    expect(page.output.length).toBeLessThanOrEqual(SkillCatalog.MAX_CHARACTERS)
    expect(page.output).not.toContain("<injected>")
    expect(page.output).toContain("&lt;injected&gt;")
    expect(page.output).toContain("oversized entries skipped")
    expect(page.names).toContain(input[1].name)
    expect(page.output).toContain("a&amp;b")
  })

  test("handles empty and exhausted pages and rejects invalid offsets", () => {
    expect(SkillCatalog.page([], { verbose: false, paginate: true }).nextOffset).toBeUndefined()
    const exhausted = SkillCatalog.page(skills(2), { verbose: true, paginate: true, offset: 100 })
    expect(exhausted.shown).toBe(0)
    expect(exhausted.nextOffset).toBeUndefined()
    expect(() => SkillCatalog.page([], { verbose: false, offset: -1 })).toThrow("offset")
  })
})
