import path from "node:path"
import z from "zod"
import { exactOrigin } from "./webmcp-origin"

const Origin = z.string().max(240).refine(exactOrigin, "Use an exact HTTPS origin or HTTP loopback origin")

const uniqueOrigins = (origins: string[]) => new Set(origins).size === origins.length

const Origins = z.array(Origin).min(1).max(8).refine(uniqueOrigins, "Origins must be unique")

/**
 * ADR-170: a profile origin list may be empty. Empty means navigation is
 * unrestricted (the product default); a non-empty list is a narrowing list
 * that restores exact-origin enforcement at launch and at call time.
 */
const ProfileOrigins = z.array(Origin).max(8).refine(uniqueOrigins, "Origins must be unique")

/**
 * Managed-only enterprise requirement for the experimental bridge. It is read
 * exclusively from the managed config directory: no project, user, remote or
 * inline source may set or loosen it. `allow: false` blocks the bridge
 * outright; `allowedOrigins`, when present, narrows the exact origins admitted
 * for call-time navigation checks. A requirement can only restrict — it never
 * enables the bridge and never removes the per-call interactive approval.
 */
export const Requirement = z
  .object({
    allow: z
      .boolean()
      .optional()
      .describe("Managed allow/deny for the experimental WebMCP bridge. false blocks the bridge entirely."),
    allowedOrigins: Origins.optional().describe(
      "Managed narrowing list. When set, only these exact origins stay usable: an unrestricted profile narrows to this list; a configured profile is intersected with it and an empty intersection fails closed.",
    ),
    allowPersistentProfile: z
      .boolean()
      .optional()
      .describe(
        "Managed opt-in for a persistent AX-owned browser profile. Default off; never the user's main profile.",
      ),
    allowVendored: z
      .boolean()
      .optional()
      .describe("Managed opt-in for a vendored, integrity-pinned bridge install instead of npx. Default off."),
    allowRead: z
      .boolean()
      .optional()
      .describe(
        "Managed gate for the T1 read tier. Default off. false forces the read tools off even when the profile sets read: true; it can only restrict, never enable.",
      ),
    allowInteract: z
      .boolean()
      .optional()
      .describe(
        "Managed gate for the T2 interact tier. false forces the interact tools off even when the profile sets interact: true; it can only restrict, never enable.",
      ),
  })
  .strict()
  .meta({ ref: "WebMcpRequirementConfig" })

export type Requirement = z.infer<typeof Requirement>

export const Configuration = z
  .object({
    allowedOrigins: ProfileOrigins.describe(
      "Exact permitted origins; no wildcards, credentials, paths, queries or fragments. Empty (the product default) navigates any http(s) origin; a non-empty list narrows navigation to exactly those origins.",
    ),
    headless: z.boolean().optional().describe("Use an isolated headless Chrome instead of a visible window"),
    persistentProfile: z
      .boolean()
      .optional()
      .describe(
        "Use a persistent AX-owned browser profile so authenticated WebMCP tools work. Requires the managed allowPersistentProfile requirement and forces a visible window.",
      ),
    vendored: z
      .boolean()
      .optional()
      .describe(
        "Launch a vendored, integrity-pinned bridge install instead of npx. Requires the managed allowVendored requirement.",
      ),
    read: z
      .boolean()
      .optional()
      .describe(
        "Enable the T1 read tier: page snapshot, screenshot and console tools for granted origins. Default off. A managed allowRead: false forces it off.",
      ),
    interact: z
      .boolean()
      .optional()
      .describe(
        "Enable the T2 interact tier: click, hover, wait_for, fill, fill_form, press_key and handle_dialog for granted origins, each confirmed interactively. Default off. A managed allowInteract: false forces it off.",
      ),
    executablePath: z
      .string()
      .max(4096)
      .refine((value) => path.isAbsolute(value) && !value.includes("\0"), "Use an absolute Chrome executable path")
      .optional()
      .describe("Optional explicit Chrome 150+ executable; never attaches to an existing browser session"),
  })
  .strict()
  .meta({ ref: "WebMcpProfileConfig" })

export type Configuration = z.infer<typeof Configuration>
