import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("./api.js", () => ({
  fetchClawdHubSkills: vi.fn(),
}))

const { fetchClawdHubSkills } = await import("./api.js")
const { scanClawdHub, scanClawdHubPage } = await import("./scan.js")

const skill = (overrides) => ({
  slug: "review-code",
  displayName: "Review Code",
  summary: "Review code and suggest focused fixes.",
  tags: { latest: "1.0.0" },
  stats: { downloads: 1, stars: 0, versions: 1 },
  owner: { handle: "team-alpha" },
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

describe("ClawdHub skills catalog scan", () => {
  beforeEach(() => {
    fetchClawdHubSkills.mockReset()
  })

  test("filters non-English catalog items", async () => {
    fetchClawdHubSkills.mockResolvedValueOnce({
      items: [
        skill({
          slug: "non-english-skill",
          displayName: "Review Code | \u4ee3\u7801\u5ba1\u67e5",
        }),
        skill({
          slug: "english-skill",
          displayName: "English Skill",
          summary: "Install English-only workflow instructions.",
        }),
      ],
      nextCursor: null,
    })

    const result = await scanClawdHubPage()

    expect(result).toMatchObject({ ok: true, nextCursor: null })
    expect(result.items.map((item) => item.skillName)).toEqual(["english-skill"])
  })

  test("skips empty non-English pages before returning a page", async () => {
    fetchClawdHubSkills
      .mockResolvedValueOnce({
        items: [
          skill({
            slug: "non-english-skill",
            displayName: "\u4ee3\u7801\u5ba1\u67e5",
            summary: "\u4ee3\u7801\u5ba1\u67e5\u52a9\u624b\u3002",
          }),
        ],
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        items: [
          skill({
            slug: "english-skill",
            displayName: "English Skill",
            summary: "Install English-only workflow instructions.",
          }),
        ],
        nextCursor: "cursor-3",
      })

    const result = await scanClawdHubPage()

    expect(fetchClawdHubSkills).toHaveBeenNthCalledWith(1, { cursor: null })
    expect(fetchClawdHubSkills).toHaveBeenNthCalledWith(2, { cursor: "cursor-2" })
    expect(result).toMatchObject({ ok: true, nextCursor: "cursor-3" })
    expect(result.items.map((item) => item.skillName)).toEqual(["english-skill"])
  })

  test("full scans only include English-only items", async () => {
    fetchClawdHubSkills.mockResolvedValueOnce({
      items: [
        skill({
          slug: "english-skill",
          displayName: "English Skill",
          summary: "Install English-only workflow instructions.",
        }),
        skill({
          slug: "non-english-skill",
          displayName: "\u30ec\u30d3\u30e5\u30fc",
        }),
      ],
      nextCursor: null,
    })

    const result = await scanClawdHub()

    expect(result).toMatchObject({ ok: true })
    expect(result.items.map((item) => item.skillName)).toEqual(["english-skill"])
  })
})
