/**
 * Store registry — machine-readable metadata for app-level stores.
 *
 * Each registered store declares a unique name, the domain it owns, and a
 * tier describing its update frequency. Registration happens at module load
 * via `defineStore`; duplicate names throw immediately so two stores can
 * never share one exported hook identity.
 *
 * This is intentionally thin: no interception, no proxying — the store is
 * returned unchanged. The boundary ratchet in
 * `script/check-desktop-store-boundaries.ts` uses static analysis (not this
 * registry) for its no-duplicate-hook-names rule, because only a subset of
 * stores is registered so far. Later sub-steps may register every store and
 * consume this registry instead.
 */

/** Update-frequency tier of a store. */
export type StoreTier =
  /** Mutated on the per-frame streaming path (e.g. 60/s message.part.delta). */
  | "hot"
  /** Mutated by server events at interaction frequency. */
  | "live"
  /** Mutated by user actions or app lifecycle only. */
  | "app"

export type StoreMeta = {
  /** Domain this store owns (e.g. "notifications", "sessions"). */
  domain: string
  tier: StoreTier
}

export type StoreRegistration = StoreMeta & {
  name: string
}

const registrations = new Map<string, StoreRegistration>()

/**
 * Register a store under a unique name and return it unchanged.
 * Throws at module load when the name is already taken.
 */
export function defineStore<T>(name: string, meta: StoreMeta, store: T): T {
  const existing = registrations.get(name)
  if (existing) {
    throw new Error(
      `Duplicate store registration: "${name}" (domain "${existing.domain}" is already registered). ` +
        `Store hook names must be unique across src/stores/ and src/sync/.`,
    )
  }
  registrations.set(name, { name, ...meta })
  return store
}

/** Snapshot of all registrations, for tests and diagnostics. */
export function getStoreRegistry(): readonly StoreRegistration[] {
  return Array.from(registrations.values())
}
