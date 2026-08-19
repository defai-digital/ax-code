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
  const index = FAMILY_ORDER.indexOf(family as (typeof FAMILY_ORDER)[number])
  return index === -1 ? FAMILY_ORDER.length : index
}

export function codexDisplayName(name: string | undefined, fallback: string): string {
  const trimmed = (name ?? fallback)
    .replace(/\s*\(latest\)\s*/gi, " ")
    .replace(/^openrouter:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function latestCodexFamilyModels<T extends CodexFamilySource>(models: Record<string, T>): T[] {
  const best = new Map<string, T>()
  for (const [id, model] of Object.entries(models)) {
    const family = codexFamilyId({ id: model.id ?? id, family: model.family })
    if (!family) continue
    const current = best.get(family)
    if (!current || compareCodexFamilyModels(model, current, id) > 0) best.set(family, model)
  }
  return FAMILY_ORDER.map((family) => best.get(family)).filter((model): model is T => model !== undefined)
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
  return releaseTime(a.release_date) - releaseTime(b.release_date)
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

function releaseTime(value?: string): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}
