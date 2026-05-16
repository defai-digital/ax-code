import { Permission } from "@/permission"

/**
 * Reusable permission presets for agent definitions.
 *
 * These reduce duplication across the 12+ agent definitions in agent.ts.
 * Each preset is a partial Config.Permission that gets merged with
 * defaults and user config via Permission.merge().
 */

/** Read-only with web access — for security, architect, explore agents.
 *  NOTE: this preset is shared by both subagent-tier (explore) and
 *  primary-tier (security, architect) agents, so it intentionally does
 *  NOT pin `dispatcher`. The ADR-005 default-deny for subagent-tier is
 *  applied per-agent in agent.ts, which is the only place that knows
 *  the agent's tier. */
export const readOnlyWithWeb = (whitelistedDirs: string[]) =>
  Permission.fromConfig({
    "*": "deny",
    grep: "allow",
    glob: "allow",
    list: "allow",
    read: "allow",
    codesearch: "allow",
    webfetch: "allow",
    websearch: "allow",
    // Debugging & Refactoring Engine read-only tools. Only effective
    // when AX_CODE_EXPERIMENTAL_DEBUG_ENGINE is set; otherwise the
    // registry never registers them and the allow entries are inert.
    // See ADR-010 for why presets are edited directly rather than
    // extended via a registry.
    debug_analyze: "allow",
    refactor_plan: "allow",
    dedup_scan: "allow",
    impact_analyze: "allow",
    hardcode_scan: "allow",
    external_directory: {
      "*": "ask",
      ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
    },
  })

/** Read-only without web access — for the perf agent.
 *  Performance analysis works against the local codebase only; web tools
 *  would be both unnecessary and outside the agent's intended scope. */
export const readOnlyNoWeb = (whitelistedDirs: string[]) =>
  Permission.fromConfig({
    "*": "deny",
    grep: "allow",
    glob: "allow",
    list: "allow",
    read: "allow",
    codesearch: "allow",
    // Debugging & Refactoring Engine read-only tools — see note above.
    debug_analyze: "allow",
    refactor_plan: "allow",
    dedup_scan: "allow",
    impact_analyze: "allow",
    hardcode_scan: "allow",
    external_directory: {
      "*": "ask",
      ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
    },
  })

/** Deny all tools — for compaction, title, summary agents */
export const denyAll = Permission.fromConfig({
  "*": "deny",
})
