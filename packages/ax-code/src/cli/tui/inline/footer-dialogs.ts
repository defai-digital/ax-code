/** Explicit opt-in at the dialog entry point; unknown and future dialogs always show the hint. */
export const FOOTER_DIALOGS = ["command", "model", "agent", "confirm", "alert"] as const
export type FooterDialog = (typeof FOOTER_DIALOGS)[number]
export function footerDialogPolicy(kind?: string): "footer" | "hint" {
  return FOOTER_DIALOGS.some((allowed) => allowed === kind) ? "footer" : "hint"
}
