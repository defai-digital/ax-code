import { describe, expect, test } from "vitest"

import { guessCatalogLabelFromSource } from "./catalogSourceLabels"

describe("guessCatalogLabelFromSource", () => {
  test("uses the owner/repo path from SSH sources", () => {
    expect(guessCatalogLabelFromSource("git@gitlab.example.com:group/subgroup/repo.git")).toBe("group/subgroup/repo")
  })

  test("handles IPv6 SSH hosts without splitting the host address as the path", () => {
    expect(guessCatalogLabelFromSource("git@[2001:db8::1]:group/repo.git")).toBe("group/repo")
  })

  test("falls back to the raw source for incomplete SSH sources", () => {
    expect(guessCatalogLabelFromSource("git@github.com")).toBe("git@github.com")
  })

  test("uses the path from HTTPS sources", () => {
    expect(guessCatalogLabelFromSource("https://github.com/owner/repo.git")).toBe("owner/repo")
  })

  test("uses owner/repo for shorthand sources and ignores subpaths", () => {
    expect(guessCatalogLabelFromSource("owner/repo/skills/review")).toBe("owner/repo")
  })
})
