import { familyDisplayName, familyReleaseTime, familySortKey, latestFamilyModels } from "./family-shared"

const FAMILY_ORDER = ["gpt-flagship", "gpt-mini", "gpt-codex-spark"] as const

export type CodexFamilySource = {
  id: string
  name?: string
  family?: string
  release_date?: string
}

export function codexFamilyId(input: { id?: string; family?: string }): string | undefined {
  const segment = (input.id?.split("/").pop() ?? input.id ?? "").toLowerCase()
  if (!segment || segment === "codex-cli") return undefined
  if (/image|embedding|realtime|whisper|tts|audio|moderation/.test(segment)) return undefined
  if (/^(o[0-9]|chatgpt)/.test(segment)) return undefined
  if (segment.includes("codex-spark") || segment.endsWith("-spark")) return "gpt-codex-spark"
  if (segment.includes("codex")) return undefined
  if (segment.includes("mini")) return "gpt-mini"
  if (/(?:^|-)(nano|pro|sol|luna|terra|chat)(?:-|$)/.test(segment)) return undefined
  if (segment.startsWith("gpt-")) return "gpt-flagship"
  return undefined
}

export function codexFamilySortKey(family?: string): number {
  return familySortKey(FAMILY_ORDER, family)
}

export function codexDisplayName(name: string | undefined, fallback: string): string {
  return familyDisplayName(name, fallback, { stripOpenRouterPrefix: true })
}

export function latestCodexFamilyModels<T extends CodexFamilySource>(models: Record<string, T>): T[] {
  return latestFamilyModels(models, FAMILY_ORDER, codexFamilyId, compareCodexFamilyModels)
}

export function codexFallbackModels(): Array<
  CodexFamilySource & {
    attachment: boolean
    reasoning: boolean
    temperature: boolean
    tool_call: boolean
    modalities: { input: Array<"text" | "image" | "pdf">; output: Array<"text"> }
    limit: { context: number; output: number }
    status: "active"
  }
> {
  return [
    fallback("gpt-5.6", "GPT-5.6", "gpt-flagship", "2026-07-09", 1_050_000, 128_000),
    fallback("gpt-5.4-mini", "GPT-5.4 mini", "gpt-mini", "2026-03-17", 400_000, 128_000),
    fallback("gpt-5.3-codex-spark", "GPT-5.3 Codex Spark", "gpt-codex-spark", "2026-02-05", 400_000, 128_000),
  ]
}

function fallback(id: string, name: string, family: string, release_date: string, context: number, output: number) {
  return {
    id,
    name,
    family,
    release_date,
    attachment: true,
    reasoning: true,
    temperature: false,
    tool_call: true,
    modalities: {
      input: ["text", "image", "pdf"] as Array<"text" | "image" | "pdf">,
      output: ["text"] as Array<"text">,
    },
    limit: { context, output },
    status: "active" as const,
  }
}

function compareCodexFamilyModels(a: CodexFamilySource, b: CodexFamilySource, aKey: string): number {
  const aId = a.id ?? aKey
  const bId = b.id
  const aVer = gptVersion(aId)
  const bVer = gptVersion(bId)
  if (aVer[0] !== bVer[0]) return aVer[0] - bVer[0]
  if (aVer[1] !== bVer[1]) return aVer[1] - bVer[1]
  const bySuffix = Number(hasFlavorSuffix(bId)) - Number(hasFlavorSuffix(aId))
  if (bySuffix !== 0) return bySuffix
  return familyReleaseTime(a.release_date) - familyReleaseTime(b.release_date)
}

function hasFlavorSuffix(id: string): boolean {
  const segment = (id.split("/").pop() ?? id).toLowerCase()
  return /-(sol|luna|terra|latest|chat)$/.test(segment) || /-\d{8}$/.test(segment)
}

function gptVersion(id: string): [number, number] {
  const segment = (id.split("/").pop() ?? id).toLowerCase()
  const match = segment.match(/gpt-(\d+)(?:\.(\d+))?/)
  if (!match) return [0, 0]
  return [Number(match[1]), Number(match[2] ?? 0)]
}
