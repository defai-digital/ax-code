import { mergeDeep } from "remeda"
import { uniqueStrings } from "../util/string-list"
import { isRecord } from "../util/record"
import type { Agent, Info } from "./schema"

function mergeUniqueStrings(target: string[] | undefined, source: string[] | undefined): string[] | undefined {
  return target && source ? uniqueStrings([...target, ...source]) : undefined
}

/**
 * `permission.<tool>: "deny"` / `"ask"` is the blanket form of
 * `{ "*": "deny" }` / `{ "*": "ask" }`, and mergeDeep replaces that scalar
 * when a later source names the same tool with a pattern map. A committed
 * project ax-code.json could then erase a user's blanket deny or ask by
 * adding one pattern that never matches, falling back to the agent defaults
 * (`"*": "allow"`). Keep the blanket entry and append the later patterns in
 * the order evaluate() reads them (last match wins), so a source may still
 * narrow the tool by pattern — an explicit `"*"` from the later source still
 * wins.
 */
function foldBlanketRules(target: unknown, merged: unknown): void {
  if (!isRecord(target) || !isRecord(merged)) return
  for (const [tool, value] of Object.entries(target)) {
    if (value !== "deny" && value !== "ask") continue
    const incoming = merged[tool]
    if (!isRecord(incoming) || "*" in incoming) continue
    merged[tool] = { "*": value, ...incoming }
  }
}

/** Same floor for the per-agent / per-mode permission surfaces. */
function foldNestedBlanketRules(target: Info, merged: Info): void {
  foldBlanketRules(target.permission, merged.permission)
  for (const container of ["agent", "mode"] as const) {
    const targetEntries = target[container] as unknown
    const mergedEntries = merged[container] as unknown
    if (!isRecord(targetEntries) || !isRecord(mergedEntries)) continue
    for (const [name, entry] of Object.entries(targetEntries)) {
      if (!isRecord(entry)) continue
      const mergedEntry = mergedEntries[name]
      if (!isRecord(mergedEntry)) continue
      foldBlanketRules(entry["permission"], mergedEntry["permission"])
    }
  }
}

/**
 * Permission pattern maps evaluate last-match-wins in key insertion
 * order, but mergeDeep keeps the earlier source's key order for
 * surviving keys. An admin blanket deny in an authority layer (managed
 * config, AX_CODE_PERMISSION env) — `bash: { "*": "deny" }` — merged
 * onto a lower layer's `{ "*": "ask", "curl *": "allow" }` would leave
 * that `curl *` allow evaluated after the deny, so curl stays allowed
 * despite the admin's blanket rule. Rebuild each tool's map so the
 * authority layer's patterns come last and win. Scoped to the admin
 * layers only: reordering for project/user/remote sources would let a
 * lower-trust project override a user's specific deny by key order alone.
 */
function reorderAuthorityPermissionMaps(target: unknown, incoming: unknown, merged: unknown): void {
  if (!isRecord(target) || !isRecord(incoming) || !isRecord(merged)) return
  for (const tool of Object.keys(incoming)) {
    const earlier = target[tool]
    const later = incoming[tool]
    const mergedTool = merged[tool]
    // Scalar-vs-map pairs keep the existing merge behavior (see
    // foldBlanketRules); only two pattern maps reorder.
    if (!isRecord(earlier) || !isRecord(later) || !isRecord(mergedTool)) continue
    const rebuilt: Record<string, unknown> = {}
    for (const pattern of Object.keys(earlier)) {
      if (!Object.hasOwn(later, pattern)) rebuilt[pattern] = mergedTool[pattern]
    }
    for (const pattern of Object.keys(later)) {
      rebuilt[pattern] = mergedTool[pattern]
    }
    merged[tool] = rebuilt
  }
}

/** Same authority ordering for the per-agent / per-mode permission surfaces. */
function reorderNestedAuthorityPermissionMaps(target: Info, incoming: Info, merged: Info): void {
  reorderAuthorityPermissionMaps(target.permission, incoming.permission, merged.permission)
  for (const container of ["agent", "mode"] as const) {
    const targetEntries = target[container] as unknown
    const incomingEntries = incoming[container] as unknown
    const mergedEntries = merged[container] as unknown
    if (!isRecord(targetEntries) || !isRecord(incomingEntries) || !isRecord(mergedEntries)) continue
    for (const [name, incomingEntry] of Object.entries(incomingEntries)) {
      if (!isRecord(incomingEntry)) continue
      const targetEntry = targetEntries[name]
      const mergedEntry = mergedEntries[name]
      if (!isRecord(targetEntry) || !isRecord(mergedEntry)) continue
      reorderAuthorityPermissionMaps(targetEntry["permission"], incomingEntry["permission"], mergedEntry["permission"])
    }
  }
}

// Custom merge function that concatenates array fields instead of replacing them
export function mergeConfig(target: Info, source: Info, opts: { authority?: boolean } = {}): Info {
  const merged = mergeDeep(target, source)
  foldNestedBlanketRules(target, merged)
  // Only admin-authority sources (managed config) reorder permission
  // pattern maps so their patterns win; see reorderAuthorityPermissionMaps.
  if (opts.authority) reorderNestedAuthorityPermissionMaps(target, source, merged)
  const plugin = mergeUniqueStrings(target.plugin, source.plugin)
  if (plugin) {
    merged.plugin = plugin
  }
  const instructions = mergeUniqueStrings(target.instructions, source.instructions)
  if (instructions) {
    merged.instructions = instructions
  }
  // isolation.protected is a tightening-only safety list: entries only add
  // extra protected paths, they never remove the caller's DEFAULT_PROTECTED
  // set (see Isolation.resolve). mergeDeep treats arrays as opaque values
  // and lets `source` replace `target` wholesale, which would let a
  // higher-precedence-but-lower-trust source (e.g. a committed project
  // ax-code.json) silently discard protected paths a trusted global/managed
  // config added earlier. Concatenate instead, same as plugin/instructions.
  const protectedPaths = mergeUniqueStrings(target.isolation?.protected, source.isolation?.protected)
  if (protectedPaths) {
    merged.isolation = { ...merged.isolation, protected: protectedPaths }
  }
  return merged
}

// Fold a single source's deprecated top-level `mode` field into its own
// `agent` field, tagging each entry `mode: "primary"`. This must run once
// per source, before that source is merged into the accumulated result —
// not once at the very end of loadState() against the fully-merged config.
// Doing it at the end let ANY source's `mode.<name>` unconditionally
// clobber `agent.<name>` set by a higher-precedence source, since the
// migration ignored where each value actually came from (e.g. a lower
// trust remote well-known config's `mode.build.model` could overwrite the
// user's own trusted `agent.build.model`). Folding per-source lets the
// normal precedence-ordered merge in mergeFromSource decide the winner.
export function migrateDeprecatedModeIntoAgent(config: Info): Info {
  if (!config.mode) return config
  const patch: Record<string, Agent> = {}
  for (const [name, mode] of Object.entries(config.mode)) {
    patch[name] = { ...mode, mode: "primary" as const }
  }
  return { ...config, agent: mergeDeep(config.agent ?? {}, patch) }
}
