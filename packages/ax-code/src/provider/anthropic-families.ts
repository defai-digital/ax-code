import { familyDisplayName, familyReleaseTime, familySortKey, latestFamilyModels } from "./family-shared"

const DATED_ID = /-\d{8}$/
const FAMILY_ORDER = ["claude-opus", "claude-sonnet", "claude-haiku", "claude-fable"] as const

// Bare family aliases Claude Code accepts for `model`, optionally carrying a
// context/variant suffix such as `opus[1m]`.
const CLAUDE_ALIAS = /^(opus|sonnet|haiku|fable)(?:\[[^\]]*\])?$/i
// Aliases that select no single model: `default` follows the CLI's own default
// and `opusplan` mixes families per task phase.
const CLAUDE_ALIASES_WITHOUT_MODEL = new Set(["default", "opusplan"])

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

/**
 * Map a Claude Code `model` setting (settings.json or `ANTHROPIC_MODEL`) onto an
 * id discovered for the provider. A bare family alias (`opus`, `sonnet`,
 * `haiku`, `fable`, optionally with a `[...]` suffix) selects the newest listed
 * model of that family. `default` and `opusplan` select no single model, so the
 * caller's catalog-default/sentinel logic applies. Anything else — including a
 * full model id — passes through unchanged.
 */
export function resolveClaudeAlias<T extends AnthropicFamilySource>(
  configured: string | undefined,
  models: Record<string, T>,
): string | undefined {
  if (configured === undefined) return undefined
  const value = configured.trim()
  if (value.length === 0) return undefined
  if (CLAUDE_ALIASES_WITHOUT_MODEL.has(value.toLowerCase())) return undefined
  const match = CLAUDE_ALIAS.exec(value)
  if (!match) return configured
  const family = `claude-${match[1]!.toLowerCase()}`
  // A `[1m]` suffix selects a 1M-context variant the catalog does not publish
  // as a separate id. Collapsing to the plain newest id is enough to mark the
  // CLI default, and it deliberately never adds a separate alias row.
  const newest = latestAnthropicFamilyModels(models).find(
    (model) => claudeFamilyId({ id: model.id, family: model.family }) === family,
  )
  return newest?.id
}

function compareAnthropicFamilyModels(a: AnthropicFamilySource, b: AnthropicFamilySource, aKey: string): number {
  const byDate = familyReleaseTime(a.release_date) - familyReleaseTime(b.release_date)
  if (byDate !== 0) return byDate
  const byDated = Number(DATED_ID.test(b.id)) - Number(DATED_ID.test(a.id ?? aKey))
  if (byDated !== 0) return byDated
  return (a.id ?? aKey).localeCompare(b.id)
}
