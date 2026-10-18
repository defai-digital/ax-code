import { createKeymapHelpEntries } from "ax-tui"
import type { DialogHelpBind, DialogHelpGroup } from "./dialog-help-view-model"

export interface DialogHelpSearchBind extends DialogHelpBind {
  shortcut: string
}

export interface DialogHelpSearchGroup {
  title: string
  binds: DialogHelpSearchBind[]
}

// AX Code owns schema grouping, localized labels, and configured shortcut
// display. The framework only matches searchable metadata; its formatted
// shortcut output must not change the application's leader/key spelling.
export function dialogHelpSearchGroups(
  groups: readonly DialogHelpGroup[],
  print: (key: string) => string,
  query: string,
  alternatives: (key: string) => readonly string[] = () => [],
): DialogHelpSearchGroup[] {
  return groups.flatMap((group) => {
    const binds = group.binds.flatMap((bind) => {
      const shortcut = print(bind.key)
      return shortcut ? [{ ...bind, shortcut }] : []
    })
    const matching = new Set(
      createKeymapHelpEntries(
        binds.map((bind) => ({
          id: bind.key,
          description: `${group.title} ${bind.label}`,
          keys: [bind.shortcut, ...alternatives(bind.key)],
        })),
        query,
      ).map((entry) => entry.id),
    )
    const visible = binds.filter((bind) => matching.has(bind.key))
    return visible.length ? [{ title: group.title, binds: visible }] : []
  })
}
