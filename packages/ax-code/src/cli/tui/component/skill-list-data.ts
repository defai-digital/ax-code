import { isRecord } from "@/util/record"

export type DialogSkillItem = {
  name: string
  description?: string
}

function isDialogSkillItem(input: unknown): input is DialogSkillItem {
  return (
    isRecord(input) &&
    typeof input.name === "string" &&
    (input.description === undefined || typeof input.description === "string")
  )
}

export function normalizeDialogSkills(data: unknown): DialogSkillItem[] {
  return Array.isArray(data) ? data.filter(isDialogSkillItem) : []
}
