/**
 * Deterministic request-only media projection.
 *
 * Durable MessageV2 history is never mutated. Callers count media in durable
 * order, then consume this selector in the same order while constructing one
 * provider request.
 */
export namespace MediaProjection {
  export type Mode = "normal" | "degraded" | "stripped"

  export const DEGRADED_KEEP_RECENT = 2
  export const OMITTED_TEXT =
    "[media omitted from this request to stay within the provider request-size limit; newer media is retained first]"

  export interface Selector {
    readonly mode: Mode
    readonly total: number
    readonly omitted: number
    keep(): boolean
  }

  export function create(input: { mode: Mode; total: number; keepRecent?: number }): Selector {
    const total = Math.max(0, Math.floor(input.total))
    const keepRecent = Math.max(0, Math.floor(input.keepRecent ?? DEGRADED_KEEP_RECENT))
    const keepFrom = Math.max(0, total - keepRecent)
    let seen = 0
    let omitted = 0

    return {
      mode: input.mode,
      total,
      get omitted() {
        return omitted
      },
      keep() {
        const index = seen++
        const keep = input.mode === "normal" || (input.mode === "degraded" && index >= keepFrom)
        if (!keep) omitted++
        return keep
      },
    }
  }

  export function next(mode: Mode): Mode | undefined {
    if (mode === "normal") return "degraded"
    if (mode === "degraded") return "stripped"
    return undefined
  }
}
