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
  const index = FAMILY_ORDER.indexOf(family as (typeof FAMILY_ORDER)[number])
  return index === -1 ? FAMILY_ORDER.length : index
}

export function claudeDisplayName(name: string | undefined, fallback: string): string {
  const trimmed = (name ?? fallback)
    .replace(/\s*\(latest\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function latestAnthropicFamilyModels<T extends AnthropicFamilySource>(models: Record<string, T>): T[] {
  const best = new Map<string, T>()
  for (const [id, model] of Object.entries(models)) {
    const family = claudeFamilyId({ id: model.id ?? id, family: model.family })
    if (!family) continue
    const current = best.get(family)
    if (!current || compareAnthropicFamilyModels(model, current, id) > 0) best.set(family, model)
  }
  return FAMILY_ORDER.map((family) => best.get(family)).filter((model): model is T => model !== undefined)
}

function compareAnthropicFamilyModels(a: AnthropicFamilySource, b: AnthropicFamilySource, aKey: string): number {
  const byDate = releaseTime(a.release_date) - releaseTime(b.release_date)
  if (byDate !== 0) return byDate
  const byDated = Number(DATED_ID.test(b.id)) - Number(DATED_ID.test(a.id ?? aKey))
  if (byDated !== 0) return byDated
  const byLatest = Number(/\(latest\)/i.test(a.name ?? "")) - Number(/\(latest\)/i.test(b.name ?? ""))
  if (byLatest !== 0) return byLatest
  return (a.id ?? aKey).localeCompare(b.id)
}

function releaseTime(value?: string): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}
