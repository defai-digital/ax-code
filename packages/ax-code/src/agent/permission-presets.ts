import { Permission } from "@/permission"

/**
 * Reusable permission presets for agent definitions.
 *
 * These reduce duplication across the 12+ agent definitions in agent.ts.
 * Each preset is a partial Config.Permission that gets merged with
 * defaults and user config via Permission.merge().
 */

/** Read-only with web access — for security, architect, explore agents */
export const readOnlyWithWeb = (whitelistedDirs: string[]) =>
  Permission.fromConfig({
    "*": "deny",
    grep: "allow",
    glob: "allow",
    list: "allow",
    bash: "allow",
    read: "allow",
    codesearch: "allow",
    webfetch: "allow",
    websearch: "allow",
    external_directory: {
      "*": "ask",
      ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
    },
  })

/** Read-only without web access — for perf agent */
export const readOnlyNoWeb = (whitelistedDirs: string[]) =>
  Permission.fromConfig({
    "*": "deny",
    grep: "allow",
    glob: "allow",
    list: "allow",
    bash: "allow",
    read: "allow",
    codesearch: "allow",
    external_directory: {
      "*": "ask",
      ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
    },
  })

/** Deny all tools — for compaction, title, summary agents */
export const denyAll = Permission.fromConfig({
  "*": "deny",
})
