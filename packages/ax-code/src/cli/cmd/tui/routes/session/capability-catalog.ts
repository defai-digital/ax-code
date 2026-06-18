export type CapabilityCatalogItem = {
  kind: "instruction" | "command" | "skill" | "agent" | "workflow"
  name: string
  description?: string
  source?: string
  sourceTool?: string
  scope?: string
  location?: string
  warnings?: Array<{
    code: string
    message: string
    severity: "info" | "warn" | "error"
  }>
  metadata?: Record<string, unknown>
}

export type CapabilityCatalogOption = {
  title: string
  value: string
  category: string
  description?: string
  footer?: string
}

const CATEGORY: Record<CapabilityCatalogItem["kind"], string> = {
  instruction: "Instructions",
  command: "Commands",
  skill: "Skills",
  agent: "Agents",
  workflow: "Workflows",
}

const CATEGORY_ORDER = new Map(Object.values(CATEGORY).map((category, index) => [category, index]))
const CAPABILITY_KINDS = new Set<CapabilityCatalogItem["kind"]>([
  "instruction",
  "command",
  "skill",
  "agent",
  "workflow",
])

function isCapabilityCatalogItem(input: unknown): input is CapabilityCatalogItem {
  return (
    isRecord(input) &&
    typeof input.name === "string" &&
    CAPABILITY_KINDS.has(input.kind as CapabilityCatalogItem["kind"])
  )
}

export function normalizeCapabilityCatalogItems(data: unknown): CapabilityCatalogItem[] {
  return Array.isArray(data) ? data.filter(isCapabilityCatalogItem) : []
}

export function capabilityCatalogOptions(capabilities: CapabilityCatalogItem[]): CapabilityCatalogOption[] {
  return [...capabilities]
    .sort((a, b) => {
      const category = compareNumber(
        CATEGORY_ORDER.get(CATEGORY[a.kind]) ?? 0,
        CATEGORY_ORDER.get(CATEGORY[b.kind]) ?? 0,
      )
      if (category !== 0) return category
      return a.name.localeCompare(b.name)
    })
    .map((capability) => ({
      title: capability.name,
      value: `${capability.kind}:${capability.name}`,
      category: CATEGORY[capability.kind],
      description: capabilityCatalogDescription(capability),
      footer: capability.location ? "file" : undefined,
    }))
}

export function capabilityCatalogDescription(capability: CapabilityCatalogItem): string | undefined {
  const parts = [
    clean(capability.description),
    sourceLabel(capability),
    recommendedLabel(capability),
    workflowRuntimeLabel(capability),
    trustLabel(capability),
    permissionImpactLabel(capability),
    warningLabel(capability),
  ].filter((part): part is string => Boolean(part))

  return parts.length ? parts.join(" | ") : undefined
}

function sourceLabel(capability: CapabilityCatalogItem) {
  const source = [capability.sourceTool ?? capability.source, capability.scope].filter(Boolean).join("/")
  return source ? `source ${source}` : undefined
}

function recommendedLabel(capability: CapabilityCatalogItem) {
  if (!isRecord(capability.metadata)) return undefined
  return capability.metadata.recommended === true ? "recommended" : undefined
}

function workflowRuntimeLabel(capability: CapabilityCatalogItem) {
  if (!isRecord(capability.metadata)) return undefined
  return capability.metadata.requiresWorkflowRuntime === true ? "runtime gated" : undefined
}

function trustLabel(capability: CapabilityCatalogItem) {
  if (!isRecord(capability.metadata)) return undefined
  const trust = capability.metadata.trust
  return typeof trust === "string" && trust.length ? `trust ${trust}` : undefined
}

function permissionImpactLabel(capability: CapabilityCatalogItem) {
  if (!isRecord(capability.metadata)) return undefined
  const impact = capability.metadata.permissionImpact
  if (typeof impact === "string" && impact.length) return `permission ${impact.replaceAll("_", " ")}`
  if (!isRecord(impact)) return undefined

  const allow = numberValue(impact.allow)
  const ask = numberValue(impact.ask)
  const deny = numberValue(impact.deny)
  if (allow !== undefined || ask !== undefined || deny !== undefined) {
    return `permission allow:${allow ?? 0} ask:${ask ?? 0} deny:${deny ?? 0}`
  }
  return Object.keys(impact).length ? "permission custom" : undefined
}

function warningLabel(capability: CapabilityCatalogItem) {
  const count = capability.warnings?.length ?? 0
  if (count === 0) return undefined
  return `${count} warning${count === 1 ? "" : "s"}`
}

function clean(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function compareNumber(a: number, b: number) {
  return a < b ? -1 : a > b ? 1 : 0
}
