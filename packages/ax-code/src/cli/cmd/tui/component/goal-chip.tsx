// Sidebar goal indicator, modeled on grok-build's goal status line: the mode
// chip row shows work/run/sandbox state, but an active /goal — the thing the
// agent is actually working toward — was only visible in the session header.
// Rendered as its own row directly under the mode chips: plain accent text
// while active, an inverted warning ("yellow") chip when paused / blocked /
// budget-limited, and an inverted success chip when complete. Clicking opens
// the goal dialog (the `session.goal` command).

import { createMemo, Show } from "solid-js"
import type { RGBA } from "@ax-code/tui"
import { useTerminalDimensions } from "@ax-code/tui/solid"
import { useSync } from "@tui/context/sync"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { useCommandDialog } from "@tui/component/dialog-command"
import { footerGoalChip } from "../routes/session/footer-view-model"
import { computeSidebarWidth } from "../routes/session/layout"
import { footerToggleLabel } from "./prompt/footer-toggle"

export function GoalChip(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const command = useCommandDialog()
  const dimensions = useTerminalDimensions()

  // Budget the objective for what the sidebar can actually show after the
  // status word and token counters; the label wraps on the narrowest
  // sidebars rather than pushing the version row off screen.
  const maxObjective = createMemo(() => Math.max(10, computeSidebarWidth(dimensions().width) - 26))
  const chip = createMemo(() =>
    footerGoalChip({ goal: sync.data.session_goal[props.sessionID], maxObjective: maxObjective(), compact: true }),
  )
  // grok-build's scheme: active goals read as plain accent text; attention
  // states get an inverted chip so the row reads as a label, not prose.
  const inverted = createMemo(() => {
    const tone = chip()?.tone
    if (tone === "warning") return theme.warning
    if (tone === "success") return theme.success
    return undefined
  })

  return (
    <Show when={chip()}>
      {(view) => (
        <box flexShrink={0} onMouseUp={() => command.trigger("session.goal")}>
          <text>
            <span
              style={{
                fg: inverted() ? selectedForeground(theme, inverted() as RGBA) : theme.accent,
                bg: inverted(),
                bold: true,
              }}
            >
              {footerToggleLabel(view().label ?? "Goal", true)}
            </span>
          </text>
        </box>
      )}
    </Show>
  )
}
