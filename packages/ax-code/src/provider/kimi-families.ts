const FAMILY_ORDER = ["kimi-k3", "kimi-coding"] as const

export type KimiFamilySource = {
  id: string
  name?: string
  family?: string
  release_date?: string
}

export function kimiFamilyId(input: { id?: string; family?: string }): string | undefined {
  const id = (input.id ?? "").toLowerCase()
  if (id === "kimi-cli") return undefined
  const segment = id.split("/").pop() ?? id
  if (segment === "k3" || segment.startsWith("k3-")) return "kimi-k3"
  if (segment.includes("kimi-for-coding") || segment === "kimi-k2.7-code" || segment === "kimi-k2-7-code") {
    return "kimi-coding"
  }
  return undefined
}

export function kimiFamilySortKey(family?: string): number {
  const index = FAMILY_ORDER.indexOf(family as (typeof FAMILY_ORDER)[number])
  return index === -1 ? FAMILY_ORDER.length : index
}

export function kimiDisplayName(name: string | undefined, fallback: string): string {
  const trimmed = (name ?? fallback)
    .replace(/\s*\(latest\)\s*/gi, " ")
    .replace(/^openrouter:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function latestKimiFamilyModels<T extends KimiFamilySource>(models: Record<string, T>): T[] {
  const best = new Map<string, T>()
  for (const [id, model] of Object.entries(models)) {
    const family = kimiFamilyId({ id: model.id ?? id, family: model.family })
    if (!family) continue
    const current = best.get(family)
    if (!current || compareKimiFamilyModels(model, current, id) > 0) best.set(family, model)
  }
  return FAMILY_ORDER.map((family) => best.get(family)).filter((model): model is T => model !== undefined)
}

export function kimiFallbackModels(): Array<
  KimiFamilySource & {
    attachment: boolean
    reasoning: boolean
    temperature: boolean
    tool_call: boolean
    modalities: { input: Array<"text" | "image" | "video">; output: Array<"text"> }
    limit: { context: number; output: number }
    status: "active"
  }
> {
  return [
    {
      id: "kimi-code/k3",
      name: "K3",
      family: "kimi-k3",
      release_date: "2026-08-01",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      modalities: { input: ["text", "image", "video"], output: ["text"] },
      limit: { context: 1_048_576, output: 262_144 },
      status: "active",
    },
    {
      id: "kimi-code/kimi-for-coding",
      name: "K2.7 Coding",
      family: "kimi-coding",
      release_date: "2026-06-12",
      attachment: true,
      reasoning: true,
      temperature: true,
      tool_call: true,
      modalities: { input: ["text", "image", "video"], output: ["text"] },
      limit: { context: 262_144, output: 262_144 },
      status: "active",
    },
  ]
}

function compareKimiFamilyModels(a: KimiFamilySource, b: KimiFamilySource, aKey: string): number {
  const aId = (a.id ?? aKey).toLowerCase()
  const bId = b.id.toLowerCase()
  const byVariant = Number(isKimiSecondaryVariant(bId)) - Number(isKimiSecondaryVariant(aId))
  if (byVariant !== 0) return byVariant
  const aVer = kimiVersion(aId)
  const bVer = kimiVersion(bId)
  if (aVer[0] !== bVer[0]) return aVer[0] - bVer[0]
  if (aVer[1] !== bVer[1]) return aVer[1] - bVer[1]
  return releaseTime(a.release_date) - releaseTime(b.release_date)
}

function isKimiSecondaryVariant(id: string): boolean {
  const segment = id.split("/").pop() ?? id
  return segment.includes("highspeed") || segment.includes("256k")
}

function kimiVersion(id: string): [number, number] {
  const segment = (id.split("/").pop() ?? id).toLowerCase()
  if (segment === "k3" || segment.startsWith("k3-")) return [3, 0]
  const match = segment.match(/kimi-k(\d+)(?:[.-](\d+))?/)
  if (!match) return [0, 0]
  return [Number(match[1]), Number(match[2] ?? 0)]
}

function releaseTime(value?: string): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}
