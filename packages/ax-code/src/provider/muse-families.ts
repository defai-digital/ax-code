const FAMILY_ORDER = ["muse-spark"] as const

export type MuseFamilySource = {
  id: string
  name?: string
  family?: string
  release_date?: string
}

export function museFamilyId(input: { id?: string; family?: string }): string | undefined {
  const id = (input.id?.split("/").pop() ?? input.id ?? "").toLowerCase()
  if (id === "muse-cli") return undefined
  if (/^muse-spark-\d+[.-]\d+/.test(id)) return "muse-spark"
  const family = input.family?.toLowerCase()
  if (family === "muse-spark") return "muse-spark"
  if (family === "muse" && id.includes("muse-spark")) return "muse-spark"
  return undefined
}

export function museFamilySortKey(family?: string): number {
  const index = FAMILY_ORDER.indexOf(family as (typeof FAMILY_ORDER)[number])
  return index === -1 ? FAMILY_ORDER.length : index
}

export function museDisplayName(name: string | undefined, fallback: string): string {
  const trimmed = (name ?? fallback)
    .replace(/\s*\(latest\)\s*/gi, " ")
    .replace(/^openrouter:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function latestMuseFamilyModels<T extends MuseFamilySource>(models: Record<string, T>): T[] {
  const best: Record<string, T | undefined> = {}
  for (const [id, model] of Object.entries(models)) {
    const family = museFamilyId({ id: model.id ?? id, family: model.family })
    if (!family) continue
    const current = best[family]
    if (!current || compareMuseFamilyModels(model, current, id) > 0) best[family] = model
  }
  return FAMILY_ORDER.map((family) => best[family]).filter((model): model is T => model !== undefined)
}

export function museFallbackLatest(): MuseFamilySource & {
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  tool_call: boolean
  modalities: { input: Array<"text" | "image">; output: Array<"text"> }
  limit: { context: number; output: number }
  status: "active"
} {
  return {
    id: "muse-spark-1.3",
    name: "Muse Spark 1.3",
    family: "muse",
    release_date: "2026-09-02",
    attachment: true,
    reasoning: true,
    temperature: true,
    tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1_048_576, output: 131_072 },
    status: "active",
  }
}

function compareMuseFamilyModels(a: MuseFamilySource, b: MuseFamilySource, aKey: string): number {
  const aId = (a.id ?? aKey).toLowerCase()
  const bId = (b.id ?? "").toLowerCase()
  const byVariant = Number(isMuseSecondaryVariant(bId)) - Number(isMuseSecondaryVariant(aId))
  if (byVariant !== 0) return byVariant
  const aVer = museSparkVersion(aId)
  const bVer = museSparkVersion(bId)
  if (aVer[0] !== bVer[0]) return aVer[0] - bVer[0]
  if (aVer[1] !== bVer[1]) return aVer[1] - bVer[1]
  return releaseTime(a.release_date) - releaseTime(b.release_date)
}

function isMuseSecondaryVariant(id: string): boolean {
  const segment = id.split("/").pop() ?? id
  return segment.includes("contributor") || segment.includes("free")
}

function museSparkVersion(id: string): [number, number] {
  const segment = (id.split("/").pop() ?? id).toLowerCase()
  const match = segment.match(/muse-spark-(\d+)[.-](\d+)/)
  if (!match) return [0, 0]
  return [Number(match[1]), Number(match[2])]
}

function releaseTime(value?: string): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}
