import { familyDisplayName, familyReleaseTime, familySortKey, latestFamilyModels } from "./family-shared"

const FAMILY_ORDER = ["grok-4"] as const

export type GrokFamilySource = {
  id: string
  name?: string
  family?: string
  release_date?: string
}

export function grokFamilyId(input: { id?: string; family?: string }): string | undefined {
  const id = (input.id?.split("/").pop() ?? input.id ?? "").toLowerCase()
  if (id === "grok-build-cli") return undefined
  if (
    /^grok-4(?:[.-]\d+)?(?:-latest)?$/.test(id) ||
    id === "grok-build-latest" ||
    id === "grok-4-5" ||
    id === "grok-4-6"
  ) {
    return "grok-4"
  }
  if (id.startsWith("grok-3")) return "grok-3"
  if (id.startsWith("grok-code") || id.includes("code-fast")) return "grok-code"
  const family = input.family?.toLowerCase()
  if (family === "grok" || family === "grok-4") return "grok-4"
  return undefined
}

export function grokFamilySortKey(family?: string): number {
  return familySortKey(FAMILY_ORDER, family)
}

export function grokDisplayName(name: string | undefined, fallback: string): string {
  return familyDisplayName(name, fallback, { stripOpenRouterPrefix: true })
}

export function latestGrokFamilyModels<T extends GrokFamilySource>(models: Record<string, T>): T[] {
  return latestFamilyModels(models, FAMILY_ORDER, grokFamilyId, compareGrokFamilyModels)
}

export function grokFallbackLatest(): GrokFamilySource & {
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  tool_call: boolean
  modalities: { input: Array<"text" | "image">; output: Array<"text"> }
  limit: { context: number; output: number }
  status: "active"
} {
  return {
    id: "grok-4.6",
    name: "Grok 4.6",
    family: "grok-4",
    release_date: "2026-08-19",
    attachment: true,
    reasoning: true,
    temperature: true,
    tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 500_000, output: 500_000 },
    status: "active",
  }
}

function compareGrokFamilyModels(a: GrokFamilySource, b: GrokFamilySource, aKey: string): number {
  const aVer = grokVersion(a.id ?? aKey)
  const bVer = grokVersion(b.id)
  if (aVer[0] !== bVer[0]) return aVer[0] - bVer[0]
  if (aVer[1] !== bVer[1]) return aVer[1] - bVer[1]
  return familyReleaseTime(a.release_date) - familyReleaseTime(b.release_date)
}

function grokVersion(id: string): [number, number] {
  const segment = (id.split("/").pop() ?? id).toLowerCase()
  const match = segment.match(/grok-(\d+)(?:[.-](\d+))?/)
  if (!match) return [0, 0]
  return [Number(match[1]), Number(match[2] ?? 0)]
}
