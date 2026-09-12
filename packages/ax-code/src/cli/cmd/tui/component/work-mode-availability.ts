import { WorkMode } from "@/mode/work-mode"
import { isNonChatModelID, modelSelectableForProvider } from "@/provider/model-selectability"

// Shared work-mode availability view-model. Pure and Solid-free so chip, hint,
// cycle gating, and the submit guard all agree on the same rules, and tests can
// exercise them without rendering. Selectability reuses the exact helpers the
// server's ensemble auto-selection uses, so "available" here means the
// auto-route can actually resolve at least two members.

export type WorkModeAvailabilityState = "available" | "unavailable" | "checking"

export type WorkModeAvailability = {
  state: WorkModeAvailabilityState
  /** Effective auto-selected member cap: config maximum clamped by the number
   *  of counting providers. Zero unless available. */
  members: number
  /** Short reason token for compact UI ("off" | "needs 2" | "max 1"). */
  reason?: "off" | "needs 2" | "max 1"
  /** One-sentence explanation for toasts and hints. */
  detail?: string
}

export type AvailabilityProvider = {
  id: string
  models: Record<string, Parameters<typeof modelSelectableForProvider>[1]>
}

export type WorkModeConfig = {
  council?: { enabled?: boolean; maxMembers?: number }
  arena?: { enabled?: boolean; maxContestants?: number }
}

/** Documented defaults, mirroring tool/council.ts and tool/arena.ts. */
const DEFAULT_COUNCIL_MAX_MEMBERS = 3
const DEFAULT_ARENA_MAX_CONTESTANTS = 3

/** Providers with at least one selectable chat model — the same bar as the
 *  server's snapshotSelectableProviders, minus auth-decryption detail. */
export function countingProviders(providers: readonly AvailabilityProvider[]): number {
  let count = 0
  for (const provider of providers) {
    const entries = Object.entries(provider.models ?? {})
    if (!entries.length) continue
    const selectable = entries.filter(([, model]) => modelSelectableForProvider(provider.id, model))
    if (!selectable.length) continue
    if (selectable.every(([id]) => isNonChatModelID(id))) continue
    count++
  }
  return count
}

export function workModeAvailability(input: {
  mode: WorkMode.Id
  providers: readonly AvailabilityProvider[]
  providerLoaded: boolean
  config?: WorkModeConfig
}): WorkModeAvailability {
  if (input.mode === "agent") return { state: "available", members: 1 }
  if (!input.providerLoaded) return { state: "checking", members: 0 }

  const label = WorkMode.label(input.mode)
  const enabled =
    input.mode === "council" ? input.config?.council?.enabled !== false : input.config?.arena?.enabled === true
  if (!enabled) {
    const detail =
      input.mode === "council"
        ? "Council is disabled (modes.council.enabled: false)"
        : "Arena is off (set modes.arena.enabled: true to enable)"
    return { state: "unavailable", members: 0, reason: "off", detail }
  }

  const configuredCap =
    input.mode === "council"
      ? (input.config?.council?.maxMembers ?? DEFAULT_COUNCIL_MAX_MEMBERS)
      : (input.config?.arena?.maxContestants ?? DEFAULT_ARENA_MAX_CONTESTANTS)
  if (configuredCap < 2) {
    const setting = input.mode === "council" ? "maxMembers" : "maxContestants"
    return {
      state: "unavailable",
      members: 0,
      reason: "max 1",
      detail: `${label} needs ${setting} ≥ 2 to compare models`,
    }
  }

  const providers = countingProviders(input.providers)
  if (providers < 2) {
    return {
      state: "unavailable",
      members: 0,
      reason: "needs 2",
      detail: `${label} needs ≥2 providers with selectable models (${providers} connected)`,
    }
  }
  return { state: "available", members: Math.min(configuredCap, providers) }
}

/** Chip presentation: label text plus whether the filled (active) style applies. */
export function workModeChipView(
  mode: WorkMode.Id,
  availability: WorkModeAvailability,
): {
  label: string
  active: boolean
} {
  if (mode === "agent") return { label: WorkMode.label(mode), active: true }
  const label = WorkMode.label(mode)
  if (availability.state === "available") return { label: `${label} · ${availability.members}`, active: true }
  if (availability.state === "checking") return { label: `${label} (…)`, active: false }
  return { label: `${label} (${availability.reason})`, active: false }
}

/** Persistent one-line hint above the prompt; undefined for Agent mode. */
export function workModeHint(mode: WorkMode.Id, availability: WorkModeAvailability): string | undefined {
  if (mode === "agent") return undefined
  const label = WorkMode.label(mode)
  if (availability.state === "checking") return `${label} mode · checking providers…`
  if (availability.state === "unavailable") return `${availability.detail} — submit is blocked`
  if (mode === "council")
    return `Council mode · up to ${availability.members} reviewers · advisory · approval on first use`
  return `Arena mode · up to ${availability.members} contestants · plan or isolated implementation · approval on first use`
}

/** Cycle to the next available mode, collecting the modes skipped on the way. */
export function nextAvailableWorkMode(
  current: WorkMode.Id,
  availability: (mode: WorkMode.Id) => WorkModeAvailability,
): { next: WorkMode.Id; skipped: { mode: WorkMode.Id; detail: string }[] } {
  const skipped: { mode: WorkMode.Id; detail: string }[] = []
  let candidate = WorkMode.cycle(current)
  while (candidate !== current) {
    const state = availability(candidate)
    if (state.state === "available") return { next: candidate, skipped }
    skipped.push({ mode: candidate, detail: state.detail ?? "checking providers" })
    candidate = WorkMode.cycle(candidate)
  }
  return { next: current, skipped }
}

/** Single toast line after a cycle: where we landed plus what was skipped. */
export function workModeCycleToast(
  next: WorkMode.Id,
  availability: WorkModeAvailability,
  skipped: readonly { mode: WorkMode.Id; detail: string }[],
): string {
  const label = WorkMode.label(next)
  const landing =
    next === "agent"
      ? `Work mode: ${label}`
      : `Work mode: ${label} · up to ${availability.members} ${next === "council" ? "reviewers" : "contestants"}`
  if (!skipped.length) return landing
  return `${landing} — skipped ${skipped.map((item) => `${WorkMode.label(item.mode)} (${item.detail})`).join(", ")}`
}
