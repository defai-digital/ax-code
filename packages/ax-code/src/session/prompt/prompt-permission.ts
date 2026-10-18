import type { Permission } from "@/permission"

// The edit family all enforce under the single "edit" permission (see
// EDIT_TOOLS in permission/index.ts and the legacy `tools` fold in
// config-impl.ts). A legacy `tools: { write: false }` toggle must disable
// edit/apply_patch/multiedit too, exactly like the config-level mapping.
const EDIT_FAMILY = new Set(["edit", "write", "patch", "apply_patch", "multiedit", "refactor_apply"])

export function permissionRulesetFromLegacyTools(tools: Record<string, boolean> | undefined): Permission.Ruleset {
  // Fold to one rule per permission so a family toggle and an explicit
  // `edit` toggle cannot emit contradictory rules; the last entry wins,
  // matching the config-level fold.
  const actions = new Map<string, "allow" | "deny">()
  for (const [tool, enabled] of Object.entries(tools ?? {})) {
    actions.set(EDIT_FAMILY.has(tool) ? "edit" : tool, enabled ? "allow" : "deny")
  }
  return [...actions.entries()].map(([permission, action]) => ({
    permission,
    action,
    pattern: "*",
  }))
}
