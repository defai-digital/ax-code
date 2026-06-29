import { describe, expect, test, vi } from "vitest"

import type { SkillDetail } from "@/stores/useSkillsStore"
import { loadCurrentSkillDetail } from "./skillDetailLoad"

const skillDetail = (name: string): SkillDetail => ({
  name,
  sources: {
    md: {
      exists: true,
      path: `/skills/${name}/SKILL.md`,
      dir: `/skills/${name}`,
      fields: [],
      supportingFiles: [],
      description: `${name} description`,
      instructions: `${name} instructions`,
    },
  },
})

describe("loadCurrentSkillDetail", () => {
  test("returns loaded detail for the current request", async () => {
    await expect(
      loadCurrentSkillDetail({
        skillName: "current",
        getSkillDetail: vi.fn(async () => skillDetail("current")),
        isCurrent: () => true,
      }),
    ).resolves.toEqual({ status: "loaded", detail: skillDetail("current") })
  })

  test("suppresses detail from stale requests", async () => {
    await expect(
      loadCurrentSkillDetail({
        skillName: "stale",
        getSkillDetail: vi.fn(async () => skillDetail("stale")),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })

  test("suppresses errors from stale requests", async () => {
    await expect(
      loadCurrentSkillDetail({
        skillName: "stale",
        getSkillDetail: vi.fn(async () => {
          throw new Error("network failed")
        }),
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ status: "stale" })
  })
})
