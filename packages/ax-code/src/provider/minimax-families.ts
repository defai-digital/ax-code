const FAMILY_ORDER = ["minimax-m3", "minimax-m2"] as const

export type MiniMaxFamilySource = {
  id: string
  name?: string
  family?: string
  release_date?: string
}

export function minimaxFamilyId(input: { id?: string; family?: string }): string | undefined {
  const id = (input.id?.split("/").pop() ?? input.id ?? "").toLowerCase()
  if (id === "minimax-cli") return undefined
  if (/^minimax-m3(?:$|[-.])/.test(id) || id === "minimax-m3") return "minimax-m3"
  if (/^minimax-m2/.test(id)) return "minimax-m2"
  return undefined
}

export function minimaxDisplayName(name: string | undefined, fallback: string): string {
  const trimmed = (name ?? fallback)
    .replace(/\s*\(latest\)\s*/gi, " ")
    .replace(/^openrouter:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function latestMiniMaxFamilyModels<T extends MiniMaxFamilySource>(models: Record<string, T>): T[] {
  const best: Record<string, T | undefined> = {}
  for (const [id, model] of Object.entries(models)) {
    const family = minimaxFamilyId({ id: model.id ?? id, family: model.family })
    if (!family) continue
    const current = best[family]
    if (!current || compareMiniMaxFamilyModels(model, current, id) > 0) best[family] = model
  }
  return FAMILY_ORDER.map((family) => best[family]).filter((model): model is T => model !== undefined)
}

export function minimaxFallbackLatest(): MiniMaxFamilySource & {
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  tool_call: boolean
  modalities: { input: Array<"text" | "image">; output: Array<"text"> }
  limit: { context: number; output: number }
  status: "active"
} {
  return {
    id: "MiniMax-M3",
    name: "MiniMax-M3",
    family: "minimax",
    release_date: "2026-06-01",
    attachment: true,
    reasoning: true,
    temperature: true,
    tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1_048_576, output: 512_000 },
    status: "active",
  }
}

function compareMiniMaxFamilyModels(a: MiniMaxFamilySource, b: MiniMaxFamilySource, aKey: string): number {
  const aId = (a.id ?? aKey).toLowerCase()
  const bId = (b.id ?? "").toLowerCase()
  const byVariant = Number(isMiniMaxSecondaryVariant(bId)) - Number(isMiniMaxSecondaryVariant(aId))
  if (byVariant !== 0) return byVariant
  const aVer = minimaxVersion(aId)
  const bVer = minimaxVersion(bId)
  if (aVer[0] !== bVer[0]) return aVer[0] - bVer[0]
  if (aVer[1] !== bVer[1]) return aVer[1] - bVer[1]
  return releaseTime(a.release_date) - releaseTime(b.release_date)
}

function isMiniMaxSecondaryVariant(id: string): boolean {
  const segment = id.split("/").pop() ?? id
  return segment.includes("highspeed") || segment.includes("high-speed")
}

function minimaxVersion(id: string): [number, number] {
  const segment = (id.split("/").pop() ?? id).toLowerCase()
  const match = segment.match(/minimax-m(\d+)(?:[.-](\d+))?/)
  if (!match) return [0, 0]
  return [Number(match[1]), Number(match[2] ?? 0)]
}

function releaseTime(value?: string): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}
