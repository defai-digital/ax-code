import { Keybinds } from "@/config/schema"

const HELP_DIALOG_TOP_PADDING_RATIO = 4
const HELP_DIALOG_CHROME_HEIGHT = 5
const HELP_DIALOG_BOTTOM_SAFE_MARGIN = 2

export function dialogHelpBodyHeight(input: { contentRows: number; terminalHeight: number }) {
  if (input.contentRows <= 0) return 1

  const terminalHeight = Math.max(1, Math.floor(input.terminalHeight))
  const topPadding = Math.floor(terminalHeight / HELP_DIALOG_TOP_PADDING_RATIO)
  const viewportRows = terminalHeight - topPadding - HELP_DIALOG_CHROME_HEIGHT - HELP_DIALOG_BOTTOM_SAFE_MARGIN

  return Math.max(1, Math.min(input.contentRows, viewportRows))
}

export interface DialogHelpBind {
  key: string
  label: string
}

export interface DialogHelpGroup {
  title: string
  binds: DialogHelpBind[]
}

// Categories mirror the grouping the help dialog has always used. Every
// keybind declared in the Keybinds schema is assigned to exactly one group so
// newly added bindings show up in the dialog automatically instead of
// drifting out of sync with a hand-written list.
const GROUP_ORDER = ["Session", "Navigation", "Models & Agents", "Input", "Permissions", "Display", "System"] as const

const GROUP_BY_PREFIX: ReadonlyArray<[prefix: string, group: (typeof GROUP_ORDER)[number]]> = [
  ["session_", "Session"],
  ["stash_", "Session"],
  ["messages_", "Navigation"],
  ["sidebar_", "Navigation"],
  ["model_", "Models & Agents"],
  ["agent_", "Models & Agents"],
  ["variant_", "Models & Agents"],
  ["input_", "Input"],
  ["history_", "Input"],
  ["permission_", "Permissions"],
  ["display_", "Display"],
  ["tool_", "Display"],
  ["scrollbar_", "Display"],
  ["username_", "Display"],
]

// Prefix rules would misfile these; keep them where the dialog has always
// shown them.
const GROUP_BY_KEY: Partial<Record<string, (typeof GROUP_ORDER)[number]>> = {
  messages_toggle_conceal: "Display",
}

function dialogHelpGroupTitle(key: string): (typeof GROUP_ORDER)[number] {
  const override = GROUP_BY_KEY[key]
  if (override) return override
  for (const [prefix, group] of GROUP_BY_PREFIX) {
    if (key.startsWith(prefix)) return group
  }
  return "System"
}

// Build the dialog content from the Keybinds schema: labels come from each
// entry's `.describe()` text and the rendered keys are resolved at draw time
// via `keybind.print`, so user overrides are reflected automatically.
// Bindings defaulting to "none" are filtered out by the dialog when they
// print to an empty string.
export function dialogHelpGroups(): DialogHelpGroup[] {
  const bindsByGroup = new Map<string, DialogHelpBind[]>()
  for (const [key, field] of Object.entries(Keybinds.shape)) {
    const title = dialogHelpGroupTitle(key)
    const binds = bindsByGroup.get(title) ?? []
    binds.push({ key, label: field.description ?? key })
    bindsByGroup.set(title, binds)
  }
  return GROUP_ORDER.filter((title) => bindsByGroup.has(title)).map((title) => ({
    title,
    binds: bindsByGroup.get(title)!,
  }))
}
