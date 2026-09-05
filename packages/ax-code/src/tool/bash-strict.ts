import { Permission } from "@/permission"

/**
 * Cloud-operations strict mode (PRD-2026-09-04-cloud-operations-mode P2,
 * modeled after Permission's enforceSafetyPolicy): when `ops.strict` is
 * enabled, a destructive-classified bash command is hard-denied before any
 * permission ask. The deny lists the classified commands and reasons and
 * directs the model to the sanctioned ops workflow, so the model can recover
 * by planning instead of retrying the raw command.
 */
export function denyDestructiveInOpsStrict(destructiveCommands: ReadonlyMap<string, string>): never {
  const classified = [...destructiveCommands].map(([command, reason]) => `  - ${command} — ${reason}`)
  const reason = [
    "Cloud-operations strict mode (ops.strict) is enabled: destructive-classified bash commands are denied without an approved operation plan.",
    "",
    "Denied commands:",
    ...classified,
    "",
    "To mutate cloud or network state, use the sanctioned workflow instead: ops_plan -> ops_diff -> ops_approve (issues a single-use approval token) -> ops_apply.",
  ].join("\n")
  throw new Permission.DeniedError({
    ruleset: [
      {
        permission: "bash_destructive",
        action: "deny",
        pattern: "*",
        reason,
      },
    ],
  })
}
