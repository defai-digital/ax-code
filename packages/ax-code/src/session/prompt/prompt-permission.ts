import type { Permission } from "@/permission"

export function permissionRulesetFromLegacyTools(tools: Record<string, boolean> | undefined): Permission.Ruleset {
  return Object.entries(tools ?? {}).map(([tool, enabled]) => ({
    permission: tool,
    action: enabled ? "allow" : "deny",
    pattern: "*",
  }))
}
