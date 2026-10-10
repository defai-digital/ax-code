import z from "zod"

/** Discovery describes availability; only configuration authorizes recovery targets. */
export namespace RoutePolicy {
  export function isLoopbackBaseURL(value: unknown): boolean {
    if (typeof value !== "string" || !value.trim()) return false
    try {
      const url = new URL(value)
      if (url.protocol !== "http:" && url.protocol !== "https:") return false
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
      // URL canonicalizes IPv4 literals and IPv4-mapped IPv6 addresses. Match
      // the full address so a remote DNS name such as 127.gateway.example
      // cannot masquerade as loopback, and mapped 127/8 retains local privacy.
      return (
        host === "localhost" ||
        host === "::1" ||
        /^127(?:\.\d{1,3}){3}$/.test(host) ||
        /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host)
      )
    } catch {
      return false
    }
  }

  export const Target = z
    .object({
      providerID: z.string().trim().min(1),
      modelID: z.string().trim().min(1),
    })
    .strict()
  export type Target = z.infer<typeof Target>

  export function key(target: Target): string {
    return JSON.stringify([target.providerID, target.modelID])
  }

  export const Configuration = z
    .object({
      fallback: z
        .array(Target)
        .max(8)
        .refine(
          (targets) => new Set(targets.map(key)).size === targets.length,
          "Fallback targets must be distinct exact provider/model pairs",
        )
        .optional(),
    })
    .strict()
  export type Configuration = z.infer<typeof Configuration>

  /** A restricting source can remove entries, never grant or reorder them. */
  export function narrow(current: Configuration | undefined, restriction: Configuration): Configuration {
    if (restriction.fallback === undefined) return current ?? {}
    const allowed = new Set(restriction.fallback.map(key))
    return { fallback: (current?.fallback ?? []).filter((target) => allowed.has(key(target))) }
  }

  export function next(input: {
    current: Target
    candidates: readonly Target[]
    failed?: Iterable<string>
  }): Target | undefined {
    const failed = new Set(input.failed)
    failed.add(key(input.current))
    return input.candidates.find((target) => !failed.has(key(target)))
  }
}
