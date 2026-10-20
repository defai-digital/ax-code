import { singleLine } from "./block-format"

/** Scrollback notice and marker text; the inline root supplies translated strings. */
export type InlineText = {
  sessionMarker(id: string): string
  revertMarker(id: string): string
  compactionMarker(): string
  pending(kind: "permission" | "question"): string
}

export const DEFAULT_INLINE_TEXT: InlineText = {
  sessionMarker: (id) => `--- Session ${singleLine(id)} ---`,
  revertMarker: (id) => `--- Reverted to ${singleLine(id)} (earlier scrollback retained) ---`,
  compactionMarker: () => "--- Context compacted (earlier scrollback retained) ---",
  pending: (kind) =>
    kind === "permission"
      ? "Permission request pending: answer it in ax-code --screen full"
      : "Question pending: answer it in ax-code --screen full",
}
