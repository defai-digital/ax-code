import { familyDisplayName, familyReleaseTime, familySortKey, latestFamilyModels } from "./family-shared"

const DATED_ID = /-\d{8}$/
const FAMILY_ORDER = ["claude-opus", "claude-sonnet", "claude-haiku", "claude-fable"] as const

export type AnthropicFamilySource = {
  id: string
  name?: string
  family?: string
  release_date?: string
}

export function claudeFamilyId(input: { id?: string; family?: string }): string | undefined {
  const family = input.family?.toLowerCase()
  if (family && FAMILY_ORDER.includes(family as (typeof FAMILY_ORDER)[number])) return family
  const id = input.id?.toLowerCase() ?? ""
  if (id.includes("opus")) return "claude-opus"
  if (id.includes("sonnet")) return "claude-sonnet"
  if (id.includes("haiku")) return "claude-haiku"
  if (id.includes("fable")) return "claude-fable"
  return undefined
}

export function claudeFamilySortKey(family?: string): number {
  return familySortKey(FAMILY_ORDER, family)
}

export function claudeDisplayName(name: string | undefined, fallback: string): string {
  return familyDisplayName(name, fallback)
}

export function latestAnthropicFamilyModels<T extends AnthropicFamilySource>(models: Record<string, T>): T[] {
  return latestFamilyModels(models, FAMILY_ORDER, claudeFamilyId, compareAnthropicFamilyModels)
}

function compareAnthropicFamilyModels(a: AnthropicFamilySource, b: AnthropicFamilySource, aKey: string): number {
  const byDate = familyReleaseTime(a.release_date) - familyReleaseTime(b.release_date)
  if (byDate !== 0) return byDate
  const byDated = Number(DATED_ID.test(b.id)) - Number(DATED_ID.test(a.id ?? aKey))
  if (byDated !== 0) return byDated
  const byLatest = Number(/\(latest\)/i.test(a.name ?? "")) - Number(/\(latest\)/i.test(b.name ?? ""))
  if (byLatest !== 0) return byLatest
  return (a.id ?? aKey).localeCompare(b.id)
}
