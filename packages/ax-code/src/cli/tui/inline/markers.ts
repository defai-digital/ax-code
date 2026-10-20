import { singleLine } from "./block-format"

/** Scrollback notice and marker text; the inline root supplies translated strings. */
export type InlineText = {
  sessionMarker(id: string): string
  revertMarker(id: string): string
  imagePlaceholder(name: string): string
  compactionMarker(): string
}

export const DEFAULT_INLINE_TEXT: InlineText = {
  sessionMarker: (id) => `--- Session ${singleLine(id)} ---`,
  revertMarker: (id) => `--- Reverted to ${singleLine(id)} (earlier scrollback retained) ---`,
  imagePlaceholder: (name) => `[image: ${singleLine(name)}]`,
  compactionMarker: () => "--- Context compacted (earlier scrollback retained) ---",
}
