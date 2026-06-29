import type { SkillDetail } from "@/stores/useSkillsStore"

export type SkillDetailLoadResult =
  | { status: "loaded"; detail: SkillDetail }
  | { status: "missing" }
  | { status: "stale" }
  | { status: "failed"; error: unknown }

export const loadCurrentSkillDetail = async ({
  skillName,
  getSkillDetail,
  isCurrent,
}: {
  skillName: string
  getSkillDetail: (name: string) => Promise<SkillDetail | null>
  isCurrent: () => boolean
}): Promise<SkillDetailLoadResult> => {
  try {
    const detail = await getSkillDetail(skillName)
    if (!isCurrent()) {
      return { status: "stale" }
    }
    return detail ? { status: "loaded", detail } : { status: "missing" }
  } catch (error) {
    if (!isCurrent()) {
      return { status: "stale" }
    }
    return { status: "failed", error }
  }
}
